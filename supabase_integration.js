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
     * Get last successful Mixpanel sync timestamp from sync_logs table
     * @param {string} source - Source identifier (e.g., 'mixpanel_users', 'mixpanel_engagement')
     * @returns {Promise<Date|null>} - Last sync time or null if no sync found
     */
    async getLastMixpanelSyncTime(source) {
        try {
            const { data, error } = await this.supabase
                .from('sync_logs')
                .select('sync_completed_at')
                .eq('source', source)
                .eq('sync_status', 'completed')
                .order('sync_completed_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (error || !data || !data.sync_completed_at) {
                return null;
            }

            return new Date(data.sync_completed_at);
        } catch (error) {
            console.warn(`Failed to get last sync time for ${source}:`, error);
            return null;
        }
    }

    /**
     * Get the most recent Mixpanel data refresh time across all sources
     * Used for displaying "Data as of:" timestamp
     * @returns {Promise<Date|null>}
     */
    async getMostRecentMixpanelSyncTime() {
        try {
            const sources = ['mixpanel_users', 'mixpanel_engagement', 'mixpanel_user_profiles'];
            const syncTimes = await Promise.all(
                sources.map(source => this.getLastMixpanelSyncTime(source))
            );

            // Filter out nulls and find the most recent
            const validTimes = syncTimes.filter(time => time !== null);
            if (validTimes.length === 0) return null;

            return validTimes.reduce((latest, current) =>
                current > latest ? current : latest
            );
        } catch (error) {
            console.warn('Failed to get most recent sync time:', error);
            return null;
        }
    }

    /**
     * UNIVERSAL RESILIENT DATA LOADING PATTERN
     * Use this for ALL sections across User Analysis, Creator Analysis, and Summary tabs
     *
     * This ensures data is ALWAYS displayed if available, even if sync/refresh fails.
     * Pattern: Try sync → Load from DB → Show data (with warning if stale)
     *
     * @param {Object} config - Configuration object
     * @param {Function} config.syncFunction - Async function to sync/refresh data (optional, can be null for DB-only loads)
     * @param {Function} config.loadFunction - Async function to load data from database (required)
     * @param {string} config.dataLabel - Label for logging (e.g., "creator retention", "subscription pricing")
     * @param {HTMLElement} config.container - DOM container to display results
     * @param {Function} config.displayFunction - Function to render the data (receives: data, syncFailed, container)
     * @param {string} config.emptyMessage - Message to show when no data exists (optional)
     * @returns {Promise<void>}
     */
    async loadAndDisplayWithFallback(config) {
        const {
            syncFunction = null,
            loadFunction,
            dataLabel,
            container,
            displayFunction,
            emptyMessage = `No ${dataLabel} data available yet. Click "Sync Live Data" to fetch.`
        } = config;

        if (!container) {
            console.error(`Container not provided for ${dataLabel}`);
            return;
        }

        let syncFailed = false;
        let syncError = null;

        try {
            // Step 1: Try to sync/refresh data (optional, non-blocking)
            if (syncFunction) {
                try {
                    console.log(`🔄 Attempting to sync ${dataLabel}...`);
                    await syncFunction();
                    console.log(`✅ ${dataLabel} synced successfully`);
                } catch (error) {
                    syncFailed = true;
                    syncError = error;
                    console.warn(`⚠️ ${dataLabel} sync failed, will load from database:`, error.message);
                }
            } else {
                console.log(`📊 Loading ${dataLabel} from database (no sync)...`);
            }

            // Step 2: Always load from database (regardless of sync success)
            console.log(`📊 Loading ${dataLabel} from database...`);
            const data = await loadFunction();
            console.log(`✅ Loaded ${dataLabel} from database`);

            // Step 3: Check if we have data
            const hasData = data && (Array.isArray(data) ? data.length > 0 : Object.keys(data).length > 0);

            if (!hasData) {
                container.innerHTML = `<p style="color: #999;">${emptyMessage}</p>`;
                return;
            }

            // Step 4: Display data with warning banner if sync failed
            displayFunction(data, syncFailed, container);

        } catch (error) {
            console.error(`❌ Failed to load ${dataLabel}:`, error);
            container.innerHTML = `<p style="color: #dc3545;">Failed to load ${dataLabel}: ${error.message}</p>`;
        }
    }

    /**
     * Create a warning banner for stale data
     * @param {string} message - Warning message to display
     * @returns {HTMLElement} Warning banner element
     */
    createStaleDataWarning(message) {
        const warning = document.createElement('div');
        warning.style.cssText = `
            background: #fff3cd;
            border: 1px solid #ffc107;
            border-radius: 4px;
            padding: 12px 16px;
            margin-bottom: 16px;
            color: #856404;
            font-size: 14px;
            display: flex;
            align-items: center;
            gap: 8px;
        `;
        warning.innerHTML = `
            <span style="font-size: 18px;">⚠️</span>
            <span>${message}</span>
        `;
        return warning;
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
                    // Check if it's a cold start / network error / timeout worth retrying
                    const isRetryableError = error.message?.includes('Failed to send') ||
                                            error.message?.includes('Failed to fetch') ||
                                            error.message?.includes('non-2xx status code') ||
                                            error.name === 'FunctionsFetchError' ||
                                            error.name === 'FunctionsHttpError';

                    if (isRetryableError && attempt < maxRetries) {
                        console.warn(`⚠️ ${label} failed (likely cold start or timeout), will retry...`);
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

                // Log rate limit warnings
                if (data.rateLimited) {
                    console.warn(`⚠️ ${label} hit Mixpanel rate limit - using existing data from database`);
                } else if (attempt > 0) {
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
     * Trigger Mixpanel sync via Supabase Edge Functions
     * Part 1: sync-mixpanel-user-events-v2 (event metrics from Insights API - pre-aggregated)
     * Part 2: sync-mixpanel-user-properties-v2 (user properties from Engage API - paginated)
     * Part 3: sync-mixpanel-engagement (fetch from Mixpanel and store in Storage)
     * Part 4: process-portfolio-engagement (process portfolio data from Storage)
     * Part 5: process-creator-engagement (process creator data from Storage)
     * Note: Materialized views are refreshed at the end of the full workflow (after all syncs)
     * Note: Credentials are stored in Supabase secrets, not passed from frontend
     * Note: Functions are called sequentially to avoid WORKER_LIMIT errors
     */
    async triggerMixpanelSync() {
        console.log('🔄 Starting Mixpanel analysis refresh...');

        try {
            // Part 1: Sync user events (Insights API - ~2-5 min)
            console.log('📊 Step 1/5: Syncing user event metrics...');
            let userEventsData = null;
            try {
                userEventsData = await this.invokeFunctionWithRetry(
                    'sync-mixpanel-user-events-v2',
                    {},
                    'User events sync',
                    3,      // maxRetries: 3 attempts
                    5000    // retryDelay: 5 seconds
                );

                console.log('✅ Step 1/5 complete: User events synced successfully');
                console.log('   Stats:', userEventsData.stats);
            } catch (error) {
                console.warn('⚠️ Step 1/5 failed: User events sync error, continuing with existing data');
                userEventsData = { stats: { failed: true, error: error.message } };
            }

            // Part 2: Sync user properties (Engage API - ~30s, auto-chains pages)
            console.log('📊 Step 2/5: Syncing user properties...');
            let userPropertiesData = null;
            try {
                userPropertiesData = await this.invokeFunctionWithRetry(
                    'sync-mixpanel-user-properties-v2',
                    {},
                    'User properties sync',
                    3,      // maxRetries: 3 attempts
                    5000    // retryDelay: 5 seconds
                );

                console.log('✅ Step 2/5 complete: User properties synced successfully');
                console.log('   Stats:', userPropertiesData.stats);
            } catch (error) {
                console.warn('⚠️ Step 2/5 failed: User properties sync error, continuing with existing data');
                userPropertiesData = { stats: { failed: true, error: error.message } };
            }

            // Part 3: Sync engagement (fetch from Mixpanel and store in Storage)
            console.log('📊 Step 3/5: Fetching engagement data from Mixpanel...');
            let engagementFetchData = null;
            let engagementFilename = null;
            try {
                engagementFetchData = await this.invokeFunctionWithRetry(
                    'sync-mixpanel-engagement',
                    {},
                    'Engagement fetch',
                    3,      // maxRetries: 3 attempts
                    5000    // retryDelay: 5 seconds
                );

                engagementFilename = engagementFetchData.stats?.filename;
                console.log('✅ Step 3/5 complete: Engagement data fetched and stored');
                console.log('   Filename:', engagementFilename);
            } catch (error) {
                console.warn('⚠️ Step 3/5 failed: Engagement fetch error, cannot process engagement data');
                engagementFetchData = { stats: { failed: true, error: error.message } };
            }

            // Part 4: Process portfolio engagement (only if fetch succeeded)
            let portfolioProcessData = null;
            if (engagementFilename) {
                console.log('📊 Step 4/5: Processing portfolio engagement data...');
                try {
                    portfolioProcessData = await this.invokeFunctionWithRetry(
                        'process-portfolio-engagement',
                        { filename: engagementFilename },
                        'Portfolio engagement processing',
                        2,      // maxRetries: 2 attempts
                        3000    // retryDelay: 3 seconds
                    );

                    console.log('✅ Step 4/5 complete: Portfolio engagement processed');
                    console.log('   Stats:', portfolioProcessData.stats);
                } catch (error) {
                    console.warn('⚠️ Step 4/5 failed: Portfolio processing error, continuing with existing data');
                    portfolioProcessData = { stats: { failed: true, error: error.message } };
                }
            } else {
                console.warn('⚠️ Step 4/5 skipped: No engagement file to process');
                portfolioProcessData = { stats: { failed: true, skipped: true } };
            }

            // Part 5: Process creator engagement (only if fetch succeeded)
            let creatorProcessData = null;
            if (engagementFilename) {
                console.log('📊 Step 5/5: Processing creator engagement data...');
                try {
                    // Pass pre-parsed creatorPairs from portfolio processing for 60% speedup
                    const requestBody = { filename: engagementFilename };
                    if (portfolioProcessData?.stats?.creatorPairs) {
                        console.log('   Using pre-parsed creator pairs from Step 4 (optimized path)');
                        requestBody.creatorPairs = portfolioProcessData.stats.creatorPairs;
                    }

                    creatorProcessData = await this.invokeFunctionWithRetry(
                        'process-creator-engagement',
                        requestBody,
                        'Creator engagement processing',
                        2,      // maxRetries: 2 attempts
                        3000    // retryDelay: 3 seconds
                    );

                    console.log('✅ Step 5/5 complete: Creator engagement processed');
                    console.log('   Stats:', creatorProcessData.stats);
                } catch (error) {
                    console.warn('⚠️ Step 5/5 failed: Creator processing error, continuing with existing data');
                    creatorProcessData = { stats: { failed: true, error: error.message } };
                }
            } else {
                console.warn('⚠️ Step 5/5 skipped: No engagement file to process');
                creatorProcessData = { stats: { failed: true, skipped: true } };
            }

            // Note: Pattern analyses and view refreshes happen at the end of the full workflow

            console.log('🎉 Mixpanel analysis refresh completed successfully!');

            // Invalidate all cached queries since data has been refreshed
            this.invalidateCache();

            // Return combined stats
            const hasFailures = userEventsData?.stats?.failed ||
                              userPropertiesData?.stats?.failed ||
                              engagementFetchData?.stats?.failed ||
                              portfolioProcessData?.stats?.failed ||
                              creatorProcessData?.stats?.failed;
            return {
                success: !hasFailures,
                message: !hasFailures
                    ? 'Mixpanel analysis refresh completed successfully'
                    : 'Mixpanel analysis refresh completed with some failures',
                userEvents: userEventsData?.stats,
                userProperties: userPropertiesData?.stats,
                engagementFetch: engagementFetchData?.stats,
                portfolioProcessing: portfolioProcessData?.stats,
                creatorProcessing: creatorProcessData?.stats
            };
        } catch (error) {
            console.error('❌ Unexpected error during Mixpanel sync:', error);
            // Return partial success instead of throwing
            return {
                success: false,
                message: 'Mixpanel sync failed unexpectedly',
                error: error.message,
                userEvents: { failed: true },
                userProperties: { failed: true },
                engagement: { failed: true }
            };
        }
    }

    /**
     * Trigger refresh of all materialized views
     * Called at the end of workflow to ensure views have latest data from all sources
     */
    async triggerMaterializedViewsRefresh() {
        console.log('Triggering materialized views refresh...');

        try {
            const { data, error } = await this.supabase.functions.invoke('refresh-materialized-views', {
                body: {}
            });

            if (error) {
                console.error('Materialized views refresh error:', error);
                throw new Error(`Materialized views refresh failed: ${error.message}`);
            }

            if (!data || !data.success) {
                throw new Error(data?.error || 'Unknown error during materialized views refresh');
            }

            console.log('✅ Materialized views refresh completed:', data);

            return data;
        } catch (error) {
            console.error('Error calling refresh-materialized-views Edge Function:', error);
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
            'activeCopiedPortfolios',
            'lifetimeCopiedPortfolios',
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
            (row.total_bank_links && row.total_bank_links > 0) ? '1' : '0',
            row.income || '',
            row.net_worth || '',
            row.available_copy_credits || 0,
            row.buying_power || 0,
            row.active_created_portfolios || 0,
            row.lifetime_created_portfolios || 0,
            row.active_copied_portfolios || 0,
            row.lifetime_copied_portfolios || 0,
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
     * Trigger support analysis workflow (Zendesk + Linear integration)
     * 1. sync-support-conversations (stores tickets)
     * 2. [Frontend triggers] sync-linear-issues → analyze-support-feedback → map-linear-to-feedback
     *
     * IMPORTANT: Workflow chain is triggered from frontend to ensure it runs even if
     * sync-support-conversations times out after storing data.
     */
    async triggerSupportAnalysis() {
        console.log('Triggering support analysis workflow (Zendesk + Linear)...');

        let syncResult = null;
        let syncError = null;

        try {
            // Step 1: Sync support conversations (may timeout but that's OK)
            console.log('Step 1/5: Syncing support conversations from Zendesk...');
            const result = await this.supabase.functions.invoke('sync-support-conversations', { body: {} });

            if (result.error) {
                console.warn('⚠️ Support conversations sync error (will still trigger workflow):', result.error);
                syncError = result.error;
            } else {
                console.log('✅ Support conversations synced:', result.data);
                syncResult = result.data;
            }
        } catch (error) {
            console.warn('⚠️ Support conversations sync exception (will still trigger workflow):', error.message);
            syncError = error;
        } finally {
            // Step 2 & 3: Sync support messages AND Linear issues IN PARALLEL
            // These don't depend on each other, so run them simultaneously for better performance
            console.log('Step 2-3/5: Syncing support messages AND Linear issues in parallel...');

            let messagesResult = null;
            let messagesError = null;
            let linearResult = null;
            let linearError = null;

            // Run both functions in parallel using Promise.allSettled
            const [messagesSettled, linearSettled] = await Promise.allSettled([
                this.supabase.functions.invoke('sync-support-messages', { body: {} }),
                this.supabase.functions.invoke('sync-linear-issues', { body: {} })
            ]);

            // Process messages sync result
            if (messagesSettled.status === 'fulfilled') {
                if (messagesSettled.value.error) {
                    console.warn('⚠️ Support messages sync error (workflow will continue):', messagesSettled.value.error);
                    messagesError = messagesSettled.value.error;
                } else {
                    console.log('✅ Support messages synced:', messagesSettled.value.data);
                    messagesResult = messagesSettled.value.data;
                }
            } else {
                console.warn('⚠️ Support messages sync exception (workflow will continue):', messagesSettled.reason);
                messagesError = messagesSettled.reason;
            }

            // Process Linear sync result
            if (linearSettled.status === 'fulfilled') {
                if (linearSettled.value.error) {
                    console.warn('⚠️ Linear sync failed (workflow will continue):', linearSettled.value.error);
                    linearError = linearSettled.value.error;
                } else {
                    console.log('✅ Linear issues synced:', linearSettled.value.data);
                    linearResult = linearSettled.value.data;
                }
            } else {
                console.warn('⚠️ Linear sync exception (workflow will continue):', linearSettled.reason);
                linearError = linearSettled.reason;
            }

            // Return sync results - frontend will handle analysis workflow
            // Frontend controls: refresh materialized view → analyze-support-feedback → map-linear-to-feedback
            console.log('✅ Support data sync complete (conversations, messages, Linear issues)');
            console.log('   Frontend will now refresh view → analyze → map Linear tickets');

            return {
                success: true,
                sync_summary: {
                    conversations: syncResult || { error: syncError?.message },
                    messages: messagesResult || { error: messagesError?.message },
                    linear: linearResult || { error: linearError?.message }
                },
                message: 'Support data sync completed - frontend will continue with analysis workflow'
            };
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

            // Return data directly (no CSV conversion needed)
            return data;
        } catch (error) {
            console.error('Error loading creator data from Supabase:', error);
            throw error;
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
     * Trigger event sequence sync v2 via Supabase Edge Function (Export API)
     * Fetches raw events from Mixpanel Export API with all properties included
     * No enrichment step needed - portfolioTicker and creatorUsername come from API
     * Skips sync if data was synced within the last hour
     */
    async triggerEventSequenceSyncV2() {
        console.log('Triggering event sequence sync v2 (Export API) via Supabase Edge Function...');

        try {
            const { data, error } = await this.supabase.functions.invoke('sync-event-sequences-v2', {
                body: {}
            });

            if (error) {
                console.error('Edge Function error:', error);
                throw new Error(`Event sequence sync v2 failed: ${error.message}`);
            }

            if (!data.success) {
                throw new Error(data.error || 'Unknown error during event sequence sync v2');
            }

            if (data.skipped) {
                console.log('⏭️ Event sequence sync v2 skipped (data refreshed within last hour)');
            } else {
                console.log('✅ Event sequence sync v2 completed successfully:', data.stats);
            }

            return data;
        } catch (error) {
            console.error('Error calling event sequence sync v2 Edge Function:', error);
            throw error;
        }
    }

    /**
     * Trigger event sequence enrichment via Supabase Edge Function
     * Enriches event sequences with portfolioTicker and creatorUsername properties
     * Required for unique views analysis
     */
    async triggerEventSequenceEnrichment() {
        console.log('Triggering event sequence enrichment via Supabase Edge Function...');

        try {
            const { data, error } = await this.supabase.functions.invoke('enrich-event-sequences', {
                body: {}
            });

            if (error) {
                console.error('Edge Function error:', error);
                throw new Error(`Event sequence enrichment failed: ${error.message}`);
            }

            if (!data.success) {
                throw new Error(data.error || 'Unknown error during event sequence enrichment');
            }

            console.log('✅ Event sequence enrichment completed:', data.stats);
            return data;
        } catch (error) {
            console.error('Error calling event sequence enrichment Edge Function:', error);
            throw error;
        }
    }

    /**
     * Fetch creator retention data from Mixpanel Retention API
     * Returns subscription retention rates by creator cohort
     */
    async fetchCreatorRetention() {
        console.log('Fetching creator retention data from Mixpanel...');

        try {
            const { data, error} = await this.supabase.functions.invoke('fetch-creator-retention', {
                body: {}
            });

            if (error) {
                console.error('Edge Function error:', error);
                throw new Error(`Creator retention fetch failed: ${error.message}`);
            }

            if (!data.success) {
                throw new Error(data.error || 'Unknown error fetching creator retention');
            }

            console.log('✅ Creator retention data fetched successfully');
            return data;
        } catch (error) {
            console.error('Error calling fetch-creator-retention Edge Function:', error);
            throw error;
        }
    }

    /**
     * Load creator retention data from database (materialized view)
     * This loads cached data without calling Mixpanel API
     */
    async loadCreatorRetentionFromDatabase() {
        console.log('Loading creator retention data from database...');

        try {
            const { data, error } = await this.supabase
                .from('premium_creator_retention_analysis')
                .select('*')
                .order('creator_username', { ascending: true })
                .order('cohort_date', { ascending: true });

            if (error) {
                console.error('Error loading retention data:', error);
                throw error;
            }

            console.log(`✅ Loaded ${data.length} retention records from database`);

            // Transform to expected format: { "cohort_date": { "username": { first, counts } } }
            const formattedData = {};

            data.forEach((row) => {
                const cohortDate = row.cohort_date;
                if (!formattedData[cohortDate]) {
                    formattedData[cohortDate] = {};
                }

                formattedData[cohortDate][row.creator_username] = {
                    first: row.first,
                    counts: row.counts
                };
            });

            // Format to match the expected structure from API
            return {
                rawData: formattedData,
                success: true,
                source: 'database'
            };
        } catch (error) {
            console.error('Error loading retention from database:', error);
            throw error;
        }
    }

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

    // REMOVED: triggerSubscriptionAnalysis() - analyze-subscription-patterns merged into analyze-conversion-patterns
    // Use triggerCopyAnalysis() with analysis_type='subscription' if needed

    /**
     * Generic function to load top combinations for any analysis type (DRY)
     * @param {string} analysisType - 'subscription', 'copy', or 'portfolio_sequence'
     * @param {string} metric - 'lift', 'aic', 'precision', or 'odds_ratio'
     * @param {number} limit - Number of results to return
     * @param {boolean} mapUsernames - Whether to map creator IDs to usernames
     */
    async loadTopCombinations(analysisType, metric = 'lift', limit = 20, mapUsernames = false, minExposure = 1) {
        // Create cache key from parameters
        const cacheKey = `combinations_${analysisType}_${metric}_${limit}_${mapUsernames}_${minExposure}`;

        return this.cachedQuery(cacheKey, async () => {
            console.log(`Loading top ${analysisType} combinations by ${metric}...`);

            try {
                let query = this.supabase
                    .from('conversion_pattern_combinations')
                    .select('*')
                    .eq('analysis_type', analysisType)
                    .gte('users_with_exposure', minExposure); // Filter: minimum 1 user exposed

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
                }

                return sortedData;
            } catch (error) {
                console.error(`Error loading ${analysisType} combinations:`, error);
                throw error;
            }
        });
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
     * Runs exhaustive search + logistic regression to find best portfolio and creator combinations
     */
    async triggerCopyAnalysis() {
        console.log('Triggering copy pattern analysis...');

        try {
            // Trigger portfolio copy analysis (analysis_type: 'copy')
            const { data: portfolioData, error: portfolioError } = await this.supabase.functions.invoke('analyze-conversion-patterns', {
                body: { analysis_type: 'copy' }
            });

            if (portfolioError) {
                console.error('Portfolio copy analysis error:', portfolioError);
                throw new Error(`Portfolio copy analysis failed: ${portfolioError.message}`);
            }

            console.log('✅ Portfolio copy analysis completed:', portfolioData);

            // Trigger creator copy analysis (analysis_type: 'creator_copy')
            const { data: creatorData, error: creatorError } = await this.supabase.functions.invoke('analyze-conversion-patterns', {
                body: { analysis_type: 'creator_copy' }
            });

            if (creatorError) {
                console.error('Creator copy analysis error:', creatorError);
                throw new Error(`Creator copy analysis failed: ${creatorError.message}`);
            }

            console.log('✅ Creator copy analysis completed:', creatorData);

            // Return combined results
            const data = {
                success: true,
                portfolio: portfolioData,
                creator: creatorData,
                stats: {
                    portfolio: portfolioData?.stats,
                    creator: creatorData?.stats
                }
            };

            console.log('✅ Copy analysis completed successfully:', data.stats);
            return data;
        } catch (error) {
            console.error('Error calling copy analysis Edge Function:', error);
            throw error;
        }
    }

    /**
     * Trigger Linear issues sync via Edge Function
     * Fetches Linear issues from "dub 3.0" team (last 6 months)
     */
    async triggerLinearSync() {
        console.log('Triggering Linear issues sync...');

        try {
            const { data, error } = await this.supabase.functions.invoke('sync-linear-issues');

            if (error) {
                console.error('Linear sync error:', error);
                throw new Error(`Linear sync failed: ${error.message}`);
            }

            console.log('✅ Linear sync completed:', data);
            return data;
        } catch (error) {
            console.error('Error calling Linear sync Edge Function:', error);
            throw error;
        }
    }

    /**
     * Trigger Linear-to-feedback mapping via Edge Function
     * Maps Linear issues to the top 10 support feedback items
     */
    async triggerLinearMapping() {
        console.log('Triggering Linear-to-feedback mapping...');

        try {
            const { data, error } = await this.supabase.functions.invoke('map-linear-to-feedback');

            if (error) {
                console.error('Linear mapping error:', error);
                throw new Error(`Linear mapping failed: ${error.message}`);
            }

            console.log('✅ Linear mapping completed:', data);
            return data;
        } catch (error) {
            console.error('Error calling Linear mapping Edge Function:', error);
            throw error;
        }
    }

    /**
     * Load top copy combinations (portfolio combinations that drive copies)
     */
    async loadTopCopyCombinations(metric = 'lift', limit = 20, minExposure = 1) {
        return this.loadTopCombinations('copy', metric, limit, false, minExposure);
    }

    /**
     * Load top creator copy combinations
     * Analyzes which creator profile view combinations drive copies
     */
    async loadTopCreatorCopyCombinations(metric = 'lift', limit = 20, minExposure = 1) {
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
     * Load premium creator copy affinity from database view
     * The view already returns data in the correct pivoted format with separate Premium/Regular columns
     */
    async loadPremiumCreatorCopyAffinity() {
        return this.cachedQuery('premium_creator_affinity_display', async () => {
            console.log('Loading premium creator copy affinity from view...');

            try {
                const { data, error } = await this.supabase
                    .from('premium_creator_affinity_display')
                    .select('*');

                if (error) {
                    console.error('Error loading premium creator copy affinity:', error);
                    throw error;
                }

                console.log(`✅ Loaded ${data.length} premium creator affinity records from view`);
                return data;
            } catch (error) {
                console.error('Error loading premium creator copy affinity:', error);
                throw error;
            }
        });
    }

    /**
     * Fetch Mixpanel Insights data via Edge Function
     * @param {string} chartId - Mixpanel chart ID (e.g., '86100814')
     * @returns {Promise<Object>} - Chart data with series
     */
    async fetchMixpanelInsights(chartId) {
        try {
            console.log(`Fetching Mixpanel chart ${chartId} via Edge Function...`);

            const { data, error } = await this.supabase.functions.invoke('fetch-mixpanel-marketing', {
                body: { chartId }
            });

            if (error) {
                console.error('Edge Function error:', error);
                throw new Error(`Failed to fetch Mixpanel chart: ${error.message}`);
            }

            // Edge Function wraps response in { success, message, stats }
            // The chart data is in stats
            const chartData = data?.stats || data;

            if (!chartData || !chartData.series) {
                console.error('Invalid response from Edge Function:', data);
                throw new Error('Invalid response from Mixpanel chart');
            }

            console.log(`✅ Fetched Mixpanel chart ${chartId}`);
            return chartData;
        } catch (error) {
            console.error('Error fetching Mixpanel insights:', error);
            throw error;
        }
    }

}

// Export to window for global access
window.SupabaseIntegration = SupabaseIntegration;

console.log('✅ Supabase Integration module loaded');
