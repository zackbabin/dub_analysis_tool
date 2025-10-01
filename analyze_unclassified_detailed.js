const fs = require('fs');

function parseCSV(text) {
    const lines = text.split('\n').filter(l => l.trim());
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const data = lines.slice(1).map(line => {
        const values = line.split(',');
        const row = {};
        headers.forEach((h, i) => row[h] = values[i] ? values[i].trim().replace(/"/g, '') : '');
        return row;
    });
    return { headers, data };
}

function cleanNumeric(value) {
    if (value === null || value === undefined || value === '' || isNaN(value)) return 0;
    return parseFloat(value) || 0;
}

function isHigherOrUnknownIncome(income) {
    const lowerIncomes = ['Less than $25,000', '<25k', '$25,000-$49,999', '25k–50k', '$50000-$74,999', '50k–100k'];
    if (!income) return true;
    const incomeStr = String(income);
    return incomeStr.trim() === '' || !lowerIncomes.includes(incomeStr);
}

const csvText = fs.readFileSync('data/Main_Analysis_File.csv', 'utf8');
const { data } = parseCSV(csvText);

// Find unclassified
const unclassified = data.filter(u => {
    const totalSubs = cleanNumeric(u['M. Total Subscriptions']);
    const totalDeposits = cleanNumeric(u['B. Total Deposits ($)']);
    const totalPDPViews = cleanNumeric(u['H. Regular PDP Views']) + cleanNumeric(u['I. Premium PDP Views']);
    const totalCreatorViews = cleanNumeric(u['K. Regular Creator Profile Views']) + cleanNumeric(u['L. Premium Creator Profile Views']);
    const totalCopies = cleanNumeric(u['E. Total Copies']);
    const hasLinkedBank = (u['A. Linked Bank Account'] === '1' || u['A. Linked Bank Account'] === 1) ? 1 : 0;
    const income = u['income'];

    // Premium
    if (totalSubs >= 1) return false;

    // Core
    if (totalSubs === 0 && totalDeposits > 0) return false;

    // Activation Targets
    if (isHigherOrUnknownIncome(income) && totalDeposits === 0 && totalCopies === 0 && (totalPDPViews >= 2 || totalCreatorViews >= 2)) return false;

    // Non-Activated
    if (hasLinkedBank === 0 && totalDeposits === 0 && totalPDPViews === 0 && totalCreatorViews === 0) return false;

    return true;
});

console.log('📊 Unclassified Users Analysis\n');
console.log('Total unclassified:', unclassified.length, '(' + (unclassified.length/data.length*100).toFixed(1) + '%)\n');

// Pattern 1: Lower income, high engagement (2+ views)
const pattern1 = unclassified.filter(u => {
    const totalPDPViews = cleanNumeric(u['H. Regular PDP Views']) + cleanNumeric(u['I. Premium PDP Views']);
    const totalCreatorViews = cleanNumeric(u['K. Regular Creator Profile Views']) + cleanNumeric(u['L. Premium Creator Profile Views']);
    const income = u['income'];
    const totalDeposits = cleanNumeric(u['B. Total Deposits ($)']);
    const totalCopies = cleanNumeric(u['E. Total Copies']);
    return !isHigherOrUnknownIncome(income) && totalDeposits === 0 && totalCopies === 0 && (totalPDPViews >= 2 || totalCreatorViews >= 2);
});

// Pattern 2: Has copies (excluded from Activation Targets)
const pattern2 = unclassified.filter(u => {
    const totalCopies = cleanNumeric(u['E. Total Copies']);
    const totalDeposits = cleanNumeric(u['B. Total Deposits ($)']);
    return totalCopies > 0 && totalDeposits === 0;
});

// Pattern 3: 1 view only (not enough for Activation Targets)
const pattern3 = unclassified.filter(u => {
    const totalPDPViews = cleanNumeric(u['H. Regular PDP Views']) + cleanNumeric(u['I. Premium PDP Views']);
    const totalCreatorViews = cleanNumeric(u['K. Regular Creator Profile Views']) + cleanNumeric(u['L. Premium Creator Profile Views']);
    const totalViews = totalPDPViews + totalCreatorViews;
    const totalCopies = cleanNumeric(u['E. Total Copies']);
    const totalDeposits = cleanNumeric(u['B. Total Deposits ($)']);
    return totalViews === 1 && totalCopies === 0 && totalDeposits === 0;
});

// Pattern 4: Has linked bank + some engagement (excluded from Non-Activated)
const pattern4 = unclassified.filter(u => {
    const hasLinkedBank = (u['A. Linked Bank Account'] === '1' || u['A. Linked Bank Account'] === 1) ? 1 : 0;
    const totalPDPViews = cleanNumeric(u['H. Regular PDP Views']) + cleanNumeric(u['I. Premium PDP Views']);
    const totalCreatorViews = cleanNumeric(u['K. Regular Creator Profile Views']) + cleanNumeric(u['L. Premium Creator Profile Views']);
    const totalDeposits = cleanNumeric(u['B. Total Deposits ($)']);
    const totalCopies = cleanNumeric(u['E. Total Copies']);
    return hasLinkedBank === 1 && totalDeposits === 0 && (totalPDPViews >= 1 || totalCreatorViews >= 1 || totalCopies >= 1);
});

console.log('🔑 Breakdown by Exclusion Reason:\n');
console.log('1. Lower income + high engagement (2+ views):', pattern1.length, '(' + (pattern1.length/unclassified.length*100).toFixed(1) + '%)');
console.log('   → Excluded from Activation Targets due to lower income');
console.log('');
console.log('2. Has copies (no deposits):', pattern2.length, '(' + (pattern2.length/unclassified.length*100).toFixed(1) + '%)');
console.log('   → Excluded from Activation Targets (has copies requirement)');
console.log('');
console.log('3. Only 1 view total (no copies, no deposits):', pattern3.length, '(' + (pattern3.length/unclassified.length*100).toFixed(1) + '%)');
console.log('   → Not enough engagement for Activation Targets (needs 2+ views)');
console.log('');
console.log('4. Has linked bank + some engagement (no deposits):', pattern4.length, '(' + (pattern4.length/unclassified.length*100).toFixed(1) + '%)');
console.log('   → Too much engagement for Non-Activated but not enough for Activation Targets');
console.log('');

// Check overlap
const allPatterns = new Set([...pattern1, ...pattern2, ...pattern3, ...pattern4]);
console.log('Total covered by patterns:', allPatterns.size, '(' + (allPatterns.size/unclassified.length*100).toFixed(1) + '%)');
console.log('Remaining uncategorized:', unclassified.length - allPatterns.size);
