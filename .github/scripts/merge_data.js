#!/usr/bin/env node

/**
 * Merge CSV data files
 * This script merges the 7 individual CSV files into 3 output files
 */

const fs = require('fs');
const path = require('path');

// Helper function to find column value with flexible matching
function getColumnValue(row, ...possibleNames) {
    for (const name of possibleNames) {
        if (row[name] !== undefined && row[name] !== null && row[name] !== '') {
            return row[name];
        }
    }
    return '';
}

// Helper function to clean column names
function cleanColumnName(name) {
    return name
        .replace(/^[A-Z]\.\s*/, '') // Remove "A. ", "B. " etc.
        .replace(/\s*\(\$?\)\s*/, '') // Remove empty parentheses
        .replace(/([a-z])([A-Z])/g, '$1 $2') // Add spaces in camelCase
        .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
        .replace(/\b\w/g, l => l.toUpperCase()) // Title case
        .replace(/\bI D\b/g, 'ID'); // Fix "I D" back to "ID"
}

// Helper function to clean data values
function cleanValue(value) {
    if (value === 'undefined' || value === '$non_numeric_values' || value === null || value === undefined) {
        return '';
    }
    return value;
}

// Parse CSV function
function parseCSV(text) {
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length === 0) return { headers: [], data: [] };

    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const data = lines.slice(1).map(line => {
        const values = line.split(',');
        const row = {};
        headers.forEach((h, i) => row[h] = values[i] ? values[i].trim().replace(/"/g, '') : '');
        return row;
    });
    return { headers, data };
}

// Normalize distinct_id keys
function normalizeId(row) {
    return row['Distinct ID'] || row['$distinct_id'];
}

// Helper function for time conversion
function secondsToDays(seconds) {
    if (!seconds || isNaN(seconds)) return '';
    return Math.round((seconds / 86400) * 100) / 100;
}

// Main processing function
function processComprehensiveData(contents) {
    console.log('Parsing all CSV files...');
    const [
        demoData,
        firstCopyData,
        fundedAccountData,
        linkedBankData,
        premiumSubData,
        creatorCopyData,
        portfolioCopyData
    ] = contents.map(parseCSV);

    console.log('Data loaded:', {
        demo: demoData.data.length,
        firstCopy: firstCopyData.data.length,
        fundedAccount: fundedAccountData.data.length,
        linkedBank: linkedBankData.data.length,
        premiumSub: premiumSubData.data.length,
        creatorCopy: creatorCopyData.data.length,
        portfolioCopy: portfolioCopyData.data.length
    });

    // Create time mappings
    const timeToFirstCopyMap = {};
    const timeToDepositMap = {};
    const timeToLinkedBankMap = {};

    firstCopyData.data.forEach(row => {
        const id = normalizeId(row);
        if (id) timeToFirstCopyMap[id] = row[firstCopyData.headers[2]];
    });

    fundedAccountData.data.forEach(row => {
        const id = normalizeId(row);
        if (id) timeToDepositMap[id] = row[fundedAccountData.headers[2]];
    });

    linkedBankData.data.forEach(row => {
        const id = normalizeId(row);
        if (id) timeToLinkedBankMap[id] = row[linkedBankData.headers[2]];
    });

    // Create aggregated conversion metrics
    const conversionAggregates = {};

    // Process premium subscription data
    premiumSubData.data.forEach(row => {
        const id = normalizeId(row);
        if (!id) return;

        if (!conversionAggregates[id]) {
            conversionAggregates[id] = {
                total_paywall_views: 0,
                total_stripe_views: 0,
                total_subscriptions: 0,
                total_creator_portfolio_views: 0,
                total_creator_copy_starts: 0,
                total_creator_copies: 0,
                unique_creators_interacted: new Set()
            };
        }

        conversionAggregates[id].total_paywall_views += parseInt(row['(1) Viewed Creator Paywall'] || 0);
        conversionAggregates[id].total_stripe_views += parseInt(row['(2) Viewed Stripe Modal'] || 0);
        conversionAggregates[id].total_subscriptions += parseInt(row['(3) Subscribed to Creator'] || 0);
        if (row['creatorUsername']) {
            conversionAggregates[id].unique_creators_interacted.add(row['creatorUsername']);
        }
    });

    // Process creator-level copy data
    creatorCopyData.data.forEach(row => {
        const id = normalizeId(row);
        if (!id) return;

        if (!conversionAggregates[id]) {
            conversionAggregates[id] = {
                total_paywall_views: 0,
                total_stripe_views: 0,
                total_subscriptions: 0,
                total_creator_portfolio_views: 0,
                total_creator_copy_starts: 0,
                total_creator_copies: 0,
                unique_creators_interacted: new Set()
            };
        }

        conversionAggregates[id].total_creator_portfolio_views += parseInt(row['(1) Viewed Portfolio Details'] || 0);
        conversionAggregates[id].total_creator_copy_starts += parseInt(row['(2) Started Copy Portfolio'] || 0);
        conversionAggregates[id].total_creator_copies += parseInt(row['(3) Copied Portfolio'] || 0);
        if (row['creatorUsername']) {
            conversionAggregates[id].unique_creators_interacted.add(row['creatorUsername']);
        }
    });

    // Aggregate portfolio-level data
    const portfolioAggregates = {};
    portfolioCopyData.data.forEach(row => {
        const id = normalizeId(row);
        if (!id) return;

        if (!portfolioAggregates[id]) {
            portfolioAggregates[id] = {
                total_portfolio_copy_starts: 0,
                unique_portfolios_interacted: new Set()
            };
        }

        portfolioAggregates[id].total_portfolio_copy_starts += parseInt(row['(2) Started Copy Portfolio'] || 0);
        if (row['portfolioTicker']) {
            portfolioAggregates[id].unique_portfolios_interacted.add(row['portfolioTicker']);
        }
    });

    // Collect ALL unique user IDs from all 7 files
    const allUserIds = new Set();

    [demoData, firstCopyData, fundedAccountData, linkedBankData,
     premiumSubData, creatorCopyData, portfolioCopyData].forEach(dataset => {
        dataset.data.forEach(row => {
            const id = normalizeId(row);
            if (id) allUserIds.add(id);
        });
    });

    console.log(`Found ${allUserIds.size} unique users across all files`);

    // Create a map of user data from demo/insights file
    const demoDataMap = {};
    demoData.data.forEach(row => {
        const id = normalizeId(row);
        if (id) demoDataMap[id] = row;
    });

    // Create main analysis file with ALL users
    const mainAnalysisData = Array.from(allUserIds).map(id => {
        const row = demoDataMap[id] || {};
        const clean = {};

        // Clean original columns with normalized names
        Object.keys(row).forEach(k => {
            const cleanedName = cleanColumnName(k);
            clean[cleanedName] = cleanValue(row[k]);
        });

        // Always include the Distinct ID
        clean['Distinct ID'] = id;

        // Map key columns with flexible matching
        clean['Linked Bank Account'] = getColumnValue(row, 'A. Linked Bank Account', 'B. Linked Bank Account', 'hasLinkedBank') || clean['Linked Bank Account'] || clean['Has Linked Bank'] || '';
        clean['Total Deposits'] = getColumnValue(row, 'B. Total Deposits ($)', 'C. Total Deposits ($)', 'C. Total Deposits') || clean['Total Deposits'] || '';
        clean['Total Deposit Count'] = getColumnValue(row, 'C. Total Deposit Count', 'D. Total Deposit Count') || clean['Total Deposit Count'] || '';
        clean['Subscribed Within 7 Days'] = getColumnValue(row, 'D. Subscribed within 7 days', 'F. Subscribed within 7 days') || clean['Subscribed Within 7 Days'] || '';
        clean['Total Copies'] = getColumnValue(row, 'E. Total Copies', 'G. Total Copies') || clean['Total Copies'] || '';
        clean['Total Regular Copies'] = getColumnValue(row, 'F. Total Regular Copies', 'H. Total Regular Copies') || clean['Total Regular Copies'] || '';
        clean['Total Premium Copies'] = getColumnValue(row, 'G. Total Premium Copies') || clean['Total Premium Copies'] || '';
        clean['Regular PDP Views'] = getColumnValue(row, 'H. Regular PDP Views', 'I. Regular PDP Views') || clean['Regular PDP Views'] || '';
        clean['Premium PDP Views'] = getColumnValue(row, 'I. Premium PDP Views', 'J. Premium PDP Views') || clean['Premium PDP Views'] || '';
        clean['Paywall Views'] = getColumnValue(row, 'J. Paywall Views', 'K. Paywall Views') || clean['Paywall Views'] || '';
        clean['Regular Creator Profile Views'] = getColumnValue(row, 'K. Regular Creator Profile Views', 'L. Regular Creator Profile Views') || clean['Regular Creator Profile Views'] || '';
        clean['Premium Creator Profile Views'] = getColumnValue(row, 'L. Premium Creator Profile Views', 'M. Premium Creator Profile Views') || clean['Premium Creator Profile Views'] || '';
        clean['Total Subscriptions'] = getColumnValue(row, 'M. Total Subscriptions', 'E. Total Subscriptions') || clean['Total Subscriptions'] || '';
        clean['App Sessions'] = getColumnValue(row, 'N. App Sessions') || clean['App Sessions'] || '';
        clean['Discover Tab Views'] = getColumnValue(row, 'O. Discover Tab Views') || clean['Discover Tab Views'] || '';
        clean['Leaderboard Tab Views'] = getColumnValue(row, 'P. Leaderboard Tab Views', 'P. Leaderboard Views') || clean['Leaderboard Tab Views'] || clean['Leaderboard Views'] || '';
        clean['Premium Tab Views'] = getColumnValue(row, 'Q. Premium Tab Views') || clean['Premium Tab Views'] || '';
        clean['Stripe Modal Views'] = getColumnValue(row, 'R. Stripe Modal Views') || clean['Stripe Modal Views'] || '';
        clean['Creator Card Taps'] = getColumnValue(row, 'S. Creator Card Taps') || clean['Creator Card Taps'] || '';
        clean['Portfolio Card Taps'] = getColumnValue(row, 'T. Portfolio Card Taps') || clean['Portfolio Card Taps'] || '';

        // Add time columns
        clean['Time To First Copy'] = secondsToDays(timeToFirstCopyMap[id]);
        clean['Time To Deposit'] = secondsToDays(timeToDepositMap[id]);
        clean['Time To Linked Bank'] = secondsToDays(timeToLinkedBankMap[id]);

        // Add aggregated conversion metrics
        const conv = conversionAggregates[id] || {};
        const port = portfolioAggregates[id] || {};

        const totalCopyStarts = (conv.total_creator_copy_starts || 0) + (port.total_portfolio_copy_starts || 0);

        clean['Total Stripe Views'] = conv.total_stripe_views || 0;
        clean['Total Copy Starts'] = totalCopyStarts;
        clean['Unique Creators Interacted'] = conv.unique_creators_interacted ? conv.unique_creators_interacted.size : 0;
        clean['Unique Portfolios Interacted'] = port.unique_portfolios_interacted ? port.unique_portfolios_interacted.size : 0;

        return clean;
    });

    return {
        mainFile: mainAnalysisData
    };
}

// Convert data to CSV
function dataToCSV(data) {
    if (data.length === 0) return '';

    const headers = Object.keys(data[0]);
    const rows = [headers.join(',')];

    data.forEach(row => {
        const values = headers.map(h => {
            const value = row[h] || '';
            // Properly escape values that contain commas or quotes
            if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
                return `"${value.replace(/"/g, '""')}"`;
            }
            return value;
        });
        rows.push(values.join(','));
    });

    return rows.join('\n');
}

// Main function
async function main() {
    console.log('Starting data merge...');

    const dataDir = path.join(process.cwd(), 'data');

    // Read all 7 CSV files
    const fileNames = [
        '1_subscribers_insights.csv',
        '2_time_to_first_copy.csv',
        '3_time_to_funded_account.csv',
        '4_time_to_linked_bank.csv',
        '5_premium_subscriptions.csv',
        '6_creator_copy_funnel.csv',
        '7_portfolio_copy_funnel.csv'
    ];

    console.log('Reading CSV files...');
    const contents = fileNames.map(fileName => {
        const filePath = path.join(dataDir, fileName);
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }
        return fs.readFileSync(filePath, 'utf8');
    });

    // Process the data
    console.log('Processing and merging data...');
    const results = processComprehensiveData(contents);

    // Convert to CSV
    console.log('Converting to CSV format...');
    const mainCSV = dataToCSV(results.mainFile);

    // Write output file
    console.log('Writing output file...');
    fs.writeFileSync(path.join(dataDir, 'Main_Analysis_File.csv'), mainCSV);

    console.log('✅ Merge complete!');
    console.log(`  - Main Analysis File: ${results.mainFile.length} rows`);
}

// Run the script
main().catch(error => {
    console.error('Error:', error.message);
    process.exit(1);
});