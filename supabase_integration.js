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
     * Trigger Mixpanel sync via Supabase Edge Functions (four-part process)
     * Part 1: sync-mixpanel-users (subscribers data - large dataset)
     * Part 2: sync-mixpanel-funnels (time funnels only)
     * Part 3: sync-mixpanel-engagement (views, subscriptions, copies + trigger analyses)
     * Part 4: sync-mixpanel-portfolio-events (raw portfolio view events - high volume)
     * Replaces: triggerGitHubWorkflow() + waitForWorkflowCompletion()
     * Note: Credentials are stored in Supabase secrets, not passed from frontend
     */
    async triggerMixpanelSync() {
        console.log('🔄 Starting Mixpanel sync (4-part process)...');

        try {
            // Part 1: Sync users/subscribers data
            console.log('📊 Step 1/4: Syncing user/subscriber data...');
            const { data: usersData, error: usersError } = await this.supabase.functions.invoke('sync-mixpanel-users', {
                body: {}
            });

            if (usersError) {
                console.error('❌ Users sync error:', usersError);
                console.error('Error details:', {
                    message: usersError.message,
                    context: usersError.context,
                    name: usersError.name
                });

                // Provide more specific error messages
                if (usersError.message?.includes('Failed to send')) {
                    throw new Error(`Users sync failed: Edge Function 'sync-mixpanel-users' is not reachable. Please ensure it's deployed: supabase functions deploy sync-mixpanel-users`);
                }

                throw new Error(`Users sync failed: ${usersError.message || JSON.stringify(usersError)}`);
            }

            if (!usersData || !usersData.success) {
                throw new Error(`Users sync failed: ${usersData?.error || 'Unknown error'}`);
            }

            console.log('✅ Step 1/4 complete: User data synced successfully');
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

            // Part 3: Sync engagement
            // Engagement uses 4 concurrent queries internally
            console.log('📊 Step 3/4: Syncing engagement...');
            const { data: engagementData, error: engagementError } = await this.supabase.functions.invoke('sync-mixpanel-engagement', {
                body: {}
            });

            // Check engagement result
            if (engagementError) {
                console.error('❌ Engagement sync error:', engagementError);
                if (engagementError.message?.includes('Failed to send')) {
                    throw new Error(`Engagement sync failed: Edge Function 'sync-mixpanel-engagement' is not reachable. Please ensure it's deployed: supabase functions deploy sync-mixpanel-engagement`);
                }
                throw new Error(`Engagement sync failed: ${engagementError.message || JSON.stringify(engagementError)}`);
            }
            if (!engagementData || !engagementData.success) {
                throw new Error(`Engagement sync failed: ${engagementData?.error || 'Unknown error'}`);
            }
            console.log('✅ Step 3/4 complete: Engagement data synced successfully');
            console.log('   Stats:', engagementData.stats);

            // Part 4: Portfolio events (separate - uses different Insights chart)
            console.log('📊 Step 4/4: Syncing portfolio events...');
            const { data: portfolioData, error: portfolioError } = await this.supabase.functions.invoke('sync-mixpanel-portfolio-events', {
                body: {}
            });

            // Check portfolio result (non-blocking - will use existing data if fails)
            if (portfolioError) {
                console.warn('⚠️ Portfolio events sync error (continuing with existing data):', portfolioError);
                portfolioData = { stats: { skipped: true, reason: portfolioError.message || 'Unknown error' } };
            } else if (!portfolioData || !portfolioData.success) {
                console.warn('⚠️ Portfolio events sync failed (continuing with existing data):', portfolioData?.error || 'Unknown error');
                portfolioData = { stats: { skipped: true, reason: portfolioData?.error || 'Unknown error' } };
            } else {
                console.log('✅ Step 4/4 complete: Portfolio events synced successfully');
                console.log('   Stats:', portfolioData.stats);
            }

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
                engagement: engagementData.stats,
                portfolioEvents: portfolioData.stats || { skipped: true }
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
            return ['', '', '', '']; // Return empty CSV strings for 4 files
        }

        // We'll create a single comprehensive CSV that mimics the structure
        // of the merged data that processComprehensiveData() expects

        // Since main_analysis view already has everything joined,
        // we need to split it back into the 4 required files for compatibility

        const subscribersCSV = this.createSubscribersCSV(data);
        const timeToFirstCopyCSV = this.createTimeFunnelCSV(data, 'time_to_first_copy_days', 'Time to First Copy');
        const timeToFundedCSV = this.createTimeFunnelCSV(data, 'time_to_funded_account_days', 'Time to Funded Account');
        const timeToLinkedBankCSV = this.createTimeFunnelCSV(data, 'time_to_linked_bank_days', 'Time to Linked Bank');

        return [subscribersCSV, timeToFirstCopyCSV, timeToFundedCSV, timeToLinkedBankCSV];
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
            'Total Copy Starts',
            'Unique Creators Interacted',
            'Unique Portfolios Interacted'
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
            // Additional calculated fields (currently set to 0 as placeholder)
            // These match what user_analysis_tool.js lines 1008-1017 expect
            row.stripe_modal_views || 0, // Total Stripe Views = R. Stripe Modal Views
            0, // Total Copy Starts (no data source in user_analysis_tool.js either)
            0, // Unique Creators Interacted (no data source in user_analysis_tool.js either)
            0  // Unique Portfolios Interacted (no data source in user_analysis_tool.js either)
        ]);

        return this.arrayToCSV(headers, rows);
    }

    /**
     * Create time funnel CSV
     */
    createTimeFunnelCSV(data, timeField, funnelName) {
        const headers = ['Funnel', '$distinct_id', funnelName];

        const rows = data
            .filter(row => row[timeField] !== null && row[timeField] !== undefined)
            .map(row => [
                funnelName,
                row.distinct_id || '',
                row[timeField] || 0
            ]);

        return this.arrayToCSV(headers, rows);
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
        console.log('Triggering Creator sync via Supabase Edge Function...');

        try {
            // Call the Edge Function (no credentials needed - they're in Supabase secrets)
            const { data, error } = await this.supabase.functions.invoke('sync-creator-data', {
                body: {}
            });

            if (error) {
                console.error('Edge Function error:', error);
                throw new Error(`Creator sync failed: ${error.message}`);
            }

            if (!data.success) {
                throw new Error(data.error || 'Unknown error during creator sync');
            }

            console.log('✅ Creator sync completed successfully:', data.stats);
            return data;
        } catch (error) {
            console.error('Error calling Creator sync Edge Function:', error);
            throw error;
        }
    }

    /**
     * Load creator data from Supabase database
     * Queries the creator_analysis materialized view
     */
    async loadCreatorDataFromSupabase() {
        console.log('Loading creator data from Supabase...');

        try {
            // IMPORTANT: Paginate to ensure we get ALL records
            let allData = [];
            let page = 0;
            const pageSize = 1000;
            let hasMore = true;

            while (hasMore) {
                const { data, error } = await this.supabase
                    .from('creator_analysis')
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

            console.log(`✅ Finished loading ${allData.length} total creator records from Supabase`);

            // Convert to CSV format for compatibility with existing analysis code
            return this.convertCreatorDataToCSVFormat(allData);
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
     * Load subscription price distribution data
     * Returns data grouped by normalized monthly price
     */
    async loadSubscriptionDistribution() {
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

                // Sort by the requested metric
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
                    case 'expected_value':
                        query = query.order('expected_value', { ascending: false });
                        break;
                    default:
                        query = query.order('combination_rank', { ascending: true });
                }

                const { data, error } = await query;

                if (error) {
                    console.error(`Error loading ${analysisType} combinations:`, error);
                    throw error;
                }

                // If sorting by expected_value, calculate it client-side and re-sort
                // (since it's a computed column that may not exist in the database yet)
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
     * Load hidden gems portfolios
     * Returns portfolios with high engagement but low copy conversion
     */
    async loadHiddenGems() {
        return this.cachedQuery('hidden_gems_portfolios', async () => {
            console.log('Loading hidden gems portfolios...');

            try {
                const { data, error } = await this.supabase
                    .from('hidden_gems_portfolios')
                    .select('*');

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

    /**
     * Load hidden gems summary statistics
     * Returns aggregate stats for hidden gems analysis
     */
    async loadHiddenGemsSummary() {
        return this.cachedQuery('hidden_gems_summary', async () => {
            console.log('Loading hidden gems summary...');

            try {
                const { data, error } = await this.supabase
                    .from('hidden_gems_summary')
                    .select('*')
                    .single();

                if (error) {
                    console.error('Error loading hidden gems summary:', error);
                    throw error;
                }

                console.log(`✅ Loaded hidden gems summary`);
                return data;
            } catch (error) {
                console.error('Error loading hidden gems summary:', error);
                throw error;
            }
        });
    }

    /**
     * Trigger portfolio sequence analysis via Edge Function
     * Analyzes which sequences of 3 PDP views drive the highest copy conversion
     */
    async triggerPortfolioSequenceAnalysis() {
        console.log('Triggering portfolio sequence analysis...');

        try {
            const { data, error } = await this.supabase.functions.invoke('analyze-portfolio-sequences', {
                body: {}
            });

            if (error) {
                console.error('Edge Function error:', error);
                throw new Error(`Portfolio sequence analysis failed: ${error.message}`);
            }

            if (!data.success) {
                throw new Error(data.error || 'Unknown error during portfolio sequence analysis');
            }

            console.log('✅ Portfolio sequence analysis completed successfully:', data.stats);
            return data;
        } catch (error) {
            console.error('Error calling portfolio sequence analysis Edge Function:', error);
            throw error;
        }
    }

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
     * Create creator analysis CSV with all metrics
     */
    createCreatorAnalysisCSV(data) {
        const headers = [
            'creator_id',
            'creator_username',
            'creator_type',
            'total_profile_views',
            'total_pdp_views',
            'total_paywall_views',
            'total_stripe_views',
            'total_subscriptions',
            'total_subscription_revenue',
            'total_cancelled_subscriptions',
            'total_expired_subscriptions',
            'total_copies',
            'total_investment_count',
            'total_investments'
        ];

        const rows = data.map(row => [
            row.creator_id || '',
            row.creator_username || '',
            row.creator_type || 'Regular',
            row.total_profile_views || 0,
            row.total_pdp_views || 0,
            row.total_paywall_views || 0,
            row.total_stripe_views || 0,
            row.total_subscriptions || 0,
            row.total_subscription_revenue || 0,
            row.total_cancelled_subscriptions || 0,
            row.total_expired_subscriptions || 0,
            row.total_copies || 0,
            row.total_investment_count || 0,
            row.total_investments || 0
        ]);

        return this.arrayToCSV(headers, rows);
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
