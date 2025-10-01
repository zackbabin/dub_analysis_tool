#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Parse CSV
function parseCSV(text) {
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length === 0) return { headers: [], data: [] };

    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const data = lines.slice(1).map(line => {
        const values = line.split(',');
        const row = {};
        headers.forEach((h, i) => {
            let val = values[i] ? values[i].trim().replace(/"/g, '') : '';
            // Convert numeric strings
            if (val !== '' && val !== 'undefined' && !isNaN(val)) {
                val = parseFloat(val);
            }
            row[h] = val;
        });
        return row;
    });
    return { headers, data };
}

// Clean numeric value
function cleanNumeric(val) {
    if (val === '' || val === 'undefined' || val === undefined || val === null) return 0;
    const num = parseFloat(val);
    return isNaN(num) ? 0 : num;
}

// Income/NetWorth helpers
function isLowerOrUnknownIncome(income) {
    const lowerIncomes = ['Less than $25,000', '<25k', '$25,000-$49,999', '25k–50k', '$50,000-$74,999', '50k–100k'];
    if (!income || income === 'undefined') return true;
    return String(income).trim() === '' || lowerIncomes.includes(String(income));
}

function isLowerOrUnknownNetWorth(netWorth) {
    const lowerNetWorths = ['Less than $10,000', '<10k', '$10,000-$49,999', '10k–50k', '$50,000-$99,999', '50k–100k'];
    if (!netWorth || netWorth === 'undefined') return true;
    return String(netWorth).trim() === '' || lowerNetWorths.includes(String(netWorth));
}

function isHigherOrUnknownIncome(income) {
    const lowerIncomes = ['Less than $25,000', '<25k', '$25,000-$49,999', '25k–50k', '$50000-$74,999', '50k–100k'];
    if (!income || income === 'undefined') return true;
    return String(income).trim() === '' || !lowerIncomes.includes(String(income));
}

// Classify persona
function classifyPersona(user) {
    const totalPDPViews = cleanNumeric(user['H. Regular PDP Views']) + cleanNumeric(user['I. Premium PDP Views']);
    const totalCreatorViews = cleanNumeric(user['K. Regular Creator Profile Views']) + cleanNumeric(user['L. Premium Creator Profile Views']);
    const hasCopied = cleanNumeric(user['E. Total Copies']) >= 1;
    const totalCopies = cleanNumeric(user['E. Total Copies']);
    const totalDeposits = cleanNumeric(user['B. Total Deposits ($)']);
    const totalSubscriptions = cleanNumeric(user['M. Total Subscriptions']);
    const subscribedWithin7Days = cleanNumeric(user['D. Subscribed within 7 days']);
    const hasLinkedBank = (user['A. Linked Bank Account'] === 1 || user['A. Linked Bank Account'] === '1') ? 1 : 0;
    const income = user['income'];
    const netWorth = user['netWorth'];

    // 1. Premium
    if (totalSubscriptions >= 1 || subscribedWithin7Days === 1) {
        return 'premium';
    }

    // 2. Core: All non-premium users with deposits > 0
    if (totalSubscriptions === 0 && totalDeposits > 0) {
        return 'core';
    }

    // 3. Activation Targets (UPDATED: Remove income requirement)
    if (totalDeposits === 0 &&
        totalCopies === 0 &&
        (totalPDPViews >= 2 || totalCreatorViews >= 2)) {
        return 'activationTargets';
    }

    // 4. Non-Activated
    if (hasLinkedBank === 0 &&
        totalDeposits === 0 &&
        totalPDPViews === 0 &&
        totalCreatorViews === 0) {
        return 'nonActivated';
    }

    return 'unclassified';
}

// Main analysis
async function main() {
    const dataFile = path.join(__dirname, 'data', 'Main_Analysis_File.csv');
    const csvText = fs.readFileSync(dataFile, 'utf8');
    const { data } = parseCSV(csvText);

    console.log(`\n📊 Total Users: ${data.length}\n`);

    // Classify all users
    const classifications = {
        premium: [],
        core: [],
        activationTargets: [],
        nonActivated: [],
        unclassified: []
    };

    data.forEach(user => {
        const persona = classifyPersona(user);
        classifications[persona].push(user);
    });

    // Print persona breakdown
    console.log('🎯 Persona Breakdown:');
    Object.entries(classifications).forEach(([persona, users]) => {
        const percentage = ((users.length / data.length) * 100).toFixed(1);
        console.log(`  ${persona}: ${users.length} (${percentage}%)`);
    });

    // Analyze unclassified users
    const unclassified = classifications.unclassified;
    console.log(`\n\n🔍 Analyzing ${unclassified.length} Unclassified Users:\n`);

    // Key attributes
    const attributes = {
        hasLinkedBank: { yes: 0, no: 0 },
        hasDeposits: { yes: 0, no: 0, range: [] },
        hasCopies: { yes: 0, no: 0 },
        hasPDPViews: { yes: 0, no: 0 },
        hasCreatorViews: { yes: 0, no: 0 },
        hasSubscriptions: { yes: 0, no: 0 },
        income: {},
        netWorth: {}
    };

    unclassified.forEach(user => {
        const hasLinkedBank = (user['A. Linked Bank Account'] === 1 || user['A. Linked Bank Account'] === '1') ? 1 : 0;
        const totalDeposits = cleanNumeric(user['B. Total Deposits ($)']);
        const totalCopies = cleanNumeric(user['E. Total Copies']);
        const totalPDPViews = cleanNumeric(user['H. Regular PDP Views']) + cleanNumeric(user['I. Premium PDP Views']);
        const totalCreatorViews = cleanNumeric(user['K. Regular Creator Profile Views']) + cleanNumeric(user['L. Premium Creator Profile Views']);
        const totalSubscriptions = cleanNumeric(user['M. Total Subscriptions']);
        const income = user['income'];
        const netWorth = user['netWorth'];

        // Linked bank
        if (hasLinkedBank === 1) attributes.hasLinkedBank.yes++;
        else attributes.hasLinkedBank.no++;

        // Deposits
        if (totalDeposits > 0) {
            attributes.hasDeposits.yes++;
            attributes.hasDeposits.range.push(totalDeposits);
        } else {
            attributes.hasDeposits.no++;
        }

        // Copies
        if (totalCopies > 0) attributes.hasCopies.yes++;
        else attributes.hasCopies.no++;

        // PDP Views
        if (totalPDPViews > 0) attributes.hasPDPViews.yes++;
        else attributes.hasPDPViews.no++;

        // Creator Views
        if (totalCreatorViews > 0) attributes.hasCreatorViews.yes++;
        else attributes.hasCreatorViews.no++;

        // Subscriptions
        if (totalSubscriptions > 0) attributes.hasSubscriptions.yes++;
        else attributes.hasSubscriptions.no++;

        // Income
        const incomeStr = income === 'undefined' || !income ? 'Unknown' : income;
        attributes.income[incomeStr] = (attributes.income[incomeStr] || 0) + 1;

        // Net Worth
        const netWorthStr = netWorth === 'undefined' || !netWorth ? 'Unknown' : netWorth;
        attributes.netWorth[netWorthStr] = (attributes.netWorth[netWorthStr] || 0) + 1;
    });

    // Print key attributes
    console.log('📋 Key Attributes:\n');

    console.log('Linked Bank Account:');
    console.log(`  Yes: ${attributes.hasLinkedBank.yes} (${((attributes.hasLinkedBank.yes / unclassified.length) * 100).toFixed(1)}%)`);
    console.log(`  No: ${attributes.hasLinkedBank.no} (${((attributes.hasLinkedBank.no / unclassified.length) * 100).toFixed(1)}%)\n`);

    console.log('Has Deposits:');
    console.log(`  Yes: ${attributes.hasDeposits.yes} (${((attributes.hasDeposits.yes / unclassified.length) * 100).toFixed(1)}%)`);
    console.log(`  No: ${attributes.hasDeposits.no} (${((attributes.hasDeposits.no / unclassified.length) * 100).toFixed(1)}%)`);
    if (attributes.hasDeposits.yes > 0) {
        const deposits = attributes.hasDeposits.range.sort((a, b) => a - b);
        console.log(`  Range: $${Math.min(...deposits)} - $${Math.max(...deposits)}`);
        console.log(`  Median: $${deposits[Math.floor(deposits.length / 2)]}\n`);
    }

    console.log('Has Copies:');
    console.log(`  Yes: ${attributes.hasCopies.yes} (${((attributes.hasCopies.yes / unclassified.length) * 100).toFixed(1)}%)`);
    console.log(`  No: ${attributes.hasCopies.no} (${((attributes.hasCopies.no / unclassified.length) * 100).toFixed(1)}%)\n`);

    console.log('Has PDP Views:');
    console.log(`  Yes: ${attributes.hasPDPViews.yes} (${((attributes.hasPDPViews.yes / unclassified.length) * 100).toFixed(1)}%)`);
    console.log(`  No: ${attributes.hasPDPViews.no} (${((attributes.hasPDPViews.no / unclassified.length) * 100).toFixed(1)}%)\n`);

    console.log('Has Creator Views:');
    console.log(`  Yes: ${attributes.hasCreatorViews.yes} (${((attributes.hasCreatorViews.yes / unclassified.length) * 100).toFixed(1)}%)`);
    console.log(`  No: ${attributes.hasCreatorViews.no} (${((attributes.hasCreatorViews.no / unclassified.length) * 100).toFixed(1)}%)\n`);

    console.log('Income Distribution:');
    Object.entries(attributes.income)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .forEach(([inc, count]) => {
            console.log(`  ${inc}: ${count} (${((count / unclassified.length) * 100).toFixed(1)}%)`);
        });

    console.log('\n\n🔑 Common Patterns in Unclassified Users:\n');

    // Pattern 1: Has engagement but deposits outside Core range
    const pattern1 = unclassified.filter(u => {
        const totalDeposits = cleanNumeric(u['B. Total Deposits ($)']);
        const totalCopies = cleanNumeric(u['E. Total Copies']);
        const totalPDPViews = cleanNumeric(u['H. Regular PDP Views']) + cleanNumeric(u['I. Premium PDP Views']);
        return (totalCopies > 0 || totalPDPViews >= 2) && (totalDeposits < 200 || totalDeposits > 1000);
    });
    console.log(`1. Has engagement (copies or 2+ PDP views) but deposits outside $200-$1000 range: ${pattern1.length} (${((pattern1.length / unclassified.length) * 100).toFixed(1)}%)`);

    // Pattern 2: Has deposits in Core range but no engagement
    const pattern2 = unclassified.filter(u => {
        const totalDeposits = cleanNumeric(u['B. Total Deposits ($)']);
        const totalCopies = cleanNumeric(u['E. Total Copies']);
        const totalPDPViews = cleanNumeric(u['H. Regular PDP Views']) + cleanNumeric(u['I. Premium PDP Views']);
        return totalDeposits >= 200 && totalDeposits <= 1000 && totalCopies === 0 && totalPDPViews < 2;
    });
    console.log(`2. Has deposits in Core range ($200-$1000) but no engagement: ${pattern2.length} (${((pattern2.length / unclassified.length) * 100).toFixed(1)}%)`);

    // Pattern 3: Has some views but not enough for any category
    const pattern3 = unclassified.filter(u => {
        const totalPDPViews = cleanNumeric(u['H. Regular PDP Views']) + cleanNumeric(u['I. Premium PDP Views']);
        const totalCreatorViews = cleanNumeric(u['K. Regular Creator Profile Views']) + cleanNumeric(u['L. Premium Creator Profile Views']);
        return totalPDPViews === 1 && totalCreatorViews === 0;
    });
    console.log(`3. Has exactly 1 PDP view (not enough for Core, no creator views): ${pattern3.length} (${((pattern3.length / unclassified.length) * 100).toFixed(1)}%)`);

    // Pattern 4: Has linked bank and low deposits but some engagement
    const pattern4 = unclassified.filter(u => {
        const hasLinkedBank = (u['A. Linked Bank Account'] === 1 || u['A. Linked Bank Account'] === '1') ? 1 : 0;
        const totalDeposits = cleanNumeric(u['B. Total Deposits ($)']);
        const totalCopies = cleanNumeric(u['E. Total Copies']);
        const totalPDPViews = cleanNumeric(u['H. Regular PDP Views']) + cleanNumeric(u['I. Premium PDP Views']);
        return hasLinkedBank === 1 && totalDeposits > 0 && totalDeposits <= 200 && (totalCopies > 0 || totalPDPViews >= 1);
    });
    console.log(`4. Has linked bank + low deposits (≤$200) but shows engagement: ${pattern4.length} (${((pattern4.length / unclassified.length) * 100).toFixed(1)}%)`);

    // Pattern 5: Edge cases with high deposits but no copies
    const pattern5 = unclassified.filter(u => {
        const totalDeposits = cleanNumeric(u['B. Total Deposits ($)']);
        const totalCopies = cleanNumeric(u['E. Total Copies']);
        const hasLinkedBank = (u['A. Linked Bank Account'] === 1 || u['A. Linked Bank Account'] === '1') ? 1 : 0;
        return totalDeposits > 1000 && totalCopies === 0 && hasLinkedBank === 1;
    });
    console.log(`5. High deposits (>$1000) but no copies: ${pattern5.length} (${((pattern5.length / unclassified.length) * 100).toFixed(1)}%)`);

    // Additional analysis: Users with 2+ PDP views, no deposits
    console.log('\n📌 Special Analysis: Users with 2+ PDP Views, No Deposits:\n');

    const pdpViewers = unclassified.filter(u => {
        const totalPDPViews = cleanNumeric(u['H. Regular PDP Views']) + cleanNumeric(u['I. Premium PDP Views']);
        const totalDeposits = cleanNumeric(u['B. Total Deposits ($)']);
        const totalCopies = cleanNumeric(u['E. Total Copies']);
        return totalPDPViews >= 2 && totalDeposits === 0 && totalCopies === 0;
    });

    console.log(`Total: ${pdpViewers.length} users\n`);

    // Check against Activation Targets criteria
    const hasLinkedBankNo = pdpViewers.filter(u => {
        const hasLinkedBank = (u['A. Linked Bank Account'] === 1 || u['A. Linked Bank Account'] === '1') ? 1 : 0;
        return hasLinkedBank === 0;
    }).length;

    const hasCreatorViews = pdpViewers.filter(u => {
        const totalCreatorViews = cleanNumeric(u['K. Regular Creator Profile Views']) + cleanNumeric(u['L. Premium Creator Profile Views']);
        return totalCreatorViews > 0;
    }).length;

    const higherIncome = pdpViewers.filter(u => {
        return isHigherOrUnknownIncome(u['income']);
    }).length;

    console.log('Activation Targets Criteria Check:');
    console.log(`  ✓ No linked bank: ${hasLinkedBankNo} of ${pdpViewers.length} (${((hasLinkedBankNo / pdpViewers.length) * 100).toFixed(1)}%)`);
    console.log(`  ✓ No deposits: ${pdpViewers.length} of ${pdpViewers.length} (100.0%)`);
    console.log(`  ✓ No copies: ${pdpViewers.length} of ${pdpViewers.length} (100.0%)`);
    console.log(`  ? Has creator views (current requirement): ${hasCreatorViews} of ${pdpViewers.length} (${((hasCreatorViews / pdpViewers.length) * 100).toFixed(1)}%)`);
    console.log(`  ✓ Higher/unknown income: ${higherIncome} of ${pdpViewers.length} (${((higherIncome / pdpViewers.length) * 100).toFixed(1)}%)`);

    // What if we remove creator views requirement and add PDP views requirement?
    const wouldQualify = pdpViewers.filter(u => {
        const hasLinkedBank = (u['A. Linked Bank Account'] === 1 || u['A. Linked Bank Account'] === '1') ? 1 : 0;
        const totalDeposits = cleanNumeric(u['B. Total Deposits ($)']);
        const totalCopies = cleanNumeric(u['E. Total Copies']);
        const totalPDPViews = cleanNumeric(u['H. Regular PDP Views']) + cleanNumeric(u['I. Premium PDP Views']);
        return isHigherOrUnknownIncome(u['income']) &&
               hasLinkedBank === 0 &&
               totalDeposits === 0 &&
               totalCopies === 0 &&
               totalPDPViews >= 2;
    }).length;

    console.log(`\n💡 If we change Activation Targets to require 2+ PDP views instead of creator views:`);
    console.log(`   Would add: ${wouldQualify} users to Activation Targets`);

    // Check how many current Activation Targets would be lost
    const currentActivation = classifications.activationTargets;
    const wouldLoseByRemovingCreatorReq = currentActivation.filter(u => {
        const totalCreatorViews = cleanNumeric(u['K. Regular Creator Profile Views']) + cleanNumeric(u['L. Premium Creator Profile Views']);
        const totalPDPViews = cleanNumeric(u['H. Regular PDP Views']) + cleanNumeric(u['I. Premium PDP Views']);
        return totalCreatorViews > 0 && totalPDPViews < 2;
    }).length;

    console.log(`   Would lose: ${wouldLoseByRemovingCreatorReq} current Activation Targets (who have creator views but <2 PDP views)`);
    console.log(`   Net change: +${wouldQualify - wouldLoseByRemovingCreatorReq} users in Activation Targets`);

    // Analyze Pattern 1 users (engagement but deposits outside $200-$1000)
    console.log('\n\n📊 DEEP DIVE: Pattern 1 Users (Engagement + Deposits Outside Core Range)\n');
    const pattern1Users = unclassified.filter(user => {
        const totalDeposits = cleanNumeric(user['B. Total Deposits ($)']);
        const totalCopies = cleanNumeric(user['E. Total Copies']);
        const totalPDPViews = cleanNumeric(user['H. Regular PDP Views']) + cleanNumeric(user['I. Premium PDP Views']);
        const totalCreatorViews = cleanNumeric(user['K. Regular Creator Profile Views']) + cleanNumeric(user['L. Premium Creator Profile Views']);
        const totalSubscriptions = cleanNumeric(user['M. Total Subscriptions']);

        const hasEngagement = totalCopies >= 1 || totalPDPViews >= 1 || totalCreatorViews >= 1;
        const outsideDepositRange = totalDeposits > 0 && (totalDeposits < 200 || totalDeposits > 1000);

        return totalSubscriptions === 0 && hasEngagement && outsideDepositRange;
    });

    // Break down by deposit ranges
    const lowDeposits = pattern1Users.filter(u => cleanNumeric(u['B. Total Deposits ($)']) < 200);
    const highDeposits = pattern1Users.filter(u => cleanNumeric(u['B. Total Deposits ($)']) > 1000);

    console.log(`Total Pattern 1 Users: ${pattern1Users.length}`);
    console.log(`  • Low deposits (<$200): ${lowDeposits.length} (${(lowDeposits.length/pattern1Users.length*100).toFixed(1)}%)`);
    console.log(`  • High deposits (>$1000): ${highDeposits.length} (${(highDeposits.length/pattern1Users.length*100).toFixed(1)}%)`);

    // Analyze low deposit users
    if (lowDeposits.length > 0) {
        const lowDepositAmounts = lowDeposits.map(u => cleanNumeric(u['B. Total Deposits ($)'])).sort((a,b) => a-b);
        const lowDepositMedian = lowDepositAmounts[Math.floor(lowDepositAmounts.length/2)];
        console.log(`\n  Low Deposit Details:`);
        console.log(`    Range: $${lowDepositAmounts[0].toFixed(2)} - $${lowDepositAmounts[lowDepositAmounts.length-1].toFixed(2)}`);
        console.log(`    Median: $${lowDepositMedian.toFixed(2)}`);

        // Check engagement levels
        const lowWithCopies = lowDeposits.filter(u => cleanNumeric(u['E. Total Copies']) >= 1).length;
        const lowWithPDP = lowDeposits.filter(u => (cleanNumeric(u['H. Regular PDP Views']) + cleanNumeric(u['I. Premium PDP Views'])) >= 1).length;
        const lowWithCreator = lowDeposits.filter(u => (cleanNumeric(u['K. Regular Creator Profile Views']) + cleanNumeric(u['L. Premium Creator Profile Views'])) >= 1).length;
        console.log(`    Has Copies: ${lowWithCopies} (${(lowWithCopies/lowDeposits.length*100).toFixed(1)}%)`);
        console.log(`    Has PDP Views: ${lowWithPDP} (${(lowWithPDP/lowDeposits.length*100).toFixed(1)}%)`);
        console.log(`    Has Creator Views: ${lowWithCreator} (${(lowWithCreator/lowDeposits.length*100).toFixed(1)}%)`);
    }

    // Analyze high deposit users
    if (highDeposits.length > 0) {
        const highDepositAmounts = highDeposits.map(u => cleanNumeric(u['B. Total Deposits ($)'])).sort((a,b) => a-b);
        const highDepositMedian = highDepositAmounts[Math.floor(highDepositAmounts.length/2)];
        console.log(`\n  High Deposit Details:`);
        console.log(`    Range: $${highDepositAmounts[0].toFixed(2)} - $${highDepositAmounts[highDepositAmounts.length-1].toFixed(2)}`);
        console.log(`    Median: $${highDepositMedian.toFixed(2)}`);

        // Check engagement levels
        const highWithCopies = highDeposits.filter(u => cleanNumeric(u['E. Total Copies']) >= 1).length;
        const highWithPDP = highDeposits.filter(u => (cleanNumeric(u['H. Regular PDP Views']) + cleanNumeric(u['I. Premium PDP Views'])) >= 1).length;
        const highWithCreator = highDeposits.filter(u => (cleanNumeric(u['K. Regular Creator Profile Views']) + cleanNumeric(u['L. Premium Creator Profile Views'])) >= 1).length;
        console.log(`    Has Copies: ${highWithCopies} (${(highWithCopies/highDeposits.length*100).toFixed(1)}%)`);
        console.log(`    Has PDP Views: ${highWithPDP} (${(highWithPDP/highDeposits.length*100).toFixed(1)}%)`);
        console.log(`    Has Creator Views: ${highWithCreator} (${(highWithCreator/highDeposits.length*100).toFixed(1)}%)`);
    }

    console.log('\n💡 Options to Expand Core Segment:');
    console.log(`   Option A: Lower floor to $100-$1000 → would add ~${lowDeposits.length} users`);
    console.log(`   Option B: Raise ceiling to $200-$5000 → would add ~${highDeposits.filter(u => cleanNumeric(u['B. Total Deposits ($)']) <= 5000).length} users`);
    console.log(`   Option C: Remove deposit limits entirely, keep engagement requirement`);

    console.log('\n');
}

main().catch(console.error);
