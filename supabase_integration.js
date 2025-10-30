/**
 * Supabase Integration Module
 *
 * This module provides functions to replace GitHub Actions with Supabase Edge Functions.
 * It does not modify existing files - it's a separate integration layer.
 *
 * Usage: Include this script in index.html and configure with your Supabase credentials.
 */

class SupabaseIntegration {
    constructor(supabaseUrl, supabaseAnonKey) {
        if (!supabaseUrl || !supabaseAnonKey) {
            throw new Error('Supabase URL and Anon Key are required');
        }

        this.supabaseUrl = supabaseUrl;
        this.supabaseAnonKey = supabaseAnonKey;

        // Initialize Supabase client (using CDN version)
        this.supabase = window.supabase.createClient(supabaseUrl, supabaseAnonKey);

        // Initialize client-side cache for query results
        // Cache TTL: 5 minutes (data refreshes after each sync anyway)
        this.queryCache = new Map();
        this.cacheTTL = 5 * 60 * 1000; // 5 minutes in milliseconds

        // Initialize request deduplication tracker
        // Prevents duplicate in-flight requests for same query
        this.inFlightRequests = new Map();

        console.log('✅ Supabase Integration initialized');
    }

    /**
     * Wrapper for cached database queries with request deduplication
     * - Checks cache before querying
     * - Deduplicates in-flight requests (prevents duplicate simultaneous queries)
     * - Stores results with timestamp
     * - Automatically expires stale entries
     * - Transparent to callers (returns same data structure)
     *
     * @param {string} cacheKey - Unique identifier for this query
     * @param {Function} queryFn - Async function that performs the actual query
     * @returns {Promise} - Query results (from cache or fresh)
     */
    async cachedQuery(cacheKey, queryFn) {
        const now = Date.now();
        const cached = this.queryCache.get(cacheKey);

        // Return cached data if valid
        if (cached && (now - cached.timestamp) < this.cacheTTL) {
            console.log(`📦 Cache hit: ${cacheKey} (${Math.round((now - cached.timestamp) / 1000)}s old)`);
            return cached.data;
        }

        // Check if this request is already in-flight (deduplication)
        if (this.inFlightRequests.has(cacheKey)) {
            console.log(`🔗 Request deduplication: ${cacheKey} (waiting for in-flight request)`);
            return this.inFlightRequests.get(cacheKey);
        }

        // Cache miss or expired - fetch fresh data
        console.log(`🔄 Cache miss: ${cacheKey}`);

        // Create promise and track it
        const promise = queryFn().then(data => {
            // Store in cache
            this.queryCache.set(cacheKey, {
                data: data,
                timestamp: now
            });

            // Remove from in-flight tracker
            this.inFlightRequests.delete(cacheKey);

            return data;
        }).catch(error => {
            // Remove from in-flight tracker on error
            this.inFlightRequests.delete(cacheKey);
            throw error;
        });

        // Track this in-flight request
        this.inFlightRequests.set(cacheKey, promise);

        return promise;
    }

    /**
     * Clear cached combination data
     * Call this after running analysis to force fresh data load
     */
    clearCombinationCache() {
        const keysToDelete = [];
        for (const [key] of this.queryCache) {
            if (key.startsWith('combinations_')) {
                keysToDelete.push(key);
            }
        }
        keysToDelete.forEach(key => this.queryCache.delete(key));
        console.log(`🗑️ Cleared ${keysToDelete.length} combination cache entries`);
    }

    /**
     * Invalidate specific cache entry or entire cache
     * Also clears in-flight request tracking for invalidated keys
     * @param {string|null} cacheKey - Specific key to invalidate, or null for all
     */
    invalidateCache(cacheKey = null) {
        if (cacheKey) {
            this.queryCache.delete(cacheKey);
            this.inFlightRequests.delete(cacheKey);
            console.log(`🗑️ Cache invalidated: ${cacheKey}`);
        } else {
            this.queryCache.clear();
            this.inFlightRequests.clear();
            console.log('🗑️ All cache cleared');
        }
    }

    /**
     * Invoke Supabase Edge Function with retry logic for cold starts
     * @param {string} functionName - Name of the edge function to invoke
     * @param {object} body - Request body
     * @param {string} label - Label for logging
     * @param {number} maxRetries - Maximum retry attempts (default 2)
     * @param {number} retryDelay - Delay between retries in ms (default 3000)
     */
    async invokeFunctionWithRetry(functionName, body = {}, label = 'Function', maxRetries = 2, retryDelay = 3000) {
        let lastError = null;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                if (attempt > 0) {
                    console.log(`🔄 Retrying ${label} (attempt ${attempt + 1}/${maxRetries + 1})...`);
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                }

                const { data, error } = await this.supabase.functions.invoke(functionName, { body });

                if (error) {
                    // Check if it's a cold start / network error worth retrying
                    const isRetryableError = error.message?.includes('Failed to send') ||
                                            error.message?.includes('Failed to fetch') ||
                                            error.name === 'FunctionsFetchError';

                    if (isRetryableError && attempt < maxRetries) {
                        console.warn(`⚠️ ${label} failed (likely cold start), will retry...`);
                        lastError = error;
                        continue;
                    }

                    // Not retryable or max retries reached
                    console.error(`❌ ${label} error:`, error);
                    if (error.message?.includes('Failed to send')) {
                        throw new Error(`${label} failed: Edge Function '${functionName}' is not reachable. Please ensure it's deployed: supabase functions deploy ${functionName}`);
                    }
                    throw new Error(`${label} failed: ${error.message || JSON.stringify(error)}`);
                }

                if (!data || !data.success) {
                    throw new Error(`${label} failed: ${data?.error || 'Unknown error'}`);
                }

                if (attempt > 0) {
                    console.log(`✅ ${label} succeeded on retry attempt ${attempt + 1}`);
                }

                return data;
            } catch (error) {
                lastError = error;
                if (attempt >= maxRetries) {
                    throw error;
                }
            }
        }

        throw lastError;
    }

    /**
     * Trigger Mixpanel sync via Supabase Edge Functions (three-part process)
     * Part 1: sync-mixpanel-users (subscribers data - large dataset)
     * Part 2: sync-mixpanel-funnels (time funnels only) - CURRENTLY DISABLED
     * Part 3: sync-mixpanel-engagement (views, subscriptions, copies + trigger analyses)
     * Replaces: triggerGitHubWorkflow() + waitForWorkflowCompletion()
     * Note: Credentials are stored in Supabase secrets, not passed from frontend
     */
    async triggerMixpanelSync() {
        console.log('🔄 Starting Mixpanel sync (3-part process)...');

        try {
            // Part 1: Sync users/subscribers data (with retry for cold starts)
            console.log('📊 Step 1/3: Syncing user/subscriber data...');
            const usersData = await this.invokeFunctionWithRetry('sync-mixpanel-users', {}, 'Users sync');

            console.log('✅ Step 1/3 complete: User data synced successfully');
            console.log('   Stats:', usersData.stats);

            // Part 2: Sync funnels (TEMPORARILY DISABLED - revisit later)
            // Funnels uses 3 concurrent queries internally which can cause rate limits
            // console.log('⏱️ Step 2/4: Syncing funnels...');
            // const { data: funnelsData, error: funnelsError } = await this.supabase.functions.invoke('sync-mixpanel-funnels', {
            //     body: {}
            // });
            //
            // // Check funnels result
            // if (funnelsError) {
            //     console.error('❌ Funnels sync error:', funnelsError);
            //     if (funnelsError.message?.includes('Failed to send')) {
            //         throw new Error(`Funnels sync failed: Edge Function 'sync-mixpanel-funnels' is not reachable. Please ensure it's deployed: supabase functions deploy sync-mixpanel-funnels`);
            //     }
            //     throw new Error(`Funnels sync failed: ${funnelsError.message || JSON.stringify(funnelsError)}`);
            // }
            // if (!funnelsData || !funnelsData.success) {
            //     throw new Error(`Funnels sync failed: ${funnelsData?.error || 'Unknown error'}`);
            // }
            // console.log('✅ Step 2/4 complete: Time funnels synced successfully');
            // console.log('   Stats:', funnelsData.stats);
            console.log('⏭️ Step 2/4: Funnels sync temporarily disabled');
            const funnelsData = { stats: { skipped: true } };

            // Part 3: Sync engagement (with retry for cold starts)
            // Engagement uses 4 concurrent queries internally
            console.log('📊 Step 3/3: Syncing engagement...');
            const engagementData = await this.invokeFunctionWithRetry('sync-mixpanel-engagement', {}, 'Engagement sync');

            console.log('✅ Step 3/3 complete: Engagement data synced successfully');
            console.log('   Stats:', engagementData.stats);

            // REMOVED: Portfolio events sync (Step 4) - portfolio_view_events table was never read from
            // This step wrote to an unused table and made additional Mixpanel API calls
            // Removed as part of performance optimization to save 30-60s per sync

            // Note: Pattern analyses are triggered by sync-mixpanel-engagement (fire-and-forget)

            console.log('🎉 Full Mixpanel sync completed successfully!');

            // Invalidate all cached queries since data has been refreshed
            this.invalidateCache();

            // Return combined stats
            return {
                success: true,
                message: 'Full Mixpanel sync completed successfully',
                users: usersData.stats,
                funnels: funnelsData.stats,
                engagement: engagementData.stats
            };
        } catch (error) {
            console.error('❌ Error during Mixpanel sync:', error);
            throw error;
        }
    }

    /**
     * Load data from Supabase database
     * Replaces: loadGitHubData() - instead of fetching CSV files from GitHub
     */
    async loadDataFromSupabase() {
        console.log('Loading data from Supabase...');

        try {
            // IMPORTANT: We must paginate to ensure we get ALL records
            // Using .limit() alone can miss records or get duplicates without ordering
            let allData = [];
            let page = 0;
            const pageSize = 1000;
            let hasMore = true;

            while (hasMore) {
                const { data, error } = await this.supabase
                    .from('main_analysis')
                    .select('*')
                    .range(page * pageSize, (page + 1) * pageSize - 1);

                if (error) {
                    console.error('Supabase query error:', error);
                    throw error;
                }

                if (data && data.length > 0) {
                    allData = allData.concat(data);
                    console.log(`✅ Loaded page ${page + 1}: ${data.length} records (total: ${allData.length})`);
                    hasMore = data.length === pageSize; // Continue if we got a full page
                    page++;
                } else {
                    hasMore = false;
                }
            }

            console.log(`✅ Finished loading ${allData.length} total records from Supabase`);

            // Convert to CSV format for compatibility with existing analysis code
            return this.convertToCSVFormat(allData);
        } catch (error) {
            console.error('Error loading data from Supabase:', error);
            throw error;
        }
    }

    /**
     * Get latest sync status
     */
    async getLatestSyncStatus() {
        try {
            const { data, error } = await this.supabase
                .from('latest_sync_status')
                .select('*')
                .single();

            if (error) {
                console.error('Error fetching sync status:', error);
                return null;
            }

            return data;
        } catch (error) {
            console.error('Error getting sync status:', error);
            return null;
        }
    }

    /**
     * Get data freshness info
     */
    async getDataFreshness() {
        try {
            const { data, error } = await this.supabase
                .from('data_freshness')
                .select('*')
                .single();

            if (error) {
                console.error('Error fetching data freshness:', error);
                return null;
            }

            return data;
        } catch (error) {
            console.error('Error getting data freshness:', error);
            return null;
        }
    }

    /**
     * Convert Supabase JSON data to CSV format
     * This maintains compatibility with existing analysis functions
     */
    convertToCSVFormat(data) {
        if (!data || data.length === 0) {
            return ['', '', '', '']; // Return empty CSV strings for 4 files (only first is used)
        }

        // Create comprehensive subscribers CSV with all metrics
        // Time funnel data is no longer used, but we return empty strings for compatibility
        const subscribersCSV = this.createSubscribersCSV(data);

        return [subscribersCSV, '', '', ''];
    }

    /**
     * Create subscribers insights CSV
     */
    createSubscribersCSV(data) {
        const headers = [
            '$distinct_id',
            'A. Linked Bank Account',
            'income',
            'netWorth',
            'availableCopyCredits',
            'buyingPower',
            'activeCreatedPortfolios',
            'lifetimeCreatedPortfolios',
            'totalWithdrawalCount',
            'totalWithdrawals',
            'investingActivity',
            'investingExperienceYears',
            'investingObjective',
            'investmentType',
            'acquisitionSurvey',
            'B. Total Deposits ($)',
            'C. Total Deposit Count',
            'E. Total Copies',
            'G. Total Premium Copies',
            'H. Regular PDP Views',
            'I. Premium PDP Views',
            'L. Premium Creator Profile Views',
            'N. App Sessions',
            'O. Discover Tab Views',
            'P. Leaderboard Tab Views',
            'Q. Premium Tab Views',
            'D. Subscribed within 7 days',
            'F. Total Regular Copies',
            'J. Paywall Views',
            'K. Regular Creator Profile Views',
            'M. Total Subscriptions',
            'R. Stripe Modal Views',
            'S. Creator Card Taps',
            'T. Portfolio Card Taps',
            // Additional calculated fields that the analysis expects
            'Total Stripe Views',
            'Unique Creators Interacted',
            'Unique Portfolios Interacted',
            'Total Profile Views',
            'Total PDP Views'
        ];

        const rows = data.map(row => [
            row.distinct_id || '',
            row.linked_bank_account ? '1' : '0',
            row.income || '',
            row.net_worth || '',
            row.available_copy_credits || 0,
            row.buying_power || 0,
            row.active_created_portfolios || 0,
            row.lifetime_created_portfolios || 0,
            row.total_withdrawal_count || 0,
            row.total_withdrawals || 0,
            row.investing_activity || '',
            row.investing_experience_years || '',
            row.investing_objective || '',
            row.investment_type || '',
            row.acquisition_survey || '',
            row.total_deposits || 0,
            row.total_deposit_count || 0,
            row.total_copies || 0,
            row.total_premium_copies || 0,
            row.regular_pdp_views || 0,
            row.premium_pdp_views || 0,
            row.premium_creator_profile_views || 0,
            row.app_sessions || 0,
            row.discover_tab_views || 0,
            row.leaderboard_tab_views || 0,
            row.premium_tab_views || 0,
            row.subscribed_within_7_days ? '1' : '0',
            row.total_regular_copies || 0,
            row.paywall_views || 0,
            row.regular_creator_profile_views || 0,
            row.total_subscriptions || 0,
            row.stripe_modal_views || 0,
            row.creator_card_taps || 0,
            row.portfolio_card_taps || 0,
            // Additional calculated fields from main_analysis view
            row.stripe_modal_views || 0, // Total Stripe Views = R. Stripe Modal Views
            row.unique_creators_viewed || 0, // Unique Creators Interacted (from main_analysis aggregation)
            row.unique_portfolios_viewed || 0, // Unique Portfolios Interacted (from main_analysis aggregation)
            row.total_profile_views || ((row.regular_creator_profile_views || 0) + (row.premium_creator_profile_views || 0)), // Total Profile Views
            row.total_pdp_views || ((row.regular_pdp_views || 0) + (row.premium_pdp_views || 0)) // Total PDP Views
        ]);

        return this.arrayToCSV(headers, rows);
    }

    /**
     * DEPRECATED: Create time funnel CSV
     * Time funnel data is no longer collected or used in analysis
     * This function is kept for reference only
     */
    createTimeFunnelCSV(data, timeField, funnelName) {
        // No longer used - time_funnels table removed from schema
        return '';
    }

    /**
     * Helper: Convert array data to CSV string
     */
    arrayToCSV(headers, rows) {
        const csvRows = [headers.join(',')];

        rows.forEach(row => {
            const escapedRow = row.map(value => {
                const strValue = String(value ?? '');
                // Escape values containing commas or quotes
                if (strValue.includes(',') || strValue.includes('"')) {
                    return `"${strValue.replace(/"/g, '""')}"`;
                }
                return strValue;
            });
            csvRows.push(escapedRow.join(','));
        });

        return csvRows.join('\n');
    }

    // ========================================================================
    // CREATOR ANALYSIS METHODS
    // ========================================================================

    /**
     * Trigger Creator data sync via Supabase Edge Function
     * Fetches creator insights, portfolio copies, and profile subscriptions
     */
    async triggerCreatorSync() {
        console.log('Triggering Creator sync via Supabase Edge Functions...');

        try {
            // Call sync-creator-data function
            console.log('Syncing creator data...');
            const creatorDataResult = await this.supabase.functions.invoke('sync-creator-data', { body: {} });

            // Check creator data sync
            if (creatorDataResult.error) {
                console.error('Creator data sync error:', creatorDataResult.error);
                throw new Error(`Creator sync failed: ${creatorDataResult.error.message}`);
            }

            if (!creatorDataResult.data.success) {
                throw new Error(creatorDataResult.data.error || 'Unknown error during creator sync');
            }

            console.log('✅ Creator data sync completed:', creatorDataResult.data.stats);

            return {
                creatorData: creatorDataResult.data
            };
        } catch (error) {
            console.error('Error calling Creator sync Edge Functions:', error);
            throw error;
        }
    }

    /**
     * Load creator data from Supabase database
     * Queries the creators_insights table
     */
    async loadCreatorDataFromSupabase() {
        console.log('Loading creator data from creator_analysis view...');

        try {
            // Load all creators from the creator_analysis view
            // This view automatically joins uploaded_creators with creators_insights
            const { data, error } = await this.supabase
                .from('creator_analysis')
                .select('*');

            if (error) {
                console.error('Supabase query error:', error);
                throw error;
            }

            if (!data || data.length === 0) {
                throw new Error('No creator data found in creator_analysis view. Please upload creator files first.');
            }

            console.log(`✅ Loaded ${data.length} creator records from creator_analysis view`);
            console.log(`Sample row structure:`, data[0] ? {
                id: data[0].id,
                email: data[0].email,
                type: data[0].type,
                total_copies: data[0].total_copies,
                total_subscriptions: data[0].total_subscriptions,
                raw_data_keys: data[0].raw_data ? Object.keys(data[0].raw_data) : []
            } : 'No data');

            // Return data directly (no CSV conversion needed)
            return data;
        } catch (error) {
            console.error('Error loading creator data from Supabase:', error);
            throw error;
        }
    }

    /**
     * Get latest creator sync status
     */
    async getLatestCreatorSyncStatus() {
        try {
            const { data, error } = await this.supabase
                .from('latest_sync_status')
                .select('*')
                .eq('tool_type', 'creator')
                .single();

            if (error) {
                console.error('Error fetching creator sync status:', error);
                return null;
            }

            return data;
        } catch (error) {
            console.error('Error getting creator sync status:', error);
            return null;
        }
    }

    /**
     * Trigger subscription price analysis via Supabase Edge Function
     * Fetches and analyzes subscription pricing data from Mixpanel
     */
    async triggerSubscriptionPriceAnalysis() {
        console.log('Triggering subscription price analysis via Supabase Edge Function...');

        try {
            // Call the Edge Function (no credentials needed - they're in Supabase secrets)
            const { data, error } = await this.supabase.functions.invoke('analyze-subscription-price', {
                body: {}
            });

            if (error) {
                console.error('Edge Function error:', error);
                throw new Error(`Subscription price analysis failed: ${error.message}`);
            }

            if (!data.success) {
                throw new Error(data.error || 'Unknown error during subscription price analysis');
            }

            console.log('✅ Subscription price analysis completed successfully:', data.stats);
            return data;
        } catch (error) {
            console.error('Error calling subscription price analysis Edge Function:', error);
            throw error;
        }
    }

    /**
     * Load subscription price distribution data
     * Returns data grouped by normalized monthly price
     */
    async loadSubscriptionDistribution() {
        return this.cachedQuery('subscription_distribution', async () => {
            console.log('Loading subscription price distribution...');

            try {
                const { data, error } = await this.supabase
                    .from('latest_subscription_distribution')
                    .select('*')
                    .order('monthly_price');

                if (error) {
                    console.error('Error loading subscription distribution:', error);
                    throw error;
                }

                console.log(`✅ Loaded ${data.length} price points`);
                return data;
            } catch (error) {
                console.error('Error loading subscription distribution:', error);
                throw error;
            }
        });
    }

    /**
     * Load subscription conversion analysis data
     * Returns conversion rates by profile views and PDP views buckets
     */
    async loadSubscriptionConversionAnalysis() {
        console.log('Loading subscription conversion analysis...');

        try {
            const { data, error } = await this.supabase
                .from('subscription_conversion_by_engagement')
                .select('*');

            if (error) {
                console.error('Error loading conversion analysis:', error);
                throw error;
            }

            console.log(`✅ Loaded ${data.length} conversion data points`);
            return data;
        } catch (error) {
            console.error('Error loading conversion analysis:', error);
            throw error;
        }
    }

    /**
     * Trigger event sequence sync via Supabase Edge Function
     * Fetches user event sequences from Mixpanel and joins with conversion outcomes
     */
    async triggerEventSequenceSync() {
        console.log('Triggering event sequence sync via Supabase Edge Function...');

        try {
            const { data, error } = await this.supabase.functions.invoke('sync-event-sequences', {
                body: {}
            });

            if (error) {
                console.error('Edge Function error:', error);
                throw new Error(`Event sequence sync failed: ${error.message}`);
            }

            if (!data.success) {
                throw new Error(data.error || 'Unknown error during event sequence sync');
            }

            console.log('✅ Event sequence sync completed successfully:', data.stats);
            return data;
        } catch (error) {
            console.error('Error calling event sequence sync Edge Function:', error);
            throw error;
        }
    }

    // REMOVED: triggerEventSequenceEnrichment() - enrichment step removed from workflow
    // The enrich-event-sequences edge function is no longer called
    // Removed as part of performance optimization (saves 30-60s + 2 Mixpanel API calls)

    /**
     * Trigger event sequence processing via Supabase Edge Function
     * Processes raw event sequences and joins with conversion outcomes
     */
    async triggerEventSequenceProcessing() {
        console.log('Triggering event sequence processing...');

        try {
            const { data, error } = await this.supabase.functions.invoke('process-event-sequences', {
                body: {}
            });

            if (error) {
                console.error('Edge Function error:', error);
                throw new Error(`Event sequence processing failed: ${error.message}`);
            }

            if (!data.success) {
                throw new Error(data.error || 'Unknown error during event sequence processing');
            }

            console.log('✅ Event sequence processing completed:', data.stats);
            return data;
        } catch (error) {
            console.error('Error calling event sequence processing Edge Function:', error);
            throw error;
        }
    }

    /**
     * Trigger event sequence analysis via Supabase Edge Function with Claude AI
     * @param {string} outcomeType - Either 'copies' or 'subscriptions'
     */
    async triggerEventSequenceAnalysis(outcomeType) {
        console.log(`Triggering event sequence analysis for ${outcomeType}...`);

        try {
            const { data, error } = await this.supabase.functions.invoke('analyze-event-sequences', {
                body: { outcome_type: outcomeType }
            });

            if (error) {
                console.error('Edge Function error:', error);
                throw new Error(`Event sequence analysis failed: ${error.message}`);
            }

            if (!data.success) {
                throw new Error(data.error || 'Unknown error during event sequence analysis');
            }

            console.log(`✅ Event sequence analysis for ${outcomeType} completed:`, data.stats);
            return data;
        } catch (error) {
            console.error('Error calling event sequence analysis Edge Function:', error);
            throw error;
        }
    }

    /**
     * Load latest event sequence analysis results from database
     * @param {string} outcomeType - Either 'copies' or 'subscriptions'
     */
    async loadEventSequenceAnalysis(outcomeType) {
        const cacheKey = `event_sequence_${outcomeType}`;

        return this.cachedQuery(cacheKey, async () => {
            console.log(`Loading event sequence analysis for ${outcomeType}...`);

            try {
                const { data, error } = await this.supabase
                    .from('event_sequence_analysis')
                    .select('*')
                    .eq('analysis_type', outcomeType)
                    .order('generated_at', { ascending: false })
                    .limit(1)
                    .single();

                if (error) {
                    console.warn(`No sequence analysis found for ${outcomeType}:`, error);
                    return null;
                }

                console.log(`✅ Loaded sequence analysis for ${outcomeType}`);

                return {
                    predictive_sequences: data.predictive_sequences || [],
                    critical_triggers: data.critical_triggers || [],
                    anti_patterns: data.anti_patterns || [],
                    summary: data.summary || '',
                    top_recommendations: data.recommendations || []
                };
            } catch (error) {
                console.error(`Error loading sequence analysis for ${outcomeType}:`, error);
                return null;
            }
        });
    }

    /**
     * Load engagement summary statistics
     * Returns summary comparing subscribers vs non-subscribers
     */
    async loadEngagementSummary() {
        return this.cachedQuery('engagement_summary', async () => {
            console.log('Loading engagement summary...');

            try {
                const { data, error } = await this.supabase
                    .from('subscription_engagement_summary')
                    .select('*');

                if (error) {
                    console.error('Error loading engagement summary:', error);
                    throw error;
                }

                console.log(`✅ Loaded engagement summary`);
                return data;
            } catch (error) {
                console.error('Error loading engagement summary:', error);
                throw error;
            }
        });
    }

    /**
     * Trigger subscription pattern analysis via Edge Function
     * Runs exhaustive search + logistic regression to find best creator combinations
     */
    async triggerSubscriptionAnalysis() {
        console.log('Triggering subscription pattern analysis...');

        try {
            const { data, error } = await this.supabase.functions.invoke('analyze-subscription-patterns', {
                body: {}
            });

            if (error) {
                console.error('Edge Function error:', error);
                throw new Error(`Subscription analysis failed: ${error.message}`);
            }

            if (!data.success) {
                throw new Error(data.error || 'Unknown error during subscription analysis');
            }

            console.log('✅ Subscription analysis completed successfully:', data.stats);
            return data;
        } catch (error) {
            console.error('Error calling subscription analysis Edge Function:', error);
            throw error;
        }
    }

    /**
     * Generic function to load top combinations for any analysis type (DRY)
     * @param {string} analysisType - 'subscription', 'copy', or 'portfolio_sequence'
     * @param {string} metric - 'lift', 'aic', 'precision', or 'odds_ratio'
     * @param {number} limit - Number of results to return
     * @param {boolean} mapUsernames - Whether to map creator IDs to usernames
     */
    async loadTopCombinations(analysisType, metric = 'lift', limit = 20, mapUsernames = false, minExposure = 20) {
        // Create cache key from parameters
        const cacheKey = `combinations_${analysisType}_${metric}_${limit}_${mapUsernames}_${minExposure}`;

        return this.cachedQuery(cacheKey, async () => {
            console.log(`Loading top ${analysisType} combinations by ${metric} (min ${minExposure} users exposed)...`);

            try {
                let query = this.supabase
                    .from('conversion_pattern_combinations')
                    .select('*')
                    .eq('analysis_type', analysisType)
                    .gte('users_with_exposure', minExposure); // Filter: only combinations with enough users

                // Sort by the requested metric (skip database sort for expected_value)
                if (metric !== 'expected_value') {
                    switch (metric) {
                        case 'lift':
                            query = query.order('lift', { ascending: false });
                            break;
                        case 'aic':
                            query = query.order('aic', { ascending: true }); // Lower AIC is better
                            break;
                        case 'precision':
                            query = query.order('precision', { ascending: false });
                            break;
                        case 'odds_ratio':
                            query = query.order('odds_ratio', { ascending: false });
                            break;
                        default:
                            query = query.order('combination_rank', { ascending: true });
                    }
                }

                const { data, error } = await query;

                if (error) {
                    console.error(`Error loading ${analysisType} combinations:`, error);
                    throw error;
                }

                // If sorting by expected_value, calculate it client-side and sort
                // (since it's a computed column that doesn't exist in the database)
                let sortedData = data || [];
                if (metric === 'expected_value' && sortedData.length > 0) {
                    sortedData = sortedData.map(combo => ({
                        ...combo,
                        expected_value: combo.lift * (combo.total_conversions || 0)
                    })).sort((a, b) => b.expected_value - a.expected_value);
                }

                // Apply limit after sorting
                sortedData = sortedData.slice(0, limit);

                console.log(`✅ Loaded ${sortedData.length} ${analysisType} combinations (minExposure=${minExposure})`);

                // Debug: show filter values if no data returned
                if (sortedData.length === 0) {
                    console.warn(`No ${analysisType} combinations found. Query filters:`, {
                        analysis_type: analysisType,
                        minExposure: minExposure,
                        limit: limit,
                        metric: metric
                    });
                }

                // Usernames are now stored directly in the table by the analysis function
                // No runtime mapping needed - username_1, username_2, username_3 columns are populated
                if (mapUsernames && sortedData.length > 0) {
                    console.log(`Combinations include usernames from database`);
                    console.log('Sample combo:', {
                        value_1: sortedData[0].value_1,
                        username_1: sortedData[0].username_1,
                        value_2: sortedData[0].value_2,
                        username_2: sortedData[0].username_2
                    });
                }

                return sortedData;
            } catch (error) {
                console.error(`Error loading ${analysisType} combinations:`, error);
                throw error;
            }
        });
    }

    /**
     * Load top subscription combinations (wrapper for backwards compatibility)
     */
    async loadTopSubscriptionCombinations(metric = 'lift', limit = 20, minExposure = 20) {
        return this.loadTopCombinations('subscription', metric, limit, true, minExposure);
    }

    /**
     * Load copy conversion analysis data
     * Returns conversion rates by profile views and PDP views buckets
     */
    async loadCopyConversionAnalysis() {
        console.log('Loading copy conversion analysis...');

        try {
            const { data, error } = await this.supabase
                .from('copy_conversion_by_engagement')
                .select('*');

            if (error) {
                console.error('Error loading copy conversion analysis:', error);
                throw error;
            }

            console.log(`✅ Loaded ${data.length} copy conversion data points`);
            return data;
        } catch (error) {
            console.error('Error loading copy conversion analysis:', error);
            throw error;
        }
    }

    /**
     * Load copy engagement summary statistics
     * Returns summary comparing copiers vs non-copiers
     */
    async loadCopyEngagementSummary() {
        return this.cachedQuery('copy_engagement_summary', async () => {
            console.log('Loading copy engagement summary...');

            try {
                const { data, error } = await this.supabase
                    .from('copy_engagement_summary')
                    .select('*');

                if (error) {
                    console.error('Error loading copy engagement summary:', error);
                    throw error;
                }

                console.log(`✅ Loaded copy engagement summary`);
                return data;
            } catch (error) {
                console.error('Error loading copy engagement summary:', error);
                throw error;
            }
        });
    }

    /**
     * Trigger copy pattern analysis via Edge Function
     * Runs exhaustive search + logistic regression to find best creator combinations
     */
    async triggerCopyAnalysis() {
        console.log('Triggering copy pattern analysis...');

        try {
            const { data, error } = await this.supabase.functions.invoke('analyze-copy-patterns', {
                body: {}
            });

            if (error) {
                console.error('Edge Function error:', error);
                throw new Error(`Copy analysis failed: ${error.message}`);
            }

            if (!data.success) {
                throw new Error(data.error || 'Unknown error during copy analysis');
            }

            console.log('✅ Copy analysis completed successfully:', data.stats);
            return data;
        } catch (error) {
            console.error('Error calling copy analysis Edge Function:', error);
            throw error;
        }
    }

    /**
     * Load top copy combinations (wrapper for backwards compatibility)
     */
    async loadTopCopyCombinations(metric = 'lift', limit = 20, minExposure = 20) {
        return this.loadTopCombinations('copy', metric, limit, false, minExposure);
    }

    /**
     * Load top creator copy combinations
     * Analyzes which creator profile view combinations drive copies
     */
    async loadTopCreatorCopyCombinations(metric = 'lift', limit = 20, minExposure = 20) {
        return this.loadTopCombinations('creator_copy', metric, limit, true, minExposure);
    }


    /**
     * Load hidden gems portfolios
     * Returns portfolios with high engagement but low copy conversion
     */
    async loadHiddenGems() {
        return this.cachedQuery('hidden_gems_portfolios', async () => {
            console.log('Loading hidden gems portfolios...');

            try {
                const { data, error } = await this.supabase
                    .from('hidden_gems_portfolios')
                    .select('*')
                    .order('total_pdp_views', { ascending: false })
                    .limit(50);

                if (error) {
                    console.error('Error loading hidden gems:', error);
                    throw error;
                }

                console.log(`✅ Loaded ${data.length} hidden gems portfolios`);
                return data;
            } catch (error) {
                console.error('Error loading hidden gems:', error);
                throw error;
            }
        });
    }


    // Portfolio sequence analysis removed - not used in UI
    // Function and edge function deleted

    /**
     * Load top portfolio sequence combinations (wrapper for backwards compatibility)
     */
    async loadTopPortfolioSequenceCombinations(metric = 'lift', limit = 20, minExposure = 20) {
        return this.loadTopCombinations('portfolio_sequence', metric, limit, false, minExposure);
    }


    /**
     * Convert Supabase creator JSON data to CSV format
     * This maintains compatibility with the creator analysis functions
     */
    convertCreatorDataToCSVFormat(data) {
        if (!data || data.length === 0) {
            return ['', '', '']; // Return empty CSV strings for 3 files
        }

        // The creator_analysis view already has everything aggregated,
        // but we'll create a main CSV that contains all the data the analysis tool needs

        const creatorCSV = this.createCreatorAnalysisCSV(data);

        // Return array with single CSV (creator analysis tool will handle it differently than user tool)
        return [creatorCSV];
    }

    /**
     * Create creator analysis CSV from uploaded_creators data
     * Takes raw_data JSONB and adds total_copies + total_subscriptions columns
     */
    createCreatorAnalysisCSV(data) {
        if (!data || data.length === 0) {
            return '';
        }

        // Collect all unique keys from raw_data JSONB
        // Note: Mixpanel fields are already merged into raw_data by the creator_analysis view
        const allKeys = new Set();
        let mixpanelEnrichedCount = 0;

        data.forEach(row => {
            // Add all keys from raw_data JSONB (includes both uploaded fields and Mixpanel enrichment)
            if (row.raw_data) {
                Object.keys(row.raw_data).forEach(key => allKeys.add(key));

                // Check if this row has Mixpanel enrichment
                if (row.raw_data.totalDeposits !== undefined || row.raw_data.totalTrades !== undefined) {
                    mixpanelEnrichedCount++;
                }
            }
        });

        console.log(`📊 Creator Analysis CSV Generation:`);
        console.log(`  - Total creators: ${data.length}`);
        console.log(`  - Creators with Mixpanel enrichment: ${mixpanelEnrichedCount}`);
        console.log(`  - Total unique fields in raw_data: ${allKeys.size}`);
        console.log(`  - Fields:`, Array.from(allKeys).sort());

        // Build headers: type + all raw_data fields + total_copies + total_subscriptions
        // Note: 'type' is a top-level column in the view, not inside raw_data
        const allFieldKeys = Array.from(allKeys).sort();
        const headers = ['type', ...allFieldKeys, 'total_copies', 'total_subscriptions'];

        // Build rows
        const rows = data.map(row => {
            const rawData = row.raw_data || {};

            // Start with type column (top-level from view)
            const rowData = [row.type || 'Regular'];

            // Extract all fields from raw_data (which includes both uploaded and Mixpanel-enriched fields)
            allFieldKeys.forEach(key => {
                const value = rawData[key];
                // Return the value if it exists, otherwise empty string
                rowData.push((value !== undefined && value !== null) ? value : '');
            });

            // Add target variables (these are top-level columns from the view, NOT in raw_data)
            rowData.push(row.total_copies || 0);
            rowData.push(row.total_subscriptions || 0);

            return rowData;
        });

        return this.arrayToCSV(headers, rows);
    }

    /**
     * Upload and enrich creator data
     * Calls RPC function to join with existing creators_insights and upsert
     *
     * @param {Array} creatorData - Array of cleaned creator objects with creator_id, creator_username, raw_data
     * @returns {Promise} - { success: true, stats: { uploaded: N, enriched: N } }
     */
    /**
     * Upload and merge 3 creator CSV files
     * Calls upload-and-merge-creator-files Edge Function
     */
    async uploadAndMergeCreatorFiles(creatorListCsv, dealsCsv, publicCreatorsCsv) {
        try {
            console.log('Uploading and merging 3 creator files via Edge Function...');

            const { data, error } = await this.supabase.functions.invoke('upload-and-merge-creator-files', {
                body: {
                    creatorListCsv,
                    dealsCsv,
                    publicCreatorsCsv
                }
            });

            if (error) {
                console.error('Edge Function error:', error);
                throw new Error(`Failed to merge creator files: ${error.message}`);
            }

            if (!data.success) {
                throw new Error(data.error || 'Unknown error during file merge');
            }

            console.log('✅ Creator files merged successfully:', data.stats);
            return data;
        } catch (error) {
            console.error('Error calling upload-and-merge Edge Function:', error);
            throw error;
        }
    }

    /**
     * Load premium creator copy affinity data
     * Returns which creators are most frequently copied by users who copied each Premium creator
     */
    async loadPremiumCreatorCopyAffinity() {
        return this.cachedQuery('premium_creator_copy_affinity_pivoted', async () => {
            console.log('Loading premium creator copy affinity...');

            try {
                const { data, error } = await this.supabase
                    .from('premium_creator_copy_affinity_pivoted')
                    .select('*')
                    .order('premium_creator', { ascending: true });

                if (error) {
                    console.error('Error loading premium creator copy affinity:', error);
                    throw error;
                }

                console.log(`✅ Loaded ${data.length} premium creator affinity records`);
                return data;
            } catch (error) {
                console.error('Error loading premium creator copy affinity:', error);
                throw error;
            }
        });
    }

    /**
     * DEPRECATED: Old single-file upload method
     * Kept for backward compatibility
     */
    async uploadAndEnrichCreatorData(creatorData) {
        console.warn('uploadAndEnrichCreatorData is deprecated. Use uploadAndMergeCreatorFiles instead.');

        if (!creatorData || creatorData.length === 0) {
            throw new Error('No creator data to upload');
        }

        try {
            console.log(`Uploading ${creatorData.length} creator records...`);

            // Step 1: Call RPC function to enrich data with existing metrics
            const { data: enrichedData, error: rpcError } = await this.supabase
                .rpc('upload_creator_data', {
                    creator_data: creatorData.map(c => ({
                        creator_id: c.creator_id,
                        creator_username: c.creator_username,
                        raw_data: c.raw_data
                    }))
                });

            if (rpcError) {
                console.error('RPC error:', rpcError);
                throw new Error(`Failed to enrich creator data: ${rpcError.message}`);
            }

            console.log(`Enriched ${enrichedData.length} creator records`);

            // Step 2: Insert enriched data into uploaded_creators table
            // Keep it simple: raw_data + total_copies + total_subscriptions
            const upsertData = enrichedData.map(row => ({
                creator_id: row.creator_id,
                creator_username: row.creator_username,
                raw_data: row.raw_data,
                total_copies: row.total_copies || 0,
                total_subscriptions: row.total_subscriptions || 0
            }));

            const { error: insertError } = await this.supabase
                .from('uploaded_creators')
                .insert(upsertData);

            if (insertError) {
                console.error('Insert error:', insertError);
                throw new Error(`Failed to upload creator data: ${insertError.message}`);
            }

            console.log(`✅ Uploaded ${upsertData.length} creator records to uploaded_creators table`);

            return {
                success: true,
                stats: {
                    uploaded: upsertData.length,
                    enriched: enrichedData.length
                }
            };
        } catch (error) {
            console.error('Upload and enrich error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // ========================================================================
    // DEPRECATED METHODS
    // ========================================================================

    /**
     * DEPRECATED: Credentials are now stored in Supabase secrets
     * These methods are kept for backward compatibility but are no longer used
     */
    hasMixpanelCredentials() {
        console.warn('Credentials are now stored in Supabase secrets, not localStorage');
        return true; // Always return true since they're in Supabase
    }

    getMixpanelCredentials() {
        console.warn('Credentials are now stored in Supabase secrets, not localStorage');
        return { username: '', secret: '' };
    }

    saveMixpanelCredentials(username, secret) {
        console.warn('Credentials should be set via Supabase CLI: supabase secrets set MIXPANEL_SERVICE_USERNAME=xxx');
    }

    clearMixpanelCredentials() {
        console.warn('Credentials are stored in Supabase secrets and cannot be cleared from frontend');
    }
}

// Export to window for global access
window.SupabaseIntegration = SupabaseIntegration;

console.log('✅ Supabase Integration module loaded');
