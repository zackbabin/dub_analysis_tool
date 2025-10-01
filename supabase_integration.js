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

        console.log('✅ Supabase Integration initialized');
    }

    /**
     * Trigger Mixpanel sync via Supabase Edge Function
     * Replaces: triggerGitHubWorkflow() + waitForWorkflowCompletion()
     * Note: Credentials are stored in Supabase secrets, not passed from frontend
     */
    async triggerMixpanelSync() {
        console.log('Triggering Mixpanel sync via Supabase Edge Function...');

        try {
            // Call the Edge Function (no credentials needed - they're in Supabase secrets)
            const { data, error } = await this.supabase.functions.invoke('sync-mixpanel', {
                body: {}
            });

            if (error) {
                console.error('Edge Function error:', error);
                throw new Error(`Sync failed: ${error.message}`);
            }

            if (!data.success) {
                throw new Error(data.error || 'Unknown error during sync');
            }

            console.log('✅ Sync completed successfully:', data.stats);
            return data;
        } catch (error) {
            console.error('Error calling Edge Function:', error);
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
                .from('latest_creator_sync_status')
                .select('*')
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
