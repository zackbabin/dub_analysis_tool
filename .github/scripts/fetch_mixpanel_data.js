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
const API_BASE = 'https://api.mixpanel.com';

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
function makeRequest(endpoint, params, method = 'GET') {
    return new Promise((resolve, reject) => {
        const queryString = new URLSearchParams(params).toString();

        const options = {
            hostname: 'mixpanel.com',
            path: method === 'GET' ? `/api/2.0${endpoint}?${queryString}` : `/api/2.0${endpoint}`,
            method: method,
            headers: {
                'Authorization': authHeader,
                'Accept': 'application/json'
            }
        };

        if (method === 'POST') {
            options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
            options.headers['Content-Length'] = Buffer.byteLength(queryString);
        }

        console.log(`Fetching ${endpoint} via ${method}...`);

        const req = https.request(options, (res) => {
            const chunks = [];
            let totalLength = 0;

            res.on('data', (chunk) => {
                chunks.push(chunk);
                totalLength += chunk.length;

                // Prevent excessive memory usage
                if (totalLength > 50 * 1024 * 1024) { // 50MB limit
                    reject(new Error('Response too large - exceeds 50MB limit'));
                    return;
                }
            });

            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        const data = Buffer.concat(chunks).toString();
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error(`Failed to parse response: ${e.message}`));
                    }
                } else {
                    const errorData = Buffer.concat(chunks).toString();
                    console.error(`Error ${res.statusCode}: ${errorData}`);
                    reject(new Error(`API returned ${res.statusCode}: ${errorData}`));
                }
            });
        });
        
        req.on('error', reject);

        if (method === 'POST') {
            req.write(queryString);
        }
        req.end();
    });
}

/**
 * Fetch funnel data
 */
async function fetchFunnelData(funnelId, name, groupBy = null) {
    console.log(`Fetching ${name} funnel data (ID: ${funnelId})...`);

    const params = {
        project_id: PROJECT_ID,
        funnel_id: funnelId,
        from_date: fromDate,
        to_date: toDate
    };

    if (groupBy) {
        params.on = `properties["${groupBy}"]`;
        console.log(`  Grouping by: ${groupBy}`);
    }

    console.log(`  API params:`, JSON.stringify(params, null, 2));

    try {
        // Use original funnel endpoint that was working before
        const result = await makeRequest('/funnels', params, 'POST');
        console.log(`  ✓ ${name} fetch successful. Data:`, result ? 'received' : 'null');
        if (result) {
            console.log(`  Response keys:`, Object.keys(result));
            if (result.data) {
                console.log(`  Data type:`, typeof result.data);
                console.log(`  Data length: ${Array.isArray(result.data) ? result.data.length : 'not array'}`);
                if (!Array.isArray(result.data)) {
                    console.log(`  Data structure:`, Object.keys(result.data));
                }
            }
        }
        return result;
    } catch (error) {
        console.error(`  ✗ Error fetching ${name}:`, error.message);
        return null;
    }
}

/**
 * Fetch Insights data using correct API endpoint
 * https://developer.mixpanel.com/reference/insights-query
 */
async function fetchInsightsData(chartId, name) {
    console.log(`Fetching ${name} insights data (ID: ${chartId})...`);

    const params = {
        bookmark_id: chartId,
        from_date: fromDate,
        to_date: toDate
    };

    console.log(`  API params:`, JSON.stringify(params, null, 2));

    try {
        // Use POST method for insights endpoint
        const result = await makeRequest('/insights', params, 'POST');
        console.log(`  ✓ ${name} fetch successful. Data:`, result ? 'received' : 'null');
        if (result) {
            console.log(`  Response keys:`, Object.keys(result));
            if (result.data) {
                console.log(`  Data type:`, typeof result.data);
                console.log(`  Data keys:`, typeof result.data === 'object' ? Object.keys(result.data).slice(0, 10) : 'N/A');
            }
        }
        return result;
    } catch (error) {
        console.error(`  ✗ Error fetching ${name}:`, error.message);
        return null;
    }
}

/**
 * Fetch user profiles using engage endpoint with pagination
 */
async function fetchUserProfilesPaginated() {
    const allUsers = [];
    let page = 0;
    const pageSize = 1000;
    let hasMore = true;
    let sessionId = null;

    // Filter for users who have been active in the date range
    const whereClause = `"$last_seen" >= "${fromDate}" and "$last_seen" <= "${toDate}"`;

    while (hasMore && page < 20) { // Limit to 20 pages (20,000 users) to avoid timeout
        console.log(`Fetching page ${page + 1}...`);

        try {
            const params = {
                project_id: PROJECT_ID,
                page_size: pageSize,
                where: whereClause
            };

            // Add session_id for subsequent pages
            if (sessionId) {
                params.session_id = sessionId;
                params.page = page;
            }

            const response = await makeRequest('/engage', params, 'GET');

            if (response && response.results && response.results.length > 0) {
                allUsers.push(...response.results);

                // Store session_id for next page
                if (response.session_id) {
                    sessionId = response.session_id;
                }

                hasMore = response.results.length === pageSize;
                page++;

                console.log(`Fetched ${response.results.length} users (total: ${allUsers.length})`);

                // Add delay between requests to avoid rate limiting
                if (hasMore) {
                    await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second between requests
                }
            } else {
                hasMore = false;
            }
        } catch (error) {
            console.error(`Error fetching page ${page}:`, error.message);
            // Don't immediately stop on error - log it and continue
            if (page === 0) {
                // If first page fails, stop
                hasMore = false;
            } else {
                // If later page fails, we already have some data
                console.log(`Stopping pagination after error on page ${page}. Total users: ${allUsers.length}`);
                hasMore = false;
            }
        }
    }

    console.log(`Total users fetched: ${allUsers.length}`);
    return { results: allUsers };
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

    // Handle the new date-based object format where dates are keys
    // and values are objects with user IDs as keys
    if (typeof data.data === 'object' && !Array.isArray(data.data)) {
        console.log(`Processing date-based funnel data for ${funnelName}`);

        // Collect all unique user IDs across all dates
        const allUserIds = new Set();
        for (const [date, dateData] of Object.entries(data.data)) {
            if (dateData && typeof dateData === 'object') {
                Object.keys(dateData).forEach(key => {
                    // Filter out non-user keys like '$overall'
                    if (key.startsWith('$device:') || key.match(/^[A-F0-9-]+$/i) || key.match(/^[a-z0-9-]+$/i)) {
                        allUserIds.add(key);
                    }
                });
            }
        }

        console.log(`  Found ${allUserIds.size} unique user IDs across all dates`);

        // For each user, extract their data
        allUserIds.forEach(userId => {
            // Clean up the user ID (remove $device: prefix if present)
            const cleanUserId = userId.replace('$device:', '');

            // Collect data for this user across all dates
            let userData = null;
            for (const [date, dateData] of Object.entries(data.data)) {
                if (dateData && dateData[userId] && typeof dateData[userId] === 'object') {
                    userData = dateData[userId];
                    break; // Found user data, use it
                }
            }

            if (userData) {
                const row = {
                    'Funnel': funnelName,
                    'Distinct ID': cleanUserId
                };

                // Add the time value (for time-based funnels) or other metrics
                if (userData.time !== undefined) {
                    row[funnelName] = userData.time;
                } else if (userData.value !== undefined) {
                    row[funnelName] = userData.value;
                } else {
                    // For step-based funnels, extract all numeric values
                    row[funnelName] = userData.steps ? userData.steps[userData.steps.length - 1] : 0;
                }

                rows.push(row);
            }
        });
    }
    // Legacy format handling (keep for backward compatibility)
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

    console.log(`Processed ${rows.length} funnel rows for ${funnelName}`);
    return rows;
}

/**
 * Process grouped funnel data (by creator or portfolio) into CSV format
 */
function processGroupedFunnelData(data, funnelName, groupByField) {
    if (!data || !data.data) {
        console.log(`No data for ${funnelName}`);
        return [];
    }

    const rows = [];

    // Check if data is in the new date-based format
    if (typeof data.data === 'object' && !Array.isArray(data.data)) {
        console.log(`Processing date-based grouped funnel data for ${funnelName}`);

        // Collect all user IDs and their group associations
        const userDataMap = new Map(); // userId -> {groupValue, steps}

        for (const [date, dateData] of Object.entries(data.data)) {
            if (dateData && typeof dateData === 'object') {
                Object.entries(dateData).forEach(([key, value]) => {
                    // Skip meta keys like '$overall'
                    if (key.startsWith('$')) return;

                    // The key might be the group value (e.g., creator username)
                    // and the value contains user data
                    if (value && typeof value === 'object') {
                        // Check if this is group data with users
                        if (value.users && Array.isArray(value.users)) {
                            value.users.forEach(user => {
                                const userId = user.$distinct_id || user.distinct_id;
                                if (userId) {
                                    userDataMap.set(userId, {
                                        groupValue: key,
                                        steps: user.steps || []
                                    });
                                }
                            });
                        } else if (value.$distinct_id || value.distinct_id) {
                            // Single user object
                            const userId = value.$distinct_id || value.distinct_id;
                            userDataMap.set(userId, {
                                groupValue: key,
                                steps: value.steps || []
                            });
                        }
                    }
                });
            }
        }

        console.log(`  Found ${userDataMap.size} users in grouped funnel`);

        // Convert to rows
        userDataMap.forEach((userData, userId) => {
            const row = {
                '$distinct_id': userId,
                [groupByField]: userData.groupValue
            };

            // Add funnel steps based on funnelName
            if (funnelName === 'Premium Subscriptions') {
                row['(1) Viewed Creator Paywall'] = userData.steps[0] || 0;
                row['(2) Viewed Stripe Modal'] = userData.steps[1] || 0;
                row['(3) Subscribed to Creator'] = userData.steps[2] || 0;
            } else if (funnelName === 'Creator Copy Funnel' || funnelName === 'Portfolio Copy Funnel') {
                row['(1) Viewed Portfolio Details'] = userData.steps[0] || 0;
                row['(2) Started Copy Portfolio'] = userData.steps[1] || 0;
                row['(3) Copied Portfolio'] = userData.steps[2] || 0;
            }

            rows.push(row);
        });
    }
    // Legacy array format
    else if (Array.isArray(data.data)) {
        data.data.forEach(group => {
            if (group.users) {
                const groupValue = group.name || '';
                group.users.forEach(user => {
                    const row = {
                        '$distinct_id': user.$distinct_id || '',
                        [groupByField]: groupValue
                    };

                    // Add funnel steps
                    if (funnelName === 'Premium Subscriptions') {
                        row['(1) Viewed Creator Paywall'] = user.step_1 || 0;
                        row['(2) Viewed Stripe Modal'] = user.step_2 || 0;
                        row['(3) Subscribed to Creator'] = user.step_3 || 0;
                    } else if (funnelName === 'Creator Copy Funnel' || funnelName === 'Portfolio Copy Funnel') {
                        row['(1) Viewed Portfolio Details'] = user.step_1 || 0;
                        row['(2) Started Copy Portfolio'] = user.step_2 || 0;
                        row['(3) Copied Portfolio'] = user.step_3 || 0;
                    }

                    rows.push(row);
                });
            }
        });
    }

    console.log(`Processed ${rows.length} rows for grouped funnel ${funnelName}`);
    return rows;
}

/**
 * Extract user IDs from Insights data
 */
function extractUserIdsFromInsights(data) {
    const userIds = new Set();

    if (!data || !data.data) {
        console.log('No insights data to extract users from');
        return userIds;
    }

    console.log('Insights data type:', typeof data.data);
    console.log('Insights data structure:', JSON.stringify(data).substring(0, 500));

    // Handle insights data broken down by distinct_id
    if (typeof data.data === 'object' && !Array.isArray(data.data)) {
        console.log('Extracting users from distinct_id breakdown format');

        // data.data is an object where keys might be distinct_ids
        Object.keys(data.data).forEach(key => {
            // Skip aggregate keys like $overall
            if (key.startsWith('$overall') || key === 'total' || key.startsWith('$')) {
                return;
            }

            // Clean up device prefix and add to set
            const cleanId = key.replace('$device:', '');

            // Only add if it looks like a user ID (UUID or device ID format)
            if (cleanId.match(/^[A-F0-9-]+$/i) || cleanId.match(/^[a-z0-9-]+$/i)) {
                userIds.add(cleanId);
            }
        });
    }

    console.log(`Extracted ${userIds.size} user IDs from insights chart`);
    return userIds;
}

/**
 * Process Insights data into CSV format
 * For subscriber insights broken down by distinct_id and properties
 */
function processInsightsData(data) {
    if (!data || !data.data) {
        console.log('No insights data');
        return [];
    }

    const rows = [];

    // Handle insights data broken down by distinct_id (like Demo breakdown of subscribers)
    if (typeof data.data === 'object' && !Array.isArray(data.data)) {
        console.log('Processing distinct_id breakdown format');

        // data.data is an object where keys are distinct_ids or property values
        Object.entries(data.data).forEach(([key, value]) => {
            // Skip aggregate keys like $overall
            if (key.startsWith('$overall') || key === 'total') return;

            const row = {
                '$distinct_id': key.replace('$device:', '') // Clean up device prefix
            };

            // The value might be an object with property values or a simple value
            if (typeof value === 'object' && value !== null) {
                Object.entries(value).forEach(([propKey, propValue]) => {
                    row[propKey] = propValue;
                });
            } else {
                row['value'] = value;
            }

            rows.push(row);
        });
    }
    // Handle different Insights data formats (fallback)
    else if (data.data.series && Array.isArray(data.data.series)) {
        // Time series data format
        data.data.series.forEach((series, index) => {
            if (series.data) {
                series.data.forEach((point, pointIndex) => {
                    rows.push({
                        'Series': series.name || `Series ${index}`,
                        'Date': data.data.dates ? data.data.dates[pointIndex] : pointIndex,
                        'Value': point
                    });
                });
            }
        });
    } else if (Array.isArray(data.data)) {
        // Simple array format
        data.data.forEach((item, index) => {
            if (typeof item === 'object') {
                rows.push(item);
            } else {
                rows.push({
                    'Index': index,
                    'Value': item
                });
            }
        });
    } else if (data.data.values) {
        // Key-value format
        Object.entries(data.data.values).forEach(([key, value]) => {
            rows.push({
                'Property': key,
                'Value': value
            });
        });
    }

    console.log(`Processed ${rows.length} insights rows`);
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
            'Distinct ID': user.$distinct_id || properties.$distinct_id || '',
            'income': properties.income || '',
            'netWorth': properties.netWorth || '',
            'hasLinkedBank': properties.hasLinkedBank || '',
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
            'A. Total of User Profiles': 1,
            'B. Linked Bank Account': properties.hasLinkedBank || 0,
            'C. Total Deposits ($)': properties.totalDeposits || 0,
            'D. Total Deposit Count': properties.totalDepositCount || 0,
            'E. Total Subscriptions': properties.totalSubscriptions || 0,
            'F. Subscribed within 7 days': properties.subscribedWithin7Days || 0,
            'G. Total Copies': properties.totalCopies || 0,
            'H. Total Regular Copies': properties.totalRegularCopies || 0,
            'I. Regular PDP Views': properties.regularPDPViews || 0,
            'J. Premium PDP Views': properties.premiumPDPViews || 0,
            'K. Paywall Views': properties.paywallViews || 0,
            'L. Regular Creator Profile Views': properties.regularCreatorProfileViews || 0,
            'M. Premium Creator Profile Views': properties.premiumCreatorProfileViews || 0,
            'N. App Sessions': properties.appSessions || 0,
            'O. Discover Tab Views': properties.discoverTabViews || 0,
            'P. Leaderboard Views': properties.leaderboardViews || 0,
            'Q. Premium Tab Views': properties.premiumTabViews || 0
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
 * Extract unique user IDs from funnel data
 */
function extractUserIdsFromFunnelData(data) {
    const userIds = new Set();

    if (!data || !data.data) return userIds;

    if (typeof data.data === 'object' && !Array.isArray(data.data)) {
        // Date-based format
        for (const [date, dateData] of Object.entries(data.data)) {
            if (dateData && typeof dateData === 'object') {
                Object.keys(dateData).forEach(key => {
                    // Filter user IDs
                    if (key.startsWith('$device:') || key.match(/^[A-F0-9-]+$/i) || key.match(/^[a-z0-9-]+$/i)) {
                        const cleanId = key.replace('$device:', '');
                        userIds.add(cleanId);
                    }
                });
            }
        }
    } else if (Array.isArray(data.data)) {
        // Legacy format
        data.data.forEach(group => {
            if (group.users) {
                group.users.forEach(user => {
                    const userId = user.$distinct_id || user.distinct_id;
                    if (userId) {
                        const cleanId = userId.replace('$device:', '');
                        userIds.add(cleanId);
                    }
                });
            }
        });
    }

    return userIds;
}

/**
 * Fetch user profiles for specific user IDs
 */
async function fetchUserProfilesByIds(userIds) {
    console.log(`Fetching profiles for ${userIds.length} specific users...`);

    const allProfiles = [];
    const batchSize = 100; // Fetch in batches to avoid URL length limits

    for (let i = 0; i < userIds.length; i += batchSize) {
        const batch = userIds.slice(i, i + batchSize);
        console.log(`  Fetching batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(userIds.length/batchSize)}...`);

        try {
            // Use engage API with where clause to filter by distinct_id
            const distinctIdList = batch.map(id => `"${id}"`).join(',');
            const whereClause = `"$distinct_id" in [${distinctIdList}]`;

            const params = {
                project_id: PROJECT_ID,
                where: whereClause
            };

            const response = await makeRequest('/engage', params, 'GET');

            if (response && response.results && response.results.length > 0) {
                allProfiles.push(...response.results);
                console.log(`    Fetched ${response.results.length} profiles`);
            }

            // Small delay between batches
            if (i + batchSize < userIds.length) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        } catch (error) {
            console.error(`Error fetching batch:`, error.message);
        }
    }

    console.log(`Total profiles fetched: ${allProfiles.length}`);
    return { results: allProfiles };
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
        // Step 1: Fetch the Subscribers Insights chart to get the exact user list
        console.log('\n=== Step 1: Fetching Subscribers Insights chart to identify users ===');

        const subscribersData = await fetchInsightsData(
            CHART_IDS.subscribersInsights,
            'Subscribers Insights'
        );

        // Extract user IDs from the insights chart
        const baseUserIds = extractUserIdsFromInsights(subscribersData);

        console.log(`Found ${baseUserIds.size} users from Subscribers Insights chart`);

        // Step 2: Fetch user profiles for only those specific users
        console.log('\n=== Step 2: Fetching user profiles for identified users ===');

        let userProfiles;
        if (baseUserIds.size > 0 && baseUserIds.size < 10000) {
            console.log(`Fetching profiles for ${baseUserIds.size} specific users...`);
            userProfiles = await fetchUserProfilesByIds(Array.from(baseUserIds));
        } else {
            console.log(`User count outside expected range (${baseUserIds.size}), falling back to paginated fetch with limit`);
            // Fallback: fetch with pagination but limit to 5 pages
            userProfiles = { results: [] };
            let page = 0;
            const pageSize = 1000;
            let sessionId = null;

            while (page < 5) {
                const params = {
                    project_id: PROJECT_ID,
                    page_size: pageSize
                };

                if (sessionId) {
                    params.session_id = sessionId;
                    params.page = page;
                }

                const response = await makeRequest('/engage', params, 'GET');

                if (response && response.results && response.results.length > 0) {
                    userProfiles.results.push(...response.results);

                    // Store session_id for next page
                    if (response.session_id) {
                        sessionId = response.session_id;
                    }

                    page++;
                    console.log(`Fetched page ${page}, total users: ${userProfiles.results.length}`);

                    if (response.results.length < pageSize) break;
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } else {
                    break;
                }
            }
        }

        const processedProfiles = processUserProfiles(userProfiles);
        saveToCSV(processedProfiles, '1_subscribers_insights.csv');

        // Step 3: Fetch all funnel data
        console.log('\n=== Step 3: Fetching funnel data ===');

        const firstCopy = await fetchFunnelData(
            CHART_IDS.timeToFirstCopy,
            'Time to First Copy'
        );
        const processedFirstCopy = processFunnelData(firstCopy, 'Time to First Copy');
        saveToCSV(processedFirstCopy, '2_time_to_first_copy.csv');

        const fundedAccount = await fetchFunnelData(
            CHART_IDS.timeToFundedAccount,
            'Time to Funded Account'
        );
        const processedFunded = processFunnelData(fundedAccount, 'Time to Funded Account');
        saveToCSV(processedFunded, '3_time_to_funded_account.csv');

        const linkedBank = await fetchFunnelData(
            CHART_IDS.timeToLinkedBank,
            'Time to Linked Bank'
        );
        const processedLinked = processFunnelData(linkedBank, 'Time to Linked Bank');
        saveToCSV(processedLinked, '4_time_to_linked_bank.csv');

        const premiumSubs = await fetchFunnelData(
            CHART_IDS.premiumSubscriptions,
            'Premium Subscriptions',
            'creatorUsername'
        );
        const processedPremium = processGroupedFunnelData(premiumSubs, 'Premium Subscriptions', 'creatorUsername');
        saveToCSV(processedPremium, '5_premium_subscriptions.csv');

        const creatorCopy = await fetchFunnelData(
            CHART_IDS.creatorCopyFunnel,
            'Creator Copy Funnel',
            'creatorUsername'
        );
        const processedCreator = processGroupedFunnelData(creatorCopy, 'Creator Copy Funnel', 'creatorUsername');
        saveToCSV(processedCreator, '6_creator_copy_funnel.csv');

        const portfolioCopy = await fetchFunnelData(
            CHART_IDS.portfolioCopyFunnel,
            'Portfolio Copy Funnel',
            'portfolioTicker'
        );
        const processedPortfolio = processGroupedFunnelData(portfolioCopy, 'Portfolio Copy Funnel', 'portfolioTicker');
        saveToCSV(processedPortfolio, '7_portfolio_copy_funnel.csv');

        console.log('\n✅ All data fetched and saved successfully!');
        console.log('Note: The 6 funnel files will be merged into the subscribers insights file by the data merger.');

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
