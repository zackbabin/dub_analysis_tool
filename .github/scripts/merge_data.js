#!/usr/bin/env node

/**
 * Merge CSV data files
 * Merges subscriber insights with 3 time funnel files into Main_Analysis_File.csv
 */

const fs = require('fs');
const path = require('path');

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

// Convert data to CSV
function dataToCSV(data) {
    if (data.length === 0) return '';

    const headers = Object.keys(data[0]);
    const rows = [headers.join(',')];

    data.forEach(row => {
        const values = headers.map(h => {
            const val = row[h] ?? '';
            // Escape values containing commas or quotes
            if (String(val).includes(',') || String(val).includes('"')) {
                return `"${String(val).replace(/"/g, '""')}"`;
            }
            return val;
        });
        rows.push(values.join(','));
    });

    return rows.join('\n');
}

// Main function
async function main() {
    const dataDir = path.join(__dirname, '../../data');

    console.log('Reading CSV files...');

    // Read the 4 required files
    const insightsFile = path.join(dataDir, '1_subscribers_insights.csv');
    const timeToFirstCopyFile = path.join(dataDir, '2_time_to_first_copy.csv');
    const timeToFundedFile = path.join(dataDir, '3_time_to_funded_account.csv');
    const timeToLinkedBankFile = path.join(dataDir, '4_time_to_linked_bank.csv');

    if (!fs.existsSync(insightsFile)) {
        console.error('Error: Insights file not found');
        process.exit(1);
    }

    const insights = parseCSV(fs.readFileSync(insightsFile, 'utf8'));
    const timeToFirstCopy = parseCSV(fs.readFileSync(timeToFirstCopyFile, 'utf8'));
    const timeToFunded = parseCSV(fs.readFileSync(timeToFundedFile, 'utf8'));
    const timeToLinkedBank = parseCSV(fs.readFileSync(timeToLinkedBankFile, 'utf8'));

    console.log(`Loaded:
  - Insights: ${insights.data.length} users
  - Time to First Copy: ${timeToFirstCopy.data.length} users
  - Time to Funded Account: ${timeToFunded.data.length} users
  - Time to Linked Bank: ${timeToLinkedBank.data.length} users`);

    // Create time maps
    const timeToFirstCopyMap = {};
    const timeToFundedMap = {};
    const timeToLinkedBankMap = {};

    timeToFirstCopy.data.forEach(row => {
        const id = normalizeId(row);
        if (id) timeToFirstCopyMap[id] = row['Time to First Copy'];
    });

    timeToFunded.data.forEach(row => {
        const id = normalizeId(row);
        if (id) timeToFundedMap[id] = row['Time to Funded Account'];
    });

    timeToLinkedBank.data.forEach(row => {
        const id = normalizeId(row);
        if (id) timeToLinkedBankMap[id] = row['Time to Linked Bank'];
    });

    // Merge insights with time data
    const mainAnalysisData = insights.data.map(row => {
        const id = normalizeId(row);

        return {
            ...row,
            'Time To First Copy (Days)': timeToFirstCopyMap[id] || '',
            'Time To Funded Account (Days)': timeToFundedMap[id] || '',
            'Time To Linked Bank (Days)': timeToLinkedBankMap[id] || ''
        };
    }).filter(row => row !== null);

    console.log(`\nMerged ${mainAnalysisData.length} users into Main Analysis File`);

    // Write main analysis file
    const mainCSV = dataToCSV(mainAnalysisData);
    fs.writeFileSync(path.join(dataDir, 'Main_Analysis_File.csv'), mainCSV);

    console.log('✅ Merge complete!');
    console.log(`   Main_Analysis_File.csv: ${mainAnalysisData.length} rows`);
}

main().catch(error => {
    console.error('Error:', error);
    process.exit(1);
});