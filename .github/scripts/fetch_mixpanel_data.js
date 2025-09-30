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
    subscribersInsights: '84933160',
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
 * Fetch funnel data using Query API
 * https://developer.mixpanel.com/reference/funnels-query
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
        // Create custom request for query API (different from /api/2.0)
        const queryString = new URLSearchParams(params).toString();

        const options = {
            hostname: 'mixpanel.com',
            path: `/api/query/funnels?${queryString}`,
            method: 'GET',
            headers: {
                'Authorization': authHeader,
                'Accept': 'application/json'
            }
        };

        console.log(`Fetching /api/query/funnels via GET...`);

        const result = await new Promise((resolve, reject) => {
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
            req.end();
        });

        console.log(`  ✓ ${name} fetch successful. Data:`, result ? 'received' : 'null');
        if (result) {
            console.log(`  Response keys:`, Object.keys(result));
            console.log(`  Full response structure:`, JSON.stringify(result, null, 2).substring(0, 2000));

            if (result.headers) {
                console.log(`  Headers: ${result.headers.join(', ')}`);
            }

            if (result.series) {
                console.log(`  Series count:`, result.series.length);
                if (result.series.length > 0) {
                    console.log(`  First series sample:`, JSON.stringify(result.series[0], null, 2).substring(0, 500));
                }
            }

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
 * Uses /api/query/insights instead of /api/2.0/insights
 */
async function fetchInsightsData(chartId, name) {
    console.log(`Fetching ${name} insights data (ID: ${chartId})...`);

    const params = {
        project_id: PROJECT_ID,
        bookmark_id: chartId
    };

    console.log(`  API params:`, JSON.stringify(params, null, 2));

    try {
        // Create custom request for query API (different from /api/2.0)
        const queryString = new URLSearchParams(params).toString();

        const options = {
            hostname: 'mixpanel.com',
            path: `/api/query/insights?${queryString}`,
            method: 'GET',
            headers: {
                'Authorization': authHeader,
                'Accept': 'application/json'
            }
        };

        console.log(`Fetching /api/query/insights via GET...`);

        const result = await new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                const chunks = [];

                res.on('data', (chunk) => {
                    chunks.push(chunk);
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
            req.end();
        });

        console.log(`  ✓ ${name} fetch successful. Data:`, result ? 'received' : 'null');
        if (result) {
            console.log(`  Response keys:`, Object.keys(result));
            console.log(`  Full response structure:`, JSON.stringify(result, null, 2).substring(0, 2000));

            if (result.series !== undefined) {
                console.log(`  Series type:`, typeof result.series);
                console.log(`  Series is array:`, Array.isArray(result.series));

                if (result.series && typeof result.series === 'object') {
                    console.log(`  Series keys:`, Object.keys(result.series).slice(0, 10));
                    console.log(`  Series sample:`, JSON.stringify(result.series).substring(0, 1000));
                }

                if (Array.isArray(result.series)) {
                    console.log(`  Series count:`, result.series.length);
                    if (result.series.length > 0) {
                        console.log(`  First series sample:`, JSON.stringify(result.series[0], null, 2).substring(0, 500));
                    }
                }
            }

            if (result.data) {
                console.log(`  Data type:`, typeof result.data);
                if (typeof result.data === 'object') {
                    const dataKeys = Object.keys(result.data);
                    console.log(`  Data has ${dataKeys.length} keys`);
                    console.log(`  First 10 keys:`, dataKeys.slice(0, 10));
                    // Show sample of first key's data
                    if (dataKeys.length > 0) {
                        const firstKey = dataKeys[0];
                        console.log(`  Sample data for '${firstKey}':`, JSON.stringify(result.data[firstKey]).substring(0, 200));
                    }
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
    if (!data) {
        console.log(`No data for ${funnelName}`);
        return [];
    }

    const rows = [];

    // Handle Query API tabular format with headers and series (like Insights)
    if (data.headers && Array.isArray(data.headers) && data.series && Array.isArray(data.series)) {
        console.log(`Processing Query API tabular format for ${funnelName}`);
        console.log(`  Headers: ${data.headers.join(', ')}`);
        console.log(`  Processing ${data.series.length} rows`);

        // Find the $distinct_id column index
        const distinctIdIndex = data.headers.indexOf('$distinct_id');

        // Each series item is a row of data corresponding to the headers
        data.series.forEach((rowData, index) => {
            if (Array.isArray(rowData)) {
                const row = {};

                // Map each value to its corresponding header
                data.headers.forEach((header, headerIndex) => {
                    if (headerIndex < rowData.length) {
                        row[header] = rowData[headerIndex];
                    }
                });

                // Add funnel name for clarity
                row['Funnel'] = funnelName;

                rows.push(row);
            }
        });
    }
    // Handle the date-based object format (Funnel API format)
    else if (data.data && typeof data.data === 'object' && !Array.isArray(data.data)) {
        console.log(`Processing date-based funnel data for ${funnelName}`);

        // Collect all unique user IDs across all dates
        const allUserIds = new Set();
        for (const [date, dateData] of Object.entries(data.data)) {
            if (dateData && typeof dateData === 'object') {
                Object.keys(dateData).forEach(key => {
                    // Filter out non-user keys like '$overall'
                    if (key.startsWith('$device:') || key.match(/^[A-F0-9-]+$/i)) {
                        allUserIds.add(key);
                    }
                });
            }
        }

        console.log(`  Found ${allUserIds.size} unique user IDs across all dates`);

        // For each user, extract their data
        allUserIds.forEach(userId => {
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
                    '$distinct_id': userId
                };

                // userData IS the array of steps directly (not wrapped in $overall)
                // Check if it's an array or array-like object
                const isArrayLike = Array.isArray(userData) || (typeof userData === 'object' && userData.length !== undefined);

                if (rows.length < 3) {
                    console.log(`  Sample user ${userId.substring(0, 20)}... isArrayLike: ${isArrayLike}, length: ${userData.length || 'N/A'}`);
                    if (isArrayLike && userData.length > 0) {
                        const lastStep = userData[userData.length - 1];
                        console.log(`    Last step: ${JSON.stringify(lastStep).substring(0, 150)}`);
                    }
                }

                // Convert array-like object to actual array if needed
                let steps = Array.isArray(userData) ? userData : [];
                if (!Array.isArray(userData) && userData.length !== undefined) {
                    // It's an array-like object (with numeric keys)
                    steps = [];
                    for (let i = 0; i < userData.length; i++) {
                        if (userData[i]) steps.push(userData[i]);
                    }
                }

                if (steps.length > 0) {
                    // For time-to-event funnels (Time to First Copy, etc.)
                    // Extract the last step's avg_time_from_start and convert to days
                    if (funnelName.includes('Time to')) {
                        const lastStep = steps[steps.length - 1];
                        if (lastStep && lastStep.avg_time_from_start !== null && lastStep.avg_time_from_start !== undefined) {
                            // Convert from seconds to days
                            const timeInDays = lastStep.avg_time_from_start / 86400;
                            row[funnelName] = timeInDays;
                        } else {
                            row[funnelName] = null;
                        }
                    } else {
                        // For conversion funnels, extract counts for each step
                        steps.forEach((step, index) => {
                            const stepLabel = step.step_label || `Step ${index + 1}`;
                            row[stepLabel] = step.count;
                        });
                    }
                } else {
                    console.log(`Warning: No step data for user ${userId}`);
                }

                rows.push(row);
            }
        });
    }
    // Legacy array format handling
    else if (data.data && Array.isArray(data.data)) {
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
    if (!data) {
        console.log(`No data for ${funnelName}`);
        return [];
    }

    const rows = [];

    // Grouped funnels use the date-based format (Funnel API format)
    if (typeof data.data === 'object' && !Array.isArray(data.data)) {
        console.log(`Processing date-based grouped funnel data for ${funnelName}`);

        // Structure: data[date][userId][groupValue] = [step array]
        // We need to create one row per user per group value

        for (const [date, dateData] of Object.entries(data.data)) {
            if (dateData && typeof dateData === 'object') {
                Object.entries(dateData).forEach(([userId, userData]) => {
                    // Skip non-user keys like '$overall'
                    if (!userId.startsWith('$device:') && !userId.match(/^[A-F0-9-]+$/i)) {
                        return;
                    }

                    // userData is an object with keys like '$overall', '@justin', 'portfolioTicker', etc.
                    if (userData && typeof userData === 'object') {
                        Object.entries(userData).forEach(([groupKey, groupData]) => {
                            // Skip $overall - we want the specific group breakdowns
                            if (groupKey === '$overall') {
                                return;
                            }

                            // groupData should be an array of step objects
                            if (Array.isArray(groupData)) {
                                const row = {
                                    '$distinct_id': userId,
                                    [groupByField]: groupKey
                                };

                                // Extract step counts from the array
                                groupData.forEach((step, index) => {
                                    const stepLabel = step.step_label || `Step ${index + 1}`;
                                    row[stepLabel] = step.count;
                                });

                                rows.push(row);
                            }
                        });
                    }
                });
            }
        }

        console.log(`  Found ${rows.length} user-group combinations in grouped funnel`);
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

    if (!data) {
        console.log('No insights data to extract users from');
        return userIds;
    }

    console.log('Insights response structure:', JSON.stringify(data).substring(0, 500));

    // Check if data has nested object format (Query API with metrics and nested user IDs)
    if (data.series && typeof data.series === 'object' && !Array.isArray(data.series)) {
        console.log('Extracting users from nested object format (Query API)');

        // Recursively search through the nested object for user IDs
        function extractUserIdsRecursive(obj, depth = 0) {
            if (depth > 20) return; // Prevent infinite recursion

            if (obj && typeof obj === 'object') {
                Object.keys(obj).forEach(key => {
                    // Skip meta keys
                    if (key === '$overall' || key === 'all' || key === 'undefined') {
                        // Still recurse into these to find user IDs deeper
                        if (typeof obj[key] === 'object') {
                            extractUserIdsRecursive(obj[key], depth + 1);
                        }
                        return;
                    }

                    // Check if key looks like a user ID (distinct_id)
                    // User IDs can be:
                    // - $device:UUID format: $device:C5750779-0793-4CCF-B8B0-5E924BCB1808
                    // - Numeric IDs: 537058217606729728
                    // - UUID format without prefix: C5750779-0793-4CCF-B8B0-5E924BCB1808
                    if (key.startsWith('$device:') ||
                        key.match(/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i) ||
                        (key.match(/^[0-9]+$/) && key.length > 10)) {

                        userIds.add(key);

                        if (userIds.size <= 5) {
                            console.log(`  Sample user ID found: ${key}`);
                        }
                    }

                    // Recurse into nested objects
                    if (typeof obj[key] === 'object') {
                        extractUserIdsRecursive(obj[key], depth + 1);
                    }
                });
            }
        }

        extractUserIdsRecursive(data.series);
        console.log(`Found ${userIds.size} unique user IDs in nested structure`);
    }
    // Check if data has tabular format (Query API format with headers and series array)
    else if (data.headers && Array.isArray(data.headers) && data.series && Array.isArray(data.series)) {
        console.log('Extracting users from tabular format (Query API)');
        console.log(`Headers: ${data.headers.join(', ')}`);
        console.log(`Found ${data.series.length} rows`);

        // Find the index of the $distinct_id column
        const distinctIdIndex = data.headers.indexOf('$distinct_id');

        if (distinctIdIndex === -1) {
            console.log('Warning: $distinct_id column not found in headers');
            return userIds;
        }

        console.log(`$distinct_id is at column index ${distinctIdIndex}`);

        // Each series item is a row of data
        data.series.forEach((row, idx) => {
            if (Array.isArray(row) && row.length > distinctIdIndex) {
                const userId = row[distinctIdIndex];
                if (userId) {
                    userIds.add(String(userId));
                    if (idx < 5) {
                        console.log(`  Sample row ${idx}: distinct_id = ${userId}`);
                    }
                }
            }
        });
    }
    // Handle insights data broken down by distinct_id (legacy format)
    else if (data.data && typeof data.data === 'object' && !Array.isArray(data.data)) {
        console.log('Extracting users from distinct_id breakdown format (legacy)');

        // data.data is an object where keys might be distinct_ids
        Object.keys(data.data).forEach(key => {
            // Skip aggregate keys like $overall
            if (key.startsWith('$overall') || key === 'total') {
                return;
            }

            // Add the key as-is (keep $device: prefix)
            userIds.add(key);
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
    if (!data) {
        console.log('No insights data');
        return [];
    }

    const rows = [];

    // Check if we have headers - this tells us what data structure to expect
    if (!data.headers) {
        console.log('No headers found in Insights data');
        return [];
    }

    console.log('Insights data structure:', {
        hasHeaders: !!data.headers,
        headersCount: data.headers?.length,
        seriesType: Array.isArray(data.series) ? 'array' : typeof data.series,
        seriesIsEmpty: data.series ? (Array.isArray(data.series) ? data.series.length === 0 : Object.keys(data.series).length === 0) : true
    });

    // Handle Query API nested object format - extract user profiles from nested structure
    if (data.headers && data.series && typeof data.series === 'object' && !Array.isArray(data.series)) {
        console.log('Processing Query API nested object format for user profiles');
        console.log(`Headers (${data.headers.length}): ${data.headers.join(', ')}`);
        console.log(`Series metrics (${Object.keys(data.series).length}): ${Object.keys(data.series).slice(0, 5).join(', ')}...`);

        // Structure: series[metricName][userId or prop][prop][prop]...
        // We need to extract:
        // 1. Property values from headers (dimensions like income, netWorth)
        // 2. Metric values from series keys (metrics like "A. Linked Bank Account")

        const userDataMap = new Map(); // distinct_id -> {properties and metrics}
        const propertyHeaders = data.headers.slice(2); // Skip $metric and $distinct_id
        const metricNames = Object.keys(data.series); // All the metric names

        function extractUserDataRecursive(obj, pathValues = [], currentUserId = null, currentMetric = null, depth = 0) {
            if (depth > 30) return; // Prevent infinite recursion

            if (obj && typeof obj === 'object') {
                Object.entries(obj).forEach(([key, value]) => {
                    // Skip $overall but handle 'all' which contains metric values
                    if (key === '$overall') {
                        if (typeof value === 'object') {
                            extractUserDataRecursive(value, pathValues, currentUserId, currentMetric, depth + 1);
                        }
                        return;
                    }

                    // 'all' key contains the actual metric value
                    if (key === 'all' && typeof value === 'number' && currentUserId && currentMetric) {
                        const userData = userDataMap.get(currentUserId);
                        if (userData) {
                            userData[currentMetric] = value;
                            if (depth <= 5) console.log(`      ✓ Set ${currentMetric}=${value} for user (depth=${depth})`);
                        }
                        return;
                    }

                    // Log if we see 'all' key but don't extract
                    if (key === 'all' && depth <= 5) {
                        console.log(`      Found 'all' key but not extracting: valueType=${typeof value}, hasUserId=${!!currentUserId}, hasMetric=${!!currentMetric}, depth=${depth}`);
                    }

                    // Check if key is a user ID
                    const isUserId = key.startsWith('$device:') ||
                        key.match(/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i) ||
                        (key.match(/^[0-9]+$/) && key.length > 10);

                    if (isUserId && !currentUserId) {
                        // Found a user ID! Initialize user data
                        if (!userDataMap.has(key)) {
                            userDataMap.set(key, { '$distinct_id': key });
                        }

                        // Continue recursing with this user ID
                        if (typeof value === 'object') {
                            extractUserDataRecursive(value, pathValues, key, currentMetric, depth + 1);
                        } else if (typeof value === 'number' && currentMetric) {
                            // Direct metric value for this user
                            userDataMap.get(key)[currentMetric] = value;
                        }
                    } else if (currentUserId) {
                        // We're inside a user's data - collect property values
                        const newPath = [...pathValues, key];

                        // Map path values to property headers (dimensions)
                        const userData = userDataMap.get(currentUserId);
                        if (userData) {
                            newPath.forEach((val, idx) => {
                                if (idx < propertyHeaders.length) {
                                    const propName = propertyHeaders[idx];
                                    if (propName && !userData[propName]) {
                                        userData[propName] = val;
                                    }
                                }
                            });

                            // Check if we've reached a metric value (number at leaf)
                            if (typeof value === 'number' && currentMetric) {
                                userData[currentMetric] = value;
                                if (Object.keys(userData).length <= 5) {
                                    console.log(`    Set metric ${currentMetric} = ${value} for user`);
                                }
                            }
                        }

                        // Continue recursing
                        if (typeof value === 'object') {
                            extractUserDataRecursive(value, newPath, currentUserId, currentMetric, depth + 1);
                        }
                    } else {
                        // Not inside a user yet, keep searching
                        if (typeof value === 'object') {
                            extractUserDataRecursive(value, pathValues, currentUserId, currentMetric, depth + 1);
                        }
                    }
                });
            }
        }

        // Iterate through each metric in series
        console.log(`Processing ${metricNames.length} metrics...`);
        let metricsSetCount = 0;
        metricNames.forEach((metricName, idx) => {
            if (idx < 3) console.log(`  Processing metric: ${metricName}`);
            const beforeSize = userDataMap.size;
            extractUserDataRecursive(data.series[metricName], [], null, metricName, 0);
            const afterSize = userDataMap.size;
            if (idx < 3) {
                console.log(`    After processing ${metricName}: ${afterSize} users in map`);
                // Check if metric was set
                let hasMetric = 0;
                userDataMap.forEach(u => { if (u[metricName] !== undefined) hasMetric++; });
                console.log(`    ${hasMetric} users have ${metricName} set`);
                if (hasMetric > 0) metricsSetCount++;
            }
        });
        console.log(`Extracted ${userDataMap.size} user profiles from nested structure`);
        console.log(`First 3 metrics had values for users: ${metricsSetCount}/3`);

        if (userDataMap.size > 0) {
            const sampleUsers = Array.from(userDataMap.values()).slice(0, 3);
            console.log(`Sample user data (first 3):`, JSON.stringify(sampleUsers, null, 2));

            // Check how many properties each user has
            const propertyCounts = sampleUsers.map(u => Object.keys(u).length);
            console.log(`Property counts per user:`, propertyCounts);
            console.log(`Expected headers count:`, data.headers.length);
        }

        // Collect all possible column names (properties + metrics)
        const allColumns = new Set(['$distinct_id']);
        propertyHeaders.forEach(h => allColumns.add(h));
        metricNames.forEach(m => allColumns.add(m));

        console.log(`Total columns to include: ${allColumns.size} (1 ID + ${propertyHeaders.length} properties + ${metricNames.length} metrics)`);

        // Convert to rows, ensuring all columns are present
        userDataMap.forEach((userData) => {
            // Ensure all metric columns exist (even if undefined)
            metricNames.forEach(metricName => {
                if (!(metricName in userData)) {
                    userData[metricName] = undefined;
                }
            });
            rows.push(userData);
        });
    }
    // Handle Query API tabular format with headers and series array
    else if (data.headers && Array.isArray(data.headers) && data.series && Array.isArray(data.series)) {
        console.log('Processing Query API tabular format');
        console.log(`Headers: ${data.headers.join(', ')}`);
        console.log(`Processing ${data.series.length} rows`);

        // Each series item is a row of data corresponding to the headers
        data.series.forEach((rowData, index) => {
            if (Array.isArray(rowData)) {
                const row = {};

                // Map each value to its corresponding header
                data.headers.forEach((header, headerIndex) => {
                    if (headerIndex < rowData.length) {
                        row[header] = rowData[headerIndex];
                    }
                });

                rows.push(row);
            }
        });
    }
    // Handle legacy format: insights data broken down by distinct_id
    else if (data.data && typeof data.data === 'object' && !Array.isArray(data.data)) {
        console.log('Processing distinct_id breakdown format (legacy)');

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
    else if (data.data && data.data.series && Array.isArray(data.data.series)) {
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
    } else if (data.data && Array.isArray(data.data)) {
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

        // Step 2: Process Insights data to extract user profiles
        console.log('\n=== Step 2: Processing user profiles from Insights chart ===');

        const processedProfiles = processInsightsData(subscribersData);
        saveToCSV(processedProfiles, '1_subscribers_insights.csv');
        console.log(`Processed ${processedProfiles.length} user profiles from Insights`);

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

        console.log('\n✅ All data fetched and saved successfully!');
        console.log('Note: The 3 time funnel files will be merged with the subscribers insights file.');

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
