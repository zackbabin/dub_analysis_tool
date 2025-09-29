// Mixpanel Sync Integration
class MixpanelSync {
    constructor() {
        this.loadCredentials();
        this.baseURL = 'https://mixpanel.com/api/2.0';
        
        // Chart IDs from Mixpanel dashboard
        this.chartIds = {
            subscribersInsights: '13682903',
            timeToFirstCopy: '84999271',
            timeToFundedAccount: '84999267',
            timeToLinkedBank: '84999265',
            premiumSubscriptions: '84999290',
            creatorCopyFunnel: '84999286',
            portfolioCopyFunnel: '84999289'
        };
    }
    
    loadCredentials() {
        this.projectToken = localStorage.getItem('mixpanel_project_token') || '';
        this.apiSecret = localStorage.getItem('mixpanel_api_secret') || '';
    }
    
    saveCredentials(token, secret) {
        localStorage.setItem('mixpanel_project_token', token);
        localStorage.setItem('mixpanel_api_secret', secret);
        this.projectToken = token;
        this.apiSecret = secret;
    }
    
    hasCredentials() {
        return this.projectToken && this.apiSecret;
    }
    
    clearCredentials() {
        localStorage.removeItem('mixpanel_project_token');
        localStorage.removeItem('mixpanel_api_secret');
        this.projectToken = '';
        this.apiSecret = '';
    }
    
    // Base64 encode credentials for Basic Auth
    getAuthHeader() {
        return 'Basic ' + btoa(this.apiSecret + ':');
    }
    
    // Fetch data from a specific chart/report
    async fetchChartData(chartId, chartType, dateRange) {
        const endpoint = this.getEndpointForChart(chartType);
        const params = this.buildParams(chartId, chartType, dateRange);
        
        const url = `${this.baseURL}${endpoint}?${new URLSearchParams(params)}`;
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': this.getAuthHeader(),
                'Accept': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`Mixpanel API error: ${response.status} ${response.statusText}`);
        }
        
        return await response.json();
    }
    
    getEndpointForChart(chartType) {
        // Map chart types to Mixpanel API endpoints
        const endpoints = {
            'subscribersInsights': '/engage',
            'timeToFirstCopy': '/funnels',
            'timeToFundedAccount': '/funnels',
            'timeToLinkedBank': '/funnels',
            'premiumSubscriptions': '/funnels',
            'creatorCopyFunnel': '/funnels',
            'portfolioCopyFunnel': '/funnels'
        };
        return endpoints[chartType] || '/funnels';
    }
    
    buildParams(chartId, chartType, dateRange) {
        const baseParams = {
            project_id: this.projectToken,
            funnel_id: chartId,
            from_date: dateRange.from,
            to_date: dateRange.to
        };
        
        // Add specific parameters based on chart type
        if (chartType === 'subscribersInsights') {
            // For user profile data, we need different parameters
            return {
                ...baseParams,
                where: '', // Can add filters if needed
                session_id: new Date().getTime(), // Unique session
                page: 0,
                page_size: 10000 // Adjust based on user count
            };
        } else if (chartType.includes('premium') || chartType.includes('creator')) {
            // For grouped funnels
            return {
                ...baseParams,
                on: 'properties["creatorUsername"]',
                unit: 'day'
            };
        } else if (chartType.includes('portfolio')) {
            return {
                ...baseParams,
                on: 'properties["portfolioTicker"]',
                unit: 'day'
            };
        } else {
            // Time-based funnels
            return {
                ...baseParams,
                unit: 'day'
            };
        }
    }
    
    // Main sync function that fetches all data
    async fetchAllChartData(dateRange = null) {
        if (!this.hasCredentials()) {
            throw new Error('Mixpanel credentials not configured');
        }
        
        // Default to last 30 days if no range specified
        if (!dateRange) {
            const today = new Date();
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(today.getDate() - 30);
            
            dateRange = {
                from: thirtyDaysAgo.toISOString().split('T')[0],
                to: today.toISOString().split('T')[0]
            };
        }
        
        console.log('Fetching Mixpanel data for date range:', dateRange);
        
        try {
            // Fetch all charts in parallel
            const [
                subscribersData,
                timeToFirstCopyData,
                timeToFundedData,
                timeToLinkedData,
                premiumSubData,
                creatorCopyData,
                portfolioCopyData
            ] = await Promise.all([
                this.fetchChartData(this.chartIds.subscribersInsights, 'subscribersInsights', dateRange),
                this.fetchChartData(this.chartIds.timeToFirstCopy, 'timeToFirstCopy', dateRange),
                this.fetchChartData(this.chartIds.timeToFundedAccount, 'timeToFundedAccount', dateRange),
                this.fetchChartData(this.chartIds.timeToLinkedBank, 'timeToLinkedBank', dateRange),
                this.fetchChartData(this.chartIds.premiumSubscriptions, 'premiumSubscriptions', dateRange),
                this.fetchChartData(this.chartIds.creatorCopyFunnel, 'creatorCopyFunnel', dateRange),
                this.fetchChartData(this.chartIds.portfolioCopyFunnel, 'portfolioCopyFunnel', dateRange)
            ]);
            
            console.log('All data fetched successfully');
            
            // Transform to CSV format
            return this.transformToCSVFormat({
                subscribersData,
                timeToFirstCopyData,
                timeToFundedData,
                timeToLinkedData,
                premiumSubData,
                creatorCopyData,
                portfolioCopyData
            });
            
        } catch (error) {
            console.error('Error fetching Mixpanel data:', error);
            throw error;
        }
    }
    
    // Transform Mixpanel API responses to CSV format matching file structure
    transformToCSVFormat(apiData) {
        console.log('Transforming Mixpanel data to CSV format...');
        
        // Transform each dataset to match expected CSV structure
        const csvData = [
            this.transformSubscribersInsights(apiData.subscribersData),
            this.transformTimeFunnel(apiData.timeToFirstCopyData, 'Time to First Copy'),
            this.transformTimeFunnel(apiData.timeToFundedData, 'Time to Funded Account'),
            this.transformTimeFunnel(apiData.timeToLinkedData, 'Time to Linked Bank'),
            this.transformPremiumSubscriptions(apiData.premiumSubData),
            this.transformCreatorCopyFunnel(apiData.creatorCopyData),
            this.transformPortfolioCopyFunnel(apiData.portfolioCopyData)
        ];
        
        // Convert each dataset to CSV string format
        return csvData.map(data => this.jsonToCSV(data.headers, data.rows));
    }
    
    transformSubscribersInsights(data) {
        // Transform user profile data to match subscribers insights CSV
        const headers = [
            '$distinct_id', 'income', 'netWorth', 'availableCopyCredits', 'buyingPower',
            'activeCreatedPortfolios', 'lifetimeCreatedPortfolios', 'totalBuys', 'totalSells', 
            'totalTrades', 'totalWithdrawalCount', 'totalWithdrawals', 'investingActivity',
            'investingExperienceYears', 'investingObjective', 'investmentType', 'acquisitionSurvey',
            'A. Linked Bank Account', 'B. Total Deposits ($)', 'C. Total Deposit Count',
            'D. Subscribed within 7 days', 'E. Total Copies', 'F. Total Regular Copies',
            'G. Total Premium Copies', 'H. Regular PDP Views', 'I. Premium PDP Views',
            'J. Paywall Views', 'K. Regular Creator Profile Views', 'L. Premium Creator Profile Views',
            'M. Total Subscriptions', 'N. App Sessions', 'O. Discover Tab Views',
            'P. Leaderboard Tab Views', 'Q. Premium Tab Views', 'R. Stripe Modal Views',
            'S. Creator Card Taps', 'T. Portfolio Card Taps'
        ];
        
        const rows = [];
        
        // Handle both Engage API response and Insights API response formats
        if (data.results && Array.isArray(data.results)) {
            data.results.forEach(user => {
                const properties = user.$properties || user.properties || {};
                rows.push({
                    '$distinct_id': user.$distinct_id || properties.$distinct_id || '',
                    'income': properties.income || '',
                    'netWorth': properties.netWorth || '',
                    'availableCopyCredits': properties.availableCopyCredits || 0,
                    'buyingPower': properties.buyingPower || 0,
                    'activeCreatedPortfolios': properties.activeCreatedPortfolios || 0,
                    'lifetimeCreatedPortfolios': properties.lifetimeCreatedPortfolios || 0,
                    'totalBuys': properties.totalBuys || 0,
                    'totalSells': properties.totalSells || 0,
                    'totalTrades': properties.totalTrades || 0,
                    'totalWithdrawalCount': properties.totalWithdrawalCount || 0,
                    'totalWithdrawals': properties.totalWithdrawals || 0,
                    'investingActivity': properties.investingActivity || '',
                    'investingExperienceYears': properties.investingExperienceYears || '',
                    'investingObjective': properties.investingObjective || '',
                    'investmentType': properties.investmentType || '',
                    'acquisitionSurvey': properties.acquisitionSurvey || '',
                    'A. Linked Bank Account': properties.hasLinkedBank || 0,
                    'B. Total Deposits ($)': properties.totalDeposits || 0,
                    'C. Total Deposit Count': properties.totalDepositCount || 0,
                    'D. Subscribed within 7 days': properties.subscribedWithin7Days || 0,
                    'E. Total Copies': properties.totalCopies || 0,
                    'F. Total Regular Copies': properties.totalRegularCopies || 0,
                    'G. Total Premium Copies': properties.totalPremiumCopies || 0,
                    'H. Regular PDP Views': properties.regularPDPViews || 0,
                    'I. Premium PDP Views': properties.premiumPDPViews || 0,
                    'J. Paywall Views': properties.paywallViews || 0,
                    'K. Regular Creator Profile Views': properties.regularCreatorProfileViews || 0,
                    'L. Premium Creator Profile Views': properties.premiumCreatorProfileViews || 0,
                    'M. Total Subscriptions': properties.totalSubscriptions || 0,
                    'N. App Sessions': properties.appSessions || 0,
                    'O. Discover Tab Views': properties.discoverTabViews || 0,
                    'P. Leaderboard Tab Views': properties.leaderboardViews || 0,
                    'Q. Premium Tab Views': properties.premiumTabViews || 0,
                    'R. Stripe Modal Views': properties.totalStripeViews || 0,
                    'S. Creator Card Taps': properties.creatorCardTaps || 0,
                    'T. Portfolio Card Taps': properties.portfolioCardTaps || 0
                });
            });
        }
        
        return { headers, rows };
    }
    
    transformTimeFunnel(data, funnelName) {
        const headers = ['Funnel', 'Distinct ID', funnelName];
        const rows = [];
        
        // Transform funnel data with time calculations
        if (data.data && Array.isArray(data.data)) {
            data.data.forEach(item => {
                if (item.users && Array.isArray(item.users)) {
                    item.users.forEach(user => {
                        const timeInSeconds = user.time || 0;
                        rows.push({
                            'Funnel': funnelName,
                            'Distinct ID': user.$distinct_id || '',
                            [funnelName]: timeInSeconds
                        });
                    });
                }
            });
        }
        
        return { headers, rows };
    }
    
    transformPremiumSubscriptions(data) {
        const headers = [
            '$distinct_id', 'creatorUsername',
            '(1) Viewed Creator Paywall', '(2) Viewed Stripe Modal', '(3) Subscribed to Creator'
        ];
        const rows = [];
        
        // Transform grouped funnel data
        if (data.data && Array.isArray(data.data)) {
            data.data.forEach(group => {
                const creatorUsername = group.name || '';
                if (group.users && Array.isArray(group.users)) {
                    group.users.forEach(user => {
                        rows.push({
                            '$distinct_id': user.$distinct_id || '',
                            'creatorUsername': creatorUsername,
                            '(1) Viewed Creator Paywall': user.step_1 || 0,
                            '(2) Viewed Stripe Modal': user.step_2 || 0,
                            '(3) Subscribed to Creator': user.step_3 || 0
                        });
                    });
                }
            });
        }
        
        return { headers, rows };
    }
    
    transformCreatorCopyFunnel(data) {
        const headers = [
            '$distinct_id', 'creatorUsername',
            '(1) Viewed Portfolio Details', '(2) Started Copy Portfolio', '(3) Copied Portfolio'
        ];
        const rows = [];
        
        // Transform grouped funnel data
        if (data.data && Array.isArray(data.data)) {
            data.data.forEach(group => {
                const creatorUsername = group.name || '';
                if (group.users && Array.isArray(group.users)) {
                    group.users.forEach(user => {
                        rows.push({
                            '$distinct_id': user.$distinct_id || '',
                            'creatorUsername': creatorUsername,
                            '(1) Viewed Portfolio Details': user.step_1 || 0,
                            '(2) Started Copy Portfolio': user.step_2 || 0,
                            '(3) Copied Portfolio': user.step_3 || 0
                        });
                    });
                }
            });
        }
        
        return { headers, rows };
    }
    
    transformPortfolioCopyFunnel(data) {
        const headers = [
            '$distinct_id', 'portfolioTicker',
            '(1) Viewed Portfolio Details', '(2) Started Copy Portfolio', '(3) Copied Portfolio'
        ];
        const rows = [];
        
        // Transform grouped funnel data
        if (data.data && Array.isArray(data.data)) {
            data.data.forEach(group => {
                const portfolioTicker = group.name || '';
                if (group.users && Array.isArray(group.users)) {
                    group.users.forEach(user => {
                        rows.push({
                            '$distinct_id': user.$distinct_id || '',
                            'portfolioTicker': portfolioTicker,
                            '(1) Viewed Portfolio Details': user.step_1 || 0,
                            '(2) Started Copy Portfolio': user.step_2 || 0,
                            '(3) Copied Portfolio': user.step_3 || 0
                        });
                    });
                }
            });
        }
        
        return { headers, rows };
    }
    
    // Convert JSON data to CSV string
    jsonToCSV(headers, rows) {
        const csvRows = [];
        
        // Add headers
        csvRows.push(headers.join(','));
        
        // Add data rows
        rows.forEach(row => {
            const values = headers.map(header => {
                const value = row[header];
                // Escape values containing commas or quotes
                if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
                    return `"${value.replace(/"/g, '""')}"`;
                }
                return value || '';
            });
            csvRows.push(values.join(','));
        });
        
        return csvRows.join('\n');
    }
    
    // Test API connection
    async testConnection() {
        try {
            // Try to fetch a small amount of data to test credentials
            const today = new Date().toISOString().split('T')[0];
            const params = {
                project_id: this.projectToken,
                from_date: today,
                to_date: today,
                limit: 1
            };
            
            const url = `${this.baseURL}/events?${new URLSearchParams(params)}`;
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Authorization': this.getAuthHeader(),
                    'Accept': 'application/json'
                }
            });
            
            return response.ok;
        } catch (error) {
            console.error('Connection test failed:', error);
            return false;
        }
    }
}

// Export for use in other files
window.MixpanelSync = MixpanelSync;