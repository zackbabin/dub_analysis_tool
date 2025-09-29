#!/usr/bin/env node

/**
 * Fetch data from Mixpanel API and save as CSV files
 * This script runs in GitHub Actions to sync Mixpanel data
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// Configuration
const PROJECT_ID = '2599235';
const BASE_URL = 'https://mixpanel.com/api/2.0';

// Chart IDs from dashboard
const CHART_IDS = {
    subscribersInsights: '13682903',
    timeToFirstCopy: '84999271',
    timeToFundedAccount: '84999267',
    timeToLinkedBank: '84999265',
    premiumSubscriptions: '84999290',
    creatorCopyFunnel: '84999286',
    portfolioCopyFunnel: '84999289'
};

// Get credentials from environment variables
const SERVICE_USERNAME = process.env.MIXPANEL_SERVICE_USERNAME;
const SERVICE_SECRET = process.env.MIXPANEL_SERVICE_SECRET;

if (!SERVICE_USERNAME || !SERVICE_SECRET) {
    console.error('Error: Mixpanel credentials not found in environment variables');
    process.exit(1);
}

// Create auth header
const authString = `${SERVICE_USERNAME}:${SERVICE_SECRET}`;
const authHeader = `Basic ${Buffer.from(authString).toString('base64')}`;

// Date range (last 30 days)
const today = new Date();
const thirtyDaysAgo = new Date();
thirtyDaysAgo.setDate(today.getDate() - 30);

const toDate = today.toISOString().split('T')[0];
const fromDate = thirtyDaysAgo.toISOString().split('T')[0];

/**
 * Make HTTPS request to Mixpanel API
 */
function makeRequest(endpoint, params) {
    return new Promise((resolve, reject) => {
        const queryString = new URLSearchParams(params).toString();
        
        const options = {
            hostname: 'mixpanel.com',
            path: `/api/2.0${endpoint}`,
            method: 'POST',
            headers: {
                'Authorization': authHeader,
                'Accept': 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(queryString)
            }
        };
        
        console.log(`Fetching ${endpoint}...`);
        
        const req = https.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error(`Failed to parse response: ${e.message}`));
                    }
                } else {
                    console.error(`Error ${res.statusCode}: ${data}`);
                    reject(new Error(`API returned ${res.statusCode}: ${data}`));
                }
            });
        });
        
        req.on('error', reject);
        req.write(queryString);
        req.end();
    });
}

/**
 * Fetch funnel data
 */
async function fetchFunnelData(funnelId, name, groupBy = null) {
    console.log(`Fetching ${name} funnel data...`);
    
    const params = {
        project_id: PROJECT_ID,
        funnel_id: funnelId,
        from_date: fromDate,
        to_date: toDate
    };
    
    if (groupBy) {
        params.on = `properties["${groupBy}"]`;
    }
    
    try {
        return await makeRequest('/funnels', params);
    } catch (error) {
        console.error(`Error fetching ${name}:`, error.message);
        return null;
    }
}

/**
 * Fetch user profile data using JQL
 */
async function fetchUserProfiles() {
    console.log('Fetching user profiles via JQL...');
    
    const jqlScript = `
    function main() {
        return People()
            .filter(function(user) {
                return user.properties.$distinct_id !== undefined;
            });
    }
    `;
    
    const params = {
        project_id: PROJECT_ID,
        script: jqlScript.trim()
    };
    
    try {
        return await makeRequest('/jql', params);
    } catch (error) {
        console.error('Error fetching user profiles:', error.message);
        
        // Fallback: Try engage endpoint
        console.log('Trying engage endpoint as fallback...');
        try {
            return await makeRequest('/engage', {
                project_id: PROJECT_ID,
                page: 0,
                page_size: 1000
            });
        } catch (engageError) {
            console.error('Engage endpoint also failed:', engageError.message);
            return null;
        }
    }
}

/**
 * Convert data to CSV format
 */
function arrayToCSV(data) {
    if (!data || data.length === 0) return '';
    
    const headers = Object.keys(data[0]);
    const csvRows = [];
    
    // Add headers
    csvRows.push(headers.join(','));
    
    // Add data rows
    for (const row of data) {
        const values = headers.map(header => {
            const value = row[header];
            // Escape values containing commas or quotes
            if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
                return `"${value.replace(/"/g, '""')}"`;
            }
            return value ?? '';
        });
        csvRows.push(values.join(','));
    }
    
    return csvRows.join('\n');
}

/**
 * Process funnel data into CSV format
 */
function processFunnelData(data, funnelName) {
    if (!data || !data.data) {
        console.log(`No data for ${funnelName}`);
        return [];
    }
    
    const rows = [];
    
    // Time-based funnel (single funnel with time data)
    if (data.data.length === 1 && data.data[0].steps) {
        const steps = data.data[0].steps;
        // Look for time data in the last step
        const lastStep = steps[steps.length - 1];
        if (lastStep && lastStep.custom_event_params) {
            for (const [userId, timeValue] of Object.entries(lastStep.custom_event_params)) {
                rows.push({
                    'Funnel': funnelName,
                    'Distinct ID': userId,
                    [funnelName]: timeValue
                });
            }
        }
    }
    // Grouped funnel (multiple groups with user data)
    else if (Array.isArray(data.data)) {
        data.data.forEach(group => {
            if (group.users) {
                const groupName = group.name || '';
                group.users.forEach(user => {
                    const row = {
                        '$distinct_id': user.$distinct_id || '',
                        'group': groupName
                    };
                    
                    // Add step data
                    for (let i = 1; i <= 3; i++) {
                        row[`step_${i}`] = user[`step_${i}`] || 0;
                    }
                    
                    rows.push(row);
                });
            }
        });
    }
    
    return rows;
}

/**
 * Process user profile data into CSV format
 */
function processUserProfiles(data) {
    if (!data) {
        console.log('No user profile data');
        return [];
    }
    
    const rows = [];
    let users = [];
    
    // Handle different response formats
    if (data.results) {
        users = data.results;
    } else if (Array.isArray(data)) {
        users = data;
    }
    
    users.forEach(user => {
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
    
    return rows;
}

/**
 * Save data to CSV file
 */
function saveToCSV(data, filename) {
    const csv = arrayToCSV(data);
    if (!csv) {
        console.log(`No data to save for ${filename}`);
        return;
    }
    
    const filePath = path.join('data', filename);
    fs.writeFileSync(filePath, csv);
    console.log(`Saved ${data.length} rows to ${filename}`);
}

/**
 * Main function
 */
async function main() {
    console.log('Starting Mixpanel data fetch...');
    console.log(`Date range: ${fromDate} to ${toDate}`);
    
    // Create data directory if it doesn't exist
    if (!fs.existsSync('data')) {
        fs.mkdirSync('data');
    }
    
    try {
        // 1. Fetch User Profiles
        const userProfiles = await fetchUserProfiles();
        const processedProfiles = processUserProfiles(userProfiles);
        saveToCSV(processedProfiles, '1_subscribers_insights.csv');
        
        // 2. Fetch Time to First Copy
        const firstCopy = await fetchFunnelData(
            CHART_IDS.timeToFirstCopy,
            'Time to First Copy'
        );
        const processedFirstCopy = processFunnelData(firstCopy, 'Time to First Copy');
        saveToCSV(processedFirstCopy, '2_time_to_first_copy.csv');
        
        // 3. Fetch Time to Funded Account
        const fundedAccount = await fetchFunnelData(
            CHART_IDS.timeToFundedAccount,
            'Time to Funded Account'
        );
        const processedFunded = processFunnelData(fundedAccount, 'Time to Funded Account');
        saveToCSV(processedFunded, '3_time_to_funded_account.csv');
        
        // 4. Fetch Time to Linked Bank
        const linkedBank = await fetchFunnelData(
            CHART_IDS.timeToLinkedBank,
            'Time to Linked Bank'
        );
        const processedLinked = processFunnelData(linkedBank, 'Time to Linked Bank');
        saveToCSV(processedLinked, '4_time_to_linked_bank.csv');
        
        // 5. Fetch Premium Subscriptions (grouped by creator)
        const premiumSubs = await fetchFunnelData(
            CHART_IDS.premiumSubscriptions,
            'Premium Subscriptions',
            'creatorUsername'
        );
        const processedPremium = processFunnelData(premiumSubs, 'Premium Subscriptions');
        saveToCSV(processedPremium, '5_premium_subscriptions.csv');
        
        // 6. Fetch Creator Copy Funnel (grouped by creator)
        const creatorCopy = await fetchFunnelData(
            CHART_IDS.creatorCopyFunnel,
            'Creator Copy Funnel',
            'creatorUsername'
        );
        const processedCreator = processFunnelData(creatorCopy, 'Creator Copy Funnel');
        saveToCSV(processedCreator, '6_creator_copy_funnel.csv');
        
        // 7. Fetch Portfolio Copy Funnel (grouped by portfolio)
        const portfolioCopy = await fetchFunnelData(
            CHART_IDS.portfolioCopyFunnel,
            'Portfolio Copy Funnel',
            'portfolioTicker'
        );
        const processedPortfolio = processFunnelData(portfolioCopy, 'Portfolio Copy Funnel');
        saveToCSV(processedPortfolio, '7_portfolio_copy_funnel.csv');
        
        console.log('\n✅ All data fetched and saved successfully!');
        
    } catch (error) {
        console.error('Error in main function:', error);
        process.exit(1);
    }
}

// Run the script
main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
