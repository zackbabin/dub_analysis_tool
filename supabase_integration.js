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
            return cached.data;
        }

        // Check if this request is already in-flight (deduplication)
        if (this.inFlightRequests.has(cacheKey)) {
            return this.inFlightRequests.get(cacheKey);
        }

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
        } else {
            this.queryCache.clear();
            this.inFlightRequests.clear();
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
                    // Check if it's a cold start / network error / timeout / CORS error worth retrying
                    const isRetryableError = error.message?.includes('Failed to send') ||
                                            error.message?.includes('Failed to fetch') ||
                                            error.message?.includes('non-2xx status code') ||
                                            error.message?.includes('CORS') ||
                                            error.message?.includes('Access-Control-Allow-Origin') ||
                                            error.message?.includes('ERR_NETWORK') ||
                                            error.name === 'FunctionsFetchError' ||
                                            error.name === 'FunctionsHttpError' ||
                                            error.name === 'NetworkError';

                    if (isRetryableError && attempt < maxRetries) {
                        console.warn(`⚠️ ${label} failed (network/CORS/timeout error), will retry in ${retryDelay}ms...`);
                        console.warn(`   Error: ${error.message || error.name}`);
                        lastError = error;
                        continue;
                    }

                    // Not retryable or max retries reached
                    console.error(`❌ ${label} error (after ${attempt + 1} attempts):`, error);
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
                // Check if this is a network error that might be transient
                const isNetworkError = error.message?.includes('Failed to fetch') ||
                                      error.message?.includes('ERR_NETWORK') ||
                                      error.message?.includes('CORS') ||
                                      error.name === 'TypeError' && error.message?.includes('fetch');

                if (isNetworkError && attempt < maxRetries) {
                    console.warn(`⚠️ ${label} network exception, will retry in ${retryDelay}ms...`);
                    console.warn(`   Error: ${error.message}`);
                    lastError = error;
                    // Don't rethrow yet - loop will continue with retry
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                    continue;
                }

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
        console.log('🔄 Mixpanel Sync: Starting...');

        try {
            // Part 1: Sync user events (Insights API - ~2-5 min)
            console.log('→ 1/5: User event metrics');
            let userEventsData = null;
            try {
                userEventsData = await this.invokeFunctionWithRetry(
                    'sync-mixpanel-user-events-v2',
                    {},
                    'User events sync',
                    3,      // maxRetries: 3 attempts
                    5000    // retryDelay: 5 seconds
                );
                console.log('  ✓ 1/5: User events synced');
            } catch (error) {
                console.warn('  ⚠ 1/5: User events sync failed, continuing with existing data');
                userEventsData = { stats: { failed: true, error: error.message } };
            }

            // Part 2: Sync user properties (Engage API - ~30s, auto-chains pages)
            console.log('→ 2/5: User properties');
            let userPropertiesData = null;
            try {
                userPropertiesData = await this.invokeFunctionWithRetry(
                    'sync-mixpanel-user-properties-v2',
                    {},
                    'User properties sync',
                    3,      // maxRetries: 3 attempts
                    5000    // retryDelay: 5 seconds
                );
                console.log('  ✓ 2/5: User properties synced');
            } catch (error) {
                console.warn('  ⚠ 2/5: User properties sync failed, continuing with existing data');
                userPropertiesData = { stats: { failed: true, error: error.message } };
            }

            // Part 3: Sync engagement (fetch from Mixpanel and store in Storage)
            console.log('→ 3/5: Engagement data fetch');
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
                console.log('  ✓ 3/5: Engagement data fetched');
            } catch (error) {
                console.warn('  ⚠ 3/5: Engagement fetch failed, skipping processing steps');
                engagementFetchData = { stats: { failed: true, error: error.message } };
            }

            // Part 4: Process portfolio engagement (only if fetch succeeded)
            let portfolioProcessData = null;
            if (engagementFilename) {
                console.log('→ 4/5: Portfolio engagement processing');
                try {
                    portfolioProcessData = await this.invokeFunctionWithRetry(
                        'process-portfolio-engagement',
                        { filename: engagementFilename },
                        'Portfolio engagement processing',
                        2,      // maxRetries: 2 attempts
                        3000    // retryDelay: 3 seconds
                    );
                    console.log('  ✓ 4/5: Portfolio engagement processed');
                } catch (error) {
                    console.warn('  ⚠ 4/5: Portfolio processing failed, continuing with existing data');
                    portfolioProcessData = { stats: { failed: true, error: error.message } };
                }
            } else {
                console.log('  ⊘ 4/5: Skipped (no engagement file)');
                portfolioProcessData = { stats: { failed: true, skipped: true } };
            }

            // Part 5: Process creator engagement (only if fetch succeeded)
            let creatorProcessData = null;
            if (engagementFilename) {
                console.log('→ 5/5: Creator engagement processing');
                try {
                    // Pass pre-parsed creatorPairs from portfolio processing for 60% speedup
                    const requestBody = { filename: engagementFilename };
                    if (portfolioProcessData?.stats?.creatorPairs) {
                        requestBody.creatorPairs = portfolioProcessData.stats.creatorPairs;
                    }

                    creatorProcessData = await this.invokeFunctionWithRetry(
                        'process-creator-engagement',
                        requestBody,
                        'Creator engagement processing',
                        2,      // maxRetries: 2 attempts
                        3000    // retryDelay: 3 seconds
                    );
                    console.log('  ✓ 5/5: Creator engagement processed');
                } catch (error) {
                    console.warn('  ⚠ 5/5: Creator processing failed, continuing with existing data');
                    creatorProcessData = { stats: { failed: true, error: error.message } };
                }
            } else {
                console.log('  ⊘ 5/5: Skipped (no engagement file)');

                creatorProcessData = { stats: { failed: true, skipped: true } };
            }

            // Refresh main_analysis view after all source tables and processing are complete
            // (subscribers_insights + user_portfolio_creator_engagement + all engagement processing)
            console.log('→ Refreshing main_analysis materialized view...');
            try {
                await this.supabase.rpc('refresh_main_analysis');
                console.log('  ✓ main_analysis refreshed');
            } catch (refreshError) {
                console.warn('  ⚠ Failed to refresh main_analysis:', refreshError.message);
            }

            console.log('✅ Mixpanel Sync: Complete');

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
            console.error('❌ Mixpanel Sync: Unexpected error -', error.message);
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
        try {
            const { data, error } = await this.supabase.functions.invoke('refresh-materialized-views', {
                body: {}
            });

            if (error) {
                throw new Error(`Materialized views refresh failed: ${error.message}`);
            }

            if (!data || !data.success) {
                throw new Error(data?.error || 'Unknown error during materialized views refresh');
            }

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
                    hasMore = data.length === pageSize; // Continue if we got a full page
                    page++;
                } else {
                    hasMore = false;
                }
            }

            // Silently load data - verbose logging removed for cleaner console

            // Return JSON directly - processComprehensiveData now handles JSON input
            return allData;
        } catch (error) {
            console.error('❌ Error loading data from Supabase:', error);
            throw error;
        }
    }

    /**
     * Helper: Convert array data to CSV string
     * Used by creator analysis CSV export
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
        console.log('→ Syncing creator data');

        try {
            const creatorDataResult = await this.supabase.functions.invoke('sync-creator-data', { body: {} });

            if (creatorDataResult.error) {
                throw new Error(`Creator sync failed: ${creatorDataResult.error.message}`);
            }

            if (!creatorDataResult.data.success) {
                throw new Error(creatorDataResult.data.error || 'Unknown error during creator sync');
            }

            return {
                creatorData: creatorDataResult.data
            };
        } catch (error) {
            console.error('  ✗ Creator sync error:', error.message);
            throw error;
        }
    }

    /**
     * Trigger support analysis workflow (Zendesk + Linear integration)
     * 1. sync-support-conversations (stores tickets)
     * 2. sync-support-messages (stores messages) + sync-linear-issues (parallel)
     * 3. update-support-message-counts (updates message_count column)
     * 4. [Frontend triggers] analyze-support-feedback → map-linear-to-feedback
     *
     * IMPORTANT: Workflow chain is triggered from frontend to ensure it runs even if
     * sync-support-conversations times out after storing data.
     * update-support-message-counts runs independently after messages are synced.
     */
    async triggerSupportAnalysis() {
        let syncResult = null;
        let syncError = null;

        try {
            // Step 1: Sync support conversations
            console.log('→ 1/3: Support conversations (Zendesk)');
            const result = await this.supabase.functions.invoke('sync-support-conversations', { body: {} });

            if (result.error) {
                console.warn('  ⚠ 1/3: Conversations sync error, continuing');
                syncError = result.error;
            } else {
                console.log('  ✓ 1/3: Conversations synced');
                syncResult = result.data;
            }
        } catch (error) {
            console.warn('  ⚠ 1/3: Conversations sync exception, continuing');
            syncError = error;
        } finally {
            // Step 2 & 3: Sync messages and Linear issues in parallel
            console.log('→ 2-3/4: Support messages + Linear issues (parallel)');

            let messagesResult = null;
            let messagesError = null;
            let linearResult = null;
            let linearError = null;

            const [messagesSettled, linearSettled] = await Promise.allSettled([
                this.supabase.functions.invoke('sync-support-messages', { body: {} }),
                this.supabase.functions.invoke('sync-linear-issues', { body: {} })
            ]);

            // Process messages sync result
            if (messagesSettled.status === 'fulfilled') {
                if (messagesSettled.value.error) {
                    messagesError = messagesSettled.value.error;
                } else {
                    messagesResult = messagesSettled.value.data;
                }
            } else {
                messagesError = messagesSettled.reason;
            }

            // Process Linear sync result
            if (linearSettled.status === 'fulfilled') {
                if (linearSettled.value.error) {
                    linearError = linearSettled.value.error;
                } else {
                    linearResult = linearSettled.value.data;
                }
            } else {
                linearError = linearSettled.reason;
            }

            if (messagesResult && linearResult) {
                console.log('  ✓ 2-3/4: Both synced');
            } else if (messagesResult || linearResult) {
                console.warn('  ⚠ 2-3/4: Partial sync');
            } else {
                console.warn('  ⚠ 2-3/4: Both failed');
            }

            // Step 4: Update message counts (runs independently after messages are synced)
            console.log('→ 4/4: Updating message counts');
            let messageCountsResult = null;
            let messageCountsError = null;

            try {
                const countsResult = await this.supabase.functions.invoke('update-support-message-counts', { body: {} });
                if (countsResult.error) {
                    messageCountsError = countsResult.error;
                    console.warn('  ⚠ 4/4: Message counts update error');
                } else {
                    messageCountsResult = countsResult.data;
                    console.log('  ✓ 4/4: Message counts updated');
                }
            } catch (error) {
                messageCountsError = error;
                console.warn('  ⚠ 4/4: Message counts update exception');
            }

            return {
                success: true,
                sync_summary: {
                    conversations: syncResult || { error: syncError?.message },
                    messages: messagesResult || { error: messagesError?.message },
                    linear: linearResult || { error: linearError?.message },
                    message_counts: messageCountsResult || { error: messageCountsError?.message }
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
            // Loading subscription price distribution

            try {
                const { data, error } = await this.supabase
                    .from('latest_subscription_distribution')
                    .select('*')
                    .order('monthly_price');

                if (error) {
                    console.error('Error loading subscription distribution:', error);
                    throw error;
                }

                // Data loaded successfully
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
     * DEPRECATED: Event sequence enrichment is no longer needed
     * sync-event-sequences-v2 now includes portfolioTicker and creatorUsername directly
     * from Mixpanel Export API properties, eliminating the need for separate enrichment
     */
    async triggerEventSequenceEnrichment() {
        console.warn('⚠️ triggerEventSequenceEnrichment is DEPRECATED - enrichment is now handled in sync-event-sequences-v2');
        return { success: true, message: 'Enrichment no longer needed - properties included in sync' };
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
     * Aggregates raw events from event_sequences_raw into user_event_sequences using SQL
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

            console.log('✅ Event sequence processing completed:', data);
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

    // REMOVED: loadEventSequenceAnalysis() - Replaced by simplified event_sequence_metrics table
    // Event sequences workflow now uses Claude AI to calculate mean/median directly
    // Results stored in event_sequence_metrics and joined into copy_engagement_summary view

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
            // Loading combination data

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
            // Loading copy engagement summary

            try {
                const { data, error } = await this.supabase
                    .from('copy_engagement_summary')
                    .select('*');

                if (error) {
                    console.error('Error loading copy engagement summary:', error);
                    throw error;
                }

                // Data loaded successfully
                return data;
            } catch (error) {
                console.error('Error loading copy engagement summary:', error);
                throw error;
            }
        });
    }

    // REMOVED: loadEventSequencesPreCopyMetrics() - RPC function no longer exists
    // Replaced by simplified event_sequence_metrics table populated by Claude AI
    // Metrics are now available directly in copy_engagement_summary view

    /**
     * Trigger copy pattern analysis via Edge Function
     * Runs exhaustive search + logistic regression to find best portfolio and creator combinations
     */
    async triggerCopyAnalysis() {
        console.log('Triggering copy pattern analysis (parallel: portfolio + creator)...');

        try {
            // Run both analyses in parallel (separate edge functions)
            const [portfolioResult, creatorResult] = await Promise.all([
                this.supabase.functions.invoke('analyze-copy-patterns'),
                this.supabase.functions.invoke('analyze-creator-copy-patterns')
            ]);

            const { data: portfolioData, error: portfolioError } = portfolioResult;
            const { data: creatorData, error: creatorError } = creatorResult;

            if (portfolioError) {
                console.error('Portfolio copy analysis error:', portfolioError);
                throw new Error(`Portfolio copy analysis failed: ${portfolioError.message}`);
            }

            if (creatorError) {
                console.error('Creator copy analysis error:', creatorError);
                throw new Error(`Creator copy analysis failed: ${creatorError.message}`);
            }

            console.log('✅ Portfolio copy analysis completed:', portfolioData);
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
            // Loading hidden gems portfolios

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

                // Data loaded successfully
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

                // Data loaded successfully
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
            // Fetching Mixpanel chart via Edge Function

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

            // Mixpanel chart fetched
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
