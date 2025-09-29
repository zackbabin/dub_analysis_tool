// Enhanced Quantitative Driver Analysis - FIXED Persona Logic
'use strict';

// --- STORAGE KEYS FOR PERSISTENCE ---
const STORAGE_KEYS = {
    SUMMARY: 'qdaSummaryStats',
    CORRELATION: 'qdaCorrelationResults',
    REGRESSION: 'qdaRegressionResults',
    CLEAN_DATA: 'qdaCleanData'
};

// --- 1. CANONICAL VARIABLE LIST (STANDARDISATION) ---
const ALL_VARIABLES = [
    'hasLinkedBank', 'totalCopyStarts', 'totalStripeViews', 'paywallViews',
    'regularPDPViews', 'premiumPDPViews', 'uniqueCreatorsInteracted',
    'uniquePortfoliosInteracted', 'timeToFirstCopy', 'timeToDeposit', 'timeToLinkedBank',
    'incomeEnum', 'netWorthEnum', 'availableCopyCredits', 'buyingPower',
    'activeCreatedPortfolios', 'lifetimeCreatedPortfolios', 'totalBuys', 'totalSells',
    'totalTrades', 'totalWithdrawalCount', 'totalWithdrawals', 'totalOfUserProfiles',
    'totalDepositCount', 'subscribedWithin7Days', 'totalRegularCopies',
    'regularCreatorProfileViews', 'premiumCreatorProfileViews', 'appSessions',
    'discoverTabViews', 'leaderboardViews', 'premiumTabViews', 'creatorCardTaps', 'portfolioCardTaps'
];

// Section-specific exclusions for display only
const SECTION_EXCLUSIONS = {
    'totalDeposits': ['totalDepositCount'],
    'totalCopies': ['totalBuys', 'totalTrades', 'totalRegularCopies']
};

// Inject styles
const styles = `
    /* UI FIX: Remove max-width here to let it shrink to fit the upload section, then reapply for wide results */
    .qda-inline-widget {
        background: white; border: 2px solid #007bff; border-radius: 10px;
        font-family: Arial, sans-serif; font-size: 14px; 
        max-width: 1200px; /* Keep for max size on results */
        margin: 0 auto; 
        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    }
    .qda-header {
        background: #007bff; color: white; padding: 15px;
        border-radius: 8px 8px 0 0; text-align: center;
    }
    .qda-content { padding: 20px; background: white; }
    
    /* UI FIX: Constrain the upload section size and center it */
    .qda-upload-section {
        border: 2px dashed #007bff; border-radius: 8px; padding: 20px;
        /* Center the box */
        margin: 0 auto 40px auto; 
        background: #f8f9fa;
        display: flex; 
        justify-content: center; 
        /* Set a fixed maximum width for the upload box */
        max-width: 450px; 
    }
    /* UI FIX: Vertical stacking for consistency */
    .qda-upload-column {
        display: flex; 
        flex-direction: column; /* Stack children vertically */
        align-items: center;
        text-align: center; 
        padding: 0; 
        background: transparent; 
        border: none; 
        width: 100%; 
    }
    .qda-file-label {
        font-weight: bold; color: #333; margin-bottom: 10px; font-size: 14px;
    }
    .qda-file-input {
        padding: 8px; border: 1px solid #ddd; border-radius: 4px;
        width: 100%; margin-bottom: 8px;
    }
    /* UI FIX: Analysis Output Constraint (Approximation of 2x upload box width + gap) */
    /* NOTE: This container is in the output div, separate from the widget */
    #analysisResultsOutputContainer .qda-analysis-results {
        max-width: 920px; /* 2 * 450px (max-width of upload section) + 20px gap */
        margin: 0 auto;
        padding: 20px;
        background: white;
        border: 2px solid #007bff; 
        border-radius: 10px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    }

    /* Primary buttons for Data Merger, consistent styling for merged files */
    .qda-btn-merge {
        /* This class is now used in data_merger.js */
        transition: all 0.3s;
        font-weight: bold;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 16px;
    }

    /* REMOVED: .qda-file-description CSS */
    .qda-btn {
        background: #007bff; color: white; padding: 8px 20px;
        border: none; border-radius: 5px; cursor: pointer;
        font-size: 14px; white-space: nowrap;
    }
    .qda-btn:hover { background: #0056b3; }
    .qda-btn:disabled { background: #ccc; cursor: not-allowed; }
    .qda-analyze-row {
        margin-top: 20px; text-align: center; width: 100%;
    }
    .qda-analysis-results { display: none; background: white; }
    .qda-result-section { margin: 30px 0; position: relative; }
    .qda-result-section h1 {
        margin: 0 0 20px 0; padding: 10px 0 10px 15px;
        border-left: 4px solid #007bff; font-size: 28px; font-weight: bold;
    }
    .qda-result-section h4 {
        font-size: 18px; font-weight: bold; margin: 20px 0 15px 0; color: #333;
    }
    .qda-export-btn {
        position: absolute; top: 0; right: 0; background: #007bff;
        color: white; border: none; padding: 8px 12px;
        border-radius: 4px; cursor: pointer; font-size: 12px;
    }
    .qda-export-btn:hover { background: #0056b3; }
    .qda-regression-table {
        width: 100%; border-collapse: collapse; margin: 15px 0; font-size: 12px;
    }
    .qda-regression-table th, .qda-regression-table td {
        border: 1px solid #ddd; padding: 6px; text-align: left;
    }
    .qda-regression-table th { background-color: #f2f2f2; font-weight: bold; }
    .qda-metric-summary {
        display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 10px; margin: 20px 0;
    }
    .qda-metric-card {
        background: white; border: 1px solid #ddd; border-radius: 5px;
        padding: 10px; text-align: center; font-size: 12px;
    }
    .qda-strength-very-weak { background-color: #D9D9D9; color: #333; padding: 4px 8px; border-radius: 4px; font-weight: bold; }
    .qda-strength-weak { background-color: #E8E5A3; color: #333; padding: 4px 8px; border-radius: 4px; font-weight: bold; }
    .qda-strength-weak-moderate { background-color: #F6F16E; color: #333; padding: 4px 8px; border-radius: 4px; font-weight: bold; }
    .qda-strength-moderate { background-color: #FFE787; color: #333; padding: 4px 8px; border-radius: 4px; font-weight: bold; }
    .qda-strength-moderate-strong { background-color: #B3E4A1; color: #333; padding: 4px 8px; border-radius: 4px; font-weight: bold; }
    .qda-strength-strong { background-color: #66E1BB; color: #333; padding: 4px 8px; border-radius: 4px; font-weight: bold; }
    .qda-strength-very-strong { background-color: #00CF84; color: white; padding: 4px 8px; border-radius: 4px; font-weight: bold; }
`;

// Inject styles only once
if (!document.getElementById('qda-styles')) {
    const styleSheet = document.createElement('style');
    styleSheet.id = 'qda-styles';
    styleSheet.textContent = styles;
    document.head.appendChild(styleSheet);
}

// === HELPER FUNCTIONS FOR PERSISTENCE ===

/**
 * Clears all analysis-related data from localStorage.
 */
function clearAnalysisStorage() {
    Object.values(STORAGE_KEYS).forEach(key => localStorage.removeItem(key));
}

/**
 * Renders the persistent results into the designated output container.
 * @param {HTMLElement} outputContainer The container below the upload widgets.
 * @returns {boolean} True if results were loaded, false otherwise.
 */
function loadPersistedResults(outputContainer) {
    const summaryStatsText = localStorage.getItem(STORAGE_KEYS.SUMMARY);
    
    // Always clear old content in the output container before rendering new/persisted data
    outputContainer.innerHTML = ''; 

    if (!summaryStatsText) return false;

    try {
        const results = {
            summaryStats: JSON.parse(summaryStatsText),
            correlationResults: JSON.parse(localStorage.getItem(STORAGE_KEYS.CORRELATION)),
            regressionResults: JSON.parse(localStorage.getItem(STORAGE_KEYS.REGRESSION)),
            cleanData: JSON.parse(localStorage.getItem(STORAGE_KEYS.CLEAN_DATA))
        };
        
        // The container needs a wrapper div to apply the max-width styling
        const resultsDiv = document.createElement('div');
        resultsDiv.id = 'qdaAnalysisResultsInline';
        resultsDiv.className = 'qda-analysis-results'; // Applies max-width styling from CSS
        outputContainer.appendChild(resultsDiv);

        // Recreate sub-containers inside resultsDiv (REQUIRED for display functions)
        resultsDiv.innerHTML = `
            <div id="qdaSummaryStatsInline"></div>
            <div id="qdaDemographicBreakdownInline"></div>
            <div id="qdaPersonaBreakdownInline"></div>
            <div id="qdaCombinedResultsInline"></div>
            <div id="qdaPortfolioResultsInline"></div>
            <div id="qdaCreatorResultsInline"></div>
            <div id="qdaCrossAnalysisResultsInline"></div>
        `;
        
        // Display results
        displaySummaryStatsInline(results.summaryStats);
        displayDemographicBreakdownInline(results.summaryStats);
        displayPersonaBreakdownInline(results.summaryStats);
        displayCombinedAnalysisInline(results.correlationResults, results.regressionResults, results.cleanData);

        // Make the results visible
        resultsDiv.style.display = 'block';

        return true;
    } catch (e) {
        console.error("Error loading persisted results: Data corrupt or missing key.", e);
        // Clear corrupt data and the output area
        clearAnalysisStorage();
        outputContainer.innerHTML = '';
        return false;
    }
}


// === DISPLAY FUNCTIONS (Moved to Global Scope) ===
function createMetricCard(title, content, size = null) {
    const card = document.createElement('div');
    card.className = 'qda-metric-card';
    
    const titleEl = document.createElement('strong');
    titleEl.textContent = title;
    card.appendChild(titleEl);
    
    card.appendChild(document.createElement('br'));
    
    const contentEl = document.createElement('span');
    if (size) {
        contentEl.style.fontSize = size;
        contentEl.style.fontWeight = 'bold';
    }
    contentEl.textContent = content;
    card.appendChild(contentEl);
    
    return card;
}

function createTableRow(data) {
    const row = document.createElement('tr');
    
    data.forEach(cellData => {
        const cell = document.createElement('td');
        if (typeof cellData === 'object' && cellData.html) {
            const span = document.createElement('span');
            span.className = cellData.className || '';
            span.textContent = cellData.text;
            cell.appendChild(span);
        } else {
            cell.textContent = cellData;
        }
        row.appendChild(cell);
    });
    
    return row;
}

function getVariableLabel(variable) {
    const variableLabels = {
        'totalCopies': 'Total Copies',
        'totalDeposits': 'Total Deposits',
        'totalSubscriptions': 'Total Subscriptions',
        'hasLinkedBank': 'Has Linked Bank',
        'availableCopyCredits': 'Available Copy Credits',
        'buyingPower': 'Buying Power',
        'totalDepositCount': 'Total Deposit Count',
        'totalWithdrawals': 'Total Withdrawals',
        'totalWithdrawalCount': 'Total Withdrawal Count',
        'activeCreatedPortfolios': 'Active Created Portfolios',
        'lifetimeCreatedPortfolios': 'Lifetime Created Portfolios',
        'totalBuys': 'Total Buys',
        'totalSells': 'Total Sells',
        'totalTrades': 'Total Trades',
        'totalCopyStarts': 'Total Copy Starts',
        'totalRegularCopies': 'Total Regular Copies',
        'uniqueCreatorsInteracted': 'Unique Creators Interacted',
        'uniquePortfoliosInteracted': 'Unique Portfolios Interacted',
        'regularPDPViews': 'Regular PDP Views',
        'premiumPDPViews': 'Premium PDP Views',
        'paywallViews': 'Paywall Views',
        'totalStripeViews': 'Total Stripe Views',
        'regularCreatorProfileViews': 'Regular Creator Profile Views',
        'premiumCreatorProfileViews': 'Premium Creator Profile Views',
        'appSessions': 'App Sessions',
        'discoverTabViews': 'Discover Tab Views',
        'leaderboardViews': 'Leaderboard Views',
        'premiumTabViews': 'Premium Tab Views',
        'totalOfUserProfiles': 'Total User Profiles',
        'subscribedWithin7Days': 'Subscribed Within 7 Days',
        'timeToFirstCopy': 'Time To First Copy',
        'timeToDeposit': 'Time To Deposit',
        'timeToLinkedBank': 'Time To Linked Bank',
        'creatorCardTaps': 'Creator Card Taps',
        'portfolioCardTaps': 'Portfolio Card Taps',
        'incomeEnum': 'Income Level',
        'netWorthEnum': 'Net Worth Level',
        'income': 'Income',
        'netWorth': 'Net Worth',
        'investingExperienceYears': 'Investing Experience Years',
        'investingActivity': 'Investing Activity',
        'investingObjective': 'Investing Objective',
        'investmentType': 'Investment Type'
    };
    
    return variableLabels[variable] || variable.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
}

function calculateRelativeStrengths(dataArray, valueKey) {
    const sortedValues = dataArray.map(item => Math.abs(item[valueKey])).sort((a, b) => a - b);
    const total = sortedValues.length;
    
    const veryWeakThreshold = sortedValues[Math.floor(total * 0.143)];
    const weakThreshold = sortedValues[Math.floor(total * 0.286)];
    const weakModerateThreshold = sortedValues[Math.floor(total * 0.429)];
    const moderateThreshold = sortedValues[Math.floor(total * 0.571)];
    const moderateStrongThreshold = sortedValues[Math.floor(total * 0.714)];
    const strongThreshold = sortedValues[Math.floor(total * 0.857)];
    
    return {
        veryWeakThreshold, weakThreshold, weakModerateThreshold,
        moderateThreshold, moderateStrongThreshold, strongThreshold
    };
}

function displaySummaryStatsInline(stats) {
    const container = document.getElementById('qdaSummaryStatsInline');
    container.textContent = '';
    
    const resultSection = document.createElement('div');
    resultSection.className = 'qda-result-section';
    
    const title = document.createElement('h1');
    title.textContent = 'Summary Statistics';
    resultSection.appendChild(title);
    
    const metricSummary = document.createElement('div');
    metricSummary.className = 'qda-metric-summary';
    
    const metrics = [
        ['Total Users', stats.totalUsers.toLocaleString(), '18px'],
        ['Link Bank Rate', `${stats.linkBankConversion.toFixed(1)}%`, '18px'],
        ['Copy Rate', `${stats.firstCopyConversion.toFixed(1)}%`, '18px'],
        ['Deposit Rate', `${stats.depositConversion.toFixed(1)}%`, '18px'],
        ['Subscription Rate', `${stats.subscriptionConversion.toFixed(1)}%`, '18px']
    ];
    
    metrics.forEach(([title, content, size]) => {
        metricSummary.appendChild(createMetricCard(title, content, size));
    });
    
    resultSection.appendChild(metricSummary);
    container.appendChild(resultSection);
}

function displayDemographicBreakdownInline(stats) {
    const container = document.getElementById('qdaDemographicBreakdownInline');
    container.textContent = '';
    
    const resultSection = document.createElement('div');
    resultSection.className = 'qda-result-section';
    
    const title = document.createElement('h1');
    title.textContent = 'Demographic Breakdown';
    resultSection.appendChild(title);

    const grid = document.createElement('div');
    grid.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px;';

    const createBreakdownTable = (titleText, data, totalResponses) => {
        const tableContainer = document.createElement('div');
        tableContainer.style.maxWidth = '320px';
        
        const tableTitle = document.createElement('h4');
        tableTitle.textContent = titleText;
        tableTitle.style.cssText = 'margin: 0 0 10px 0; font-size: 14px;';
        tableContainer.appendChild(tableTitle);

        const table = document.createElement('table');
        table.className = 'qda-regression-table';
        table.style.fontSize = '12px';
        table.style.width = '100%';

        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        ['Category', 'Percentage'].forEach(header => {
            const th = document.createElement('th');
            th.textContent = header;
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');

        let dataArray = Object.keys(data)
            .filter(k => k.trim() !== '')
            .map(category => ({
                category,
                count: data[category],
                percentage: totalResponses > 0 ? (data[category] / totalResponses) * 100 : 0
            }));

        dataArray.sort((a, b) => b.percentage - a.percentage);

        dataArray.forEach(item => {
            const percentageFormatted = item.percentage.toFixed(1) + '%';
            tbody.appendChild(createTableRow([item.category, percentageFormatted]));
        });
        
        table.appendChild(tbody);
        tableContainer.appendChild(table);
        grid.appendChild(tableContainer);
    };

    const demographicConfigs = [
        { key: 'income', title: 'Income' },
        { key: 'netWorth', title: 'Net Worth' },
        { key: 'investingExperienceYears', title: 'Investing Experience Years' },
        { key: 'investingActivity', title: 'Investing Activity' },
        { key: 'investmentType', title: 'Investment Type' },
        { key: 'investingObjective', title: 'Investing Objective' }
    ];

    demographicConfigs.forEach(config => {
        createBreakdownTable(
            config.title,
            stats[config.key + 'Breakdown'],
            stats[config.key + 'TotalResponses']
        );
    });
    
    resultSection.appendChild(grid);
    container.appendChild(resultSection);
}

function displayPersonaBreakdownInline(stats) {
    const container = document.getElementById('qdaPersonaBreakdownInline');
    container.textContent = '';
    
    const resultSection = document.createElement('div');
    resultSection.className = 'qda-result-section';
    
    // Title Update
    const title = document.createElement('h1');
    title.textContent = 'Persona Breakdown';
    resultSection.appendChild(title);

    const grid = document.createElement('div');
    grid.style.cssText = 'display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px;';

    const personas = [
        {
            name: 'Premium',
            subtitle: 'Active subscriptions - highest revenue users',
            data: stats.personaStats.premium,
            priority: 1
        },
        {
            name: 'Aspiring Premium',
            subtitle: '$1000+ deposits, copies, higher income - premium conversion targets',
            data: stats.personaStats.aspiringPremium,
            priority: 2
        },
        {
            name: 'Core',
            subtitle: '$200-1000 deposits with banking OR active engagement - main user base',
            data: stats.personaStats.core,
            priority: 3
        },
        {
            name: 'Activation Targets',
            subtitle: 'Higher income prospects browsing creators but not converting',
            data: stats.personaStats.activationTargets,
            priority: 4
        },
        {
            name: 'Lower Income',
            subtitle: '≤$200 deposits, lower demographics, minimal engagement',
            data: stats.personaStats.lowerIncome,
            priority: 5
        },
        {
            name: 'Non-activated',
            subtitle: 'Zero banking, deposits, and platform engagement',
            data: stats.personaStats.nonActivated,
            priority: 6
        }
    ];

    personas.forEach(p => {
        const card = document.createElement('div');
        card.style.cssText = 'background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 8px; padding: 15px;';
        
        const nameEl = document.createElement('div');
        nameEl.style.cssText = 'font-weight: bold; color: #007bff; margin-bottom: 5px; font-size: 16px;';
        nameEl.textContent = `${p.priority}. ${p.name}`;
        card.appendChild(nameEl);

        const subtitleEl = document.createElement('div');
        subtitleEl.style.cssText = 'font-size: 12px; color: #6c757d; margin-bottom: 10px;';
        subtitleEl.textContent = p.subtitle;
        card.appendChild(subtitleEl);

        const percentageEl = document.createElement('div');
        percentageEl.style.cssText = 'font-size: 24px; font-weight: bold; color: #28a745; margin-bottom: 5px;';
        percentageEl.textContent = `${p.data.percentage.toFixed(1)}%`;
        card.appendChild(percentageEl);

        const countEl = document.createElement('div');
        countEl.style.cssText = 'font-size: 13px; color: #333;';
        countEl.textContent = `(N=${p.data.count.toLocaleString()})`;
        card.appendChild(countEl);

        grid.appendChild(card);
    });
    
    resultSection.appendChild(grid);
    container.appendChild(resultSection);
}

function displayCombinedAnalysisInline(correlationResults, regressionResults, cleanData) {
    const container = document.getElementById('qdaCombinedResultsInline');
    container.textContent = '';
    
    const resultSection = document.createElement('div');
    resultSection.className = 'qda-result-section';
    
    const title = document.createElement('h1');
    title.textContent = 'Behavioral Analysis';
    resultSection.appendChild(title);

    const orderedOutcomes = [
        { outcome: 'totalDeposits', label: 'Deposit Funds' },
        { outcome: 'totalCopies', label: 'Portfolio Copies' },
        { outcome: 'totalSubscriptions', label: 'Subscriptions' }
    ];
    
    orderedOutcomes.forEach((config) => {
        const outcome = config.outcome;
        const outcomeLabel = config.label;
        
        const outcomeTitle = document.createElement('h4');
        outcomeTitle.textContent = outcomeLabel;
        resultSection.appendChild(outcomeTitle);
        
        const allVariables = Object.keys(correlationResults[outcome]);
        const regressionData = regressionResults[outcome.replace('total', '').toLowerCase()];
        
        const excludedVars = SECTION_EXCLUSIONS[outcome] || [];
        const filteredVariables = allVariables.filter(variable => !excludedVars.includes(variable));
        
        const combinedData = filteredVariables.map(variable => {
            const correlation = correlationResults[outcome][variable];
            const regressionItem = regressionData.find(item => item.variable === variable);
            const tippingPoint = calculateTippingPoint(cleanData, variable, outcome);
            
            return {
                variable: variable,
                correlation: correlation,
                tStat: regressionItem ? regressionItem.tStat : 0,
                tippingPoint: tippingPoint
            };
        }).sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
        
        const tStatThresholds = calculateRelativeStrengths(combinedData, 'tStat');
        
        combinedData.forEach(item => {
            const absTStat = Math.abs(item.tStat);
            
            if (absTStat >= tStatThresholds.strongThreshold) {
                item.predictiveStrength = 'Very Strong';
                item.predictiveClass = 'qda-strength-very-strong';
            } else if (absTStat >= tStatThresholds.moderateStrongThreshold) {
                item.predictiveStrength = 'Strong';
                item.predictiveClass = 'qda-strength-strong';
            } else if (absTStat >= tStatThresholds.moderateThreshold) {
                item.predictiveStrength = 'Moderate - Strong';
                item.predictiveClass = 'qda-strength-moderate-strong';
            } else if (absTStat >= tStatThresholds.weakModerateThreshold) {
                item.predictiveStrength = 'Moderate';
                item.predictiveClass = 'qda-strength-moderate';
            } else if (absTStat >= tStatThresholds.weakThreshold) {
                item.predictiveStrength = 'Weak - Moderate';
                item.predictiveClass = 'qda-strength-weak-moderate';
            } else if (absTStat >= tStatThresholds.veryWeakThreshold) {
                item.predictiveStrength = 'Weak';
                item.predictiveClass = 'qda-strength-weak';
            } else {
                item.predictiveStrength = 'Very Weak';
                item.predictiveClass = 'qda-strength-very-weak';
            }
        });
        
        const table = document.createElement('table');
        table.className = 'qda-regression-table';
        
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        ['Variable', 'Correlation', 'T-Statistic', 'Predictive Strength', 'Tipping Point'].forEach(header => {
            const th = document.createElement('th');
            th.textContent = header;
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);
        
        const tbody = document.createElement('tbody');
        combinedData.slice(0, 25).forEach(item => {
            const rowData = [
                getVariableLabel(item.variable),
                item.correlation.toFixed(3),
                item.tStat.toFixed(3),
                { text: item.predictiveStrength, className: item.predictiveClass, html: true },
                item.tippingPoint !== 'N/A' ?
                    (typeof item.tippingPoint === 'number' ? item.tippingPoint.toFixed(1) : item.tippingPoint) :
                    'N/A'
            ];
            tbody.appendChild(createTableRow(rowData));
        });
        table.appendChild(tbody);
        
        resultSection.appendChild(table);
    });
    
    container.appendChild(resultSection);
}

// Main widget creation function
// Now accepts two containers: uploadContainer (for the side-by-side UI) and outputContainer (for results below)
function createWidget(uploadContainer, outputContainer) {
    const widget = document.createElement('div');
    
    // The main widget container (in the side-by-side section) should be styled for inline use
    widget.className = 'qda-inline-widget';
    widget.style.maxWidth = '1200px'; 

    // Header (Always created inside the upload container widget)
    const header = document.createElement('div');
    header.className = 'qda-header';
    
    const title = document.createElement('h3');
    title.style.margin = '0';
    title.textContent = 'dub User Analysis'; 
    header.appendChild(title);
    
    // Content (holds upload section)
    const content = document.createElement('div');
    content.className = 'qda-content';
    
    // Upload section (The core UI component)
    const uploadSection = document.createElement('div');
    uploadSection.className = 'qda-upload-section';
    
    // Main Analysis File (required)
    const mainColumn = document.createElement('div');
    mainColumn.className = 'qda-upload-column';
    
    const mainLabel = document.createElement('div');
    mainLabel.className = 'qda-file-label';
    mainLabel.textContent = 'Select Main Analysis CSV File';
    mainColumn.appendChild(mainLabel);
    
    const mainFileInput = document.createElement('input');
    mainFileInput.type = 'file';
    mainFileInput.id = 'qdaMainFileInline'; 
    mainFileInput.accept = '.csv';
    mainFileInput.className = 'qda-file-input';
    mainColumn.appendChild(mainFileInput);
    
    uploadSection.appendChild(mainColumn);
    
    const analyzeRow = document.createElement('div');
    analyzeRow.className = 'qda-analyze-row';
    
    const analyzeBtn = document.createElement('button');
    analyzeBtn.className = 'qda-btn';
    analyzeBtn.id = 'qdaAnalyzeBtnInline';
    analyzeBtn.textContent = 'Analyze Data';
    
    // Pass the outputContainer ID to the analysis function for result placement
    analyzeBtn.addEventListener('click', () => analyzeDataInline(uploadContainer, outputContainer.id));
    
    analyzeRow.appendChild(analyzeBtn);
    uploadSection.appendChild(analyzeRow);
    
    content.appendChild(header);
    content.appendChild(uploadSection);

    widget.appendChild(content);

    // Final placement: The widget with the header/upload form goes into its dedicated container
    uploadContainer.innerHTML = '';
    uploadContainer.appendChild(widget);
    
    // --- PERSISTENCE CHECK: Load results into the separate output container ---
    loadPersistedResults(outputContainer);
}

// Analysis functions
// Now accepts the upload container (widget) and the results container ID
async function analyzeDataInline(uploadContainer, outputContainerId) {
    // 1. Clear storage before starting new analysis
    clearAnalysisStorage();

    const mainFileInput = document.getElementById('qdaMainFileInline');
    
    if (!mainFileInput.files[0]) {
        alert('Please select the Main Analysis CSV file');
        return;
    }

    const analyzeBtn = document.getElementById('qdaAnalyzeBtnInline');
    analyzeBtn.textContent = 'Analyzing...';
    analyzeBtn.disabled = true;
    
    const portfolioCsvText = null; 
    const creatorCsvText = null;

    try {
        const mainCsvText = await readFile(mainFileInput.files[0]);
        
        // Ensure old results are cleared from the output area
        const outputContainer = document.getElementById(outputContainerId);
        if (outputContainer) outputContainer.innerHTML = '';
        
        console.log('Starting analysis...');
        const results = performQuantitativeAnalysis(mainCsvText, portfolioCsvText, creatorCsvText);
        
        // 2. DATA STORAGE: Store results to localStorage
        localStorage.setItem(STORAGE_KEYS.SUMMARY, JSON.stringify(results.summaryStats));
        localStorage.setItem(STORAGE_KEYS.CORRELATION, JSON.stringify(results.correlationResults));
        localStorage.setItem(STORAGE_KEYS.REGRESSION, JSON.stringify(results.regressionResults));
        localStorage.setItem(STORAGE_KEYS.CLEAN_DATA, JSON.stringify(results.cleanData)); 
        
        // 3. RENDER RESULTS: Manually call the loading function to re-render in the persistent container
        if (outputContainer) {
            loadPersistedResults(outputContainer); 
        }

    } catch (error) {
        alert('Error analyzing data: ' + error.message);
        clearAnalysisStorage(); // Clear storage on failure to prevent partial loads
        const outputContainer = document.getElementById(outputContainerId);
        if (outputContainer) outputContainer.innerHTML = ''; // Clear results area on failure
        console.error('Full error:', error);
    } finally {
        analyzeBtn.textContent = 'Analyze Data';
        analyzeBtn.disabled = false;
    }
}

async function analyzeData() {
    // This desktop function is unused in the new inline flow but is kept for integrity
    // STATE RESET: Clear storage before starting new analysis
    clearAnalysisStorage();
    
    const mainFileInput = document.getElementById('qdaMainFile');
    
    if (!mainFileInput.files[0]) {
        alert('Please select the Main Analysis CSV file');
        return;
    }

    const analyzeBtn = document.getElementById('qdaAnalyzeBtn');
    analyzeBtn.textContent = 'Analyzing...';
    analyzeBtn.disabled = true;

    const portfolioCsvText = null; 
    const creatorCsvText = null;

    try {
        const mainCsvText = await readFile(mainFileInput.files[0]);
        
        console.log('Starting analysis...');
        const results = performQuantitativeAnalysis(mainCsvText, portfolioCsvText, creatorCsvText);
        
        // DATA STORAGE: Store results to localStorage
        localStorage.setItem(STORAGE_KEYS.SUMMARY, JSON.stringify(results.summaryStats));
        localStorage.setItem(STORAGE_KEYS.CORRELATION, JSON.stringify(results.correlationResults));
        localStorage.setItem(STORAGE_KEYS.REGRESSION, JSON.stringify(results.regressionResults));
        localStorage.setItem(STORAGE_KEYS.CLEAN_DATA, JSON.stringify(results.cleanData));

        // Display results - placeholder for non-inline version
        document.getElementById('qdaAnalysisResults').style.display = 'block';
        document.getElementById('qdaAnalysisResults').innerHTML = '<h2>Analysis Complete!</h2><p>Results would be displayed here.</p>';
        
        console.log('Analysis completed successfully!');
    } catch (error) {
        alert('Error analyzing data: ' + error.message);
        clearAnalysisStorage(); // Clear storage on failure to prevent partial loads
        console.error('Full error:', error);
    } finally {
        analyzeBtn.textContent = 'Analyze Data';
        analyzeBtn.disabled = false;
    }
}

// Helper functions (omitted for brevity)
function readFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsText(file);
    });
}
function parseCSV(text) {
    const lines = text.split('\n');
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const data = [];
    
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim()) {
            const values = lines[i].split(',');
            const row = {};
            headers.forEach((header, index) => {
                let value = values[index] ? values[index].trim().replace(/"/g, '') : '';
                if (value === 'TRUE' || value === 'true') value = true;
                else if (value === 'FALSE' || value === 'false') value = false;
                else if (!isNaN(value) && value !== '') value = parseFloat(value);
                row[header] = value;
            });
            data.push(row);
        }
    }
    
    return { data };
}
function cleanNumeric(value) {
    if (value === null || value === undefined || value === '' || isNaN(value)) return 0;
    return parseFloat(value) || 0;
}
// Updated to handle both long and new short-form keys (e.g., '50k–100k')
function convertIncomeToEnum(income) {
    const incomeMap = {
        'Less than $25,000': 1, '<25k': 1,
        '$25,000-$49,999': 2, '25k–50k': 2,
        '$50,000-$74,999': 3, '50k–100k': 3,
        '$75,000-$99,999': 4, '75k–100k': 4,
        '$100,000-$149,999': 5, '100k–150k': 5,
        '$150,000-$199,999': 6, '150k–200k': 6,
        '$200,000+': 7, '200k+': 7
    };
    return incomeMap[income] || 0;
}
// Updated to handle both long and new short-form keys (e.g., '100k–250k')
function convertNetWorthToEnum(netWorth) {
    const netWorthMap = {
        'Less than $10,000': 1, '<10k': 1,
        '$10,000-$49,999': 2, '10k–50k': 2,
        '$50,000-$99,999': 3, '50k–100k': 3,
        '$100,000-$249,999': 4, '100k–250k': 4,
        '$250,000-$499,999': 5, '250k–500k': 5,
        '$500,000-$999,999': 6, '500k–1m': 6,
        '$1,000,000+': 7, '1m+': 7
    };
    return netWorthMap[netWorth] || 0;
}
function calculateCorrelation(x, y) {
    const n = x.length;
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
    const sumY2 = y.reduce((sum, yi) => sum + yi * yi, 0);

    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
    
    return denominator === 0 ? 0 : numerator / denominator;
}
function calculateCorrelations(data) {
    const variables = ALL_VARIABLES;
    const correlations = {};
    
    ['totalCopies', 'totalDeposits', 'totalSubscriptions'].forEach(outcome => {
        correlations[outcome] = {};
        variables.forEach(variable => {
            if (variable !== outcome) {
                correlations[outcome][variable] = calculateCorrelation(
                    data.map(d => d[outcome]),
                    data.map(d => d[variable])
                );
            }
        });
    });

    return correlations;
}
function performRegression(data, outcome) {
    const predictors = ALL_VARIABLES;

    const results = predictors.filter(predictor => predictor !== outcome).map(predictor => {
        const correlation = calculateCorrelation(
            data.map(d => d[outcome]),
            data.map(d => d[predictor])
        );
        
        const n = data.length;
        let tStat = 0;
        if (Math.abs(correlation) > 0.001 && n > 2) {
            const denominator = 1 - (correlation * correlation);
            if (denominator > 0.001) {
                tStat = correlation * Math.sqrt((n - 2) / denominator);
            }
        }

        return {
            variable: predictor,
            correlation: correlation,
            tStat: tStat,
            significant: Math.abs(tStat) > 1.96
        };
    });

    return results.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
}
function calculateTippingPoint(data, variable, outcome) {
    const groups = {};
    data.forEach(user => {
        const value = Math.floor(user[variable]) || 0;
        const converted = user[outcome] > 0 ? 1 : 0;
        
        if (!groups[value]) {
            groups[value] = { total: 0, converted: 0 };
        }
        groups[value].total++;
        groups[value].converted += converted;
    });
    
    const conversionRates = Object.keys(groups)
        .map(value => ({
            value: parseInt(value),
            rate: groups[value].converted / groups[value].total,
            total: groups[value].total
        }))
        .filter(item => item.total >= 10)
        .sort((a, b) => a.value - b.value);
    
    if (conversionRates.length < 2) return 'N/A';
    
    let maxIncrease = 0;
    let tippingPoint = 'N/A';
    
    for (let i = 1; i < conversionRates.length; i++) {
        const increase = conversionRates[i].rate - conversionRates[i-1].rate;
        if (increase > maxIncrease && conversionRates[i].rate > 0.1) {
            maxIncrease = increase;
            tippingPoint = conversionRates[i].value;
        }
    }
    
    return tippingPoint;
}
function classifyPersona(user) {
    function isLowerOrUnknownIncome(income) {
        // Updated to use both long form (if present) and short form (if present)
        const lowerIncomes = ['Less than $25,000', '<25k', '$25,000-$49,999', '25k–50k', '$50,000-$74,999', '50k–100k'];
        return !income || income.trim() === '' || lowerIncomes.includes(income);
    }
    
    function isLowerOrUnknownNetWorth(netWorth) {
        // Updated to use both long form (if present) and short form (if present)
        const lowerNetWorths = ['Less than $10,000', '<10k', '$10,000-$49,999', '10k–50k', '$50,000-$99,999', '50k–100k'];
        return !netWorth || netWorth.trim() === '' || lowerNetWorths.includes(netWorth);
    }
    
    function isHigherOrUnknownIncome(income) {
        // Returns true if income is not one of the lower incomes (i.e., higher or missing)
        const lowerIncomes = ['Less than $25,000', '<25k', '$25,000-$49,999', '25k–50k', '$50,000-$74,999', '50k–100k'];
        return !income || income.trim() === '' || !lowerIncomes.includes(income);
    }
    
    const totalPDPViews = (user.regularPDPViews || 0) + (user.premiumPDPViews || 0);
    const totalCreatorViews = (user.regularCreatorProfileViews || 0) + (user.premiumCreatorProfileViews || 0);
    const hasCopied = user.totalCopies >= 1;
    
    // HIERARCHICAL PRIORITY ORDER
    if (user.totalSubscriptions >= 1 || user.subscribedWithin7Days === 1) {
        return 'premium';
    }
    
    if (user.totalSubscriptions === 0 &&
        hasCopied &&
        isHigherOrUnknownIncome(user.income) &&
        user.totalDeposits >= 1000) {
        return 'aspiringPremium';
    }
    
    if (user.totalSubscriptions === 0) {
        const depositQualifies = (user.totalDeposits >= 200 && user.totalDeposits <= 1000 && user.hasLinkedBank === 1);
        const engagementQualifies = (hasCopied || totalPDPViews >= 2);
        
        if (depositQualifies || engagementQualifies) {
            return 'core';
        }
    }
    
    if (isHigherOrUnknownIncome(user.income) &&
        user.hasLinkedBank === 0 &&
        user.totalDeposits === 0 &&
        user.totalCopies === 0 &&
        totalCreatorViews > 0 &&
        totalPDPViews < 2) {
        return 'activationTargets';
    }
    
    const hasEngagement = hasCopied || totalPDPViews >= 1;
    if (user.totalDeposits <= 200 &&
        isLowerOrUnknownIncome(user.income) &&
        isLowerOrUnknownNetWorth(user.netWorth) &&
        user.totalSubscriptions === 0 &&
        user.hasLinkedBank === 1 &&
        !hasEngagement) {
        return 'lowerIncome';
    }
    
    if (user.hasLinkedBank === 0 &&
        user.totalDeposits === 0 &&
        totalPDPViews === 0 &&
        totalCreatorViews === 0) {
        return 'nonActivated';
    }
    
    return 'unclassified';
}
function calculateDemographicBreakdown(data, key) {
    let totalResponses = 0;
    const counts = data.reduce((acc, d) => {
        const value = d[key];
        if (value && typeof value === 'string' && value.trim() !== '') {
            acc[value] = (acc[value] || 0) + 1;
            totalResponses++;
        }
        return acc;
    }, {});
    return { counts, totalResponses };
}
function calculateSummaryStats(data) {
    const usersWithLinkedBank = data.filter(d => d.hasLinkedBank === 1).length;
    const usersWithCopies = data.filter(d => d.totalCopies > 0).length;
    const usersWithDeposits = data.filter(d => d.totalDeposits > 0).length;
    const usersWithSubscriptions = data.filter(d => d.totalSubscriptions > 0).length;
    
    const demographicKeys = [
        'income', 'netWorth', 'investingExperienceYears',
        'investingActivity', 'investmentType', 'investingObjective'
    ];

    const demographics = {};
    demographicKeys.forEach(key => {
        const breakdown = calculateDemographicBreakdown(data, key);
        demographics[key + 'Breakdown'] = breakdown.counts;
        demographics[key + 'TotalResponses'] = breakdown.totalResponses;
    });

    const totalUsers = data.length;
    const personaCounts = {
        premium: 0, aspiringPremium: 0, core: 0, activationTargets: 0,
        lowerIncome: 0, nonActivated: 0, unclassified: 0
    };
    
    data.forEach(user => {
        const persona = classifyPersona(user);
        personaCounts[persona] = (personaCounts[persona] || 0) + 1;
    });
    
    const personaStats = {
        premium: {
            count: personaCounts.premium,
            percentage: totalUsers > 0 ? (personaCounts.premium / totalUsers) * 100 : 0
        },
        aspiringPremium: {
            count: personaCounts.aspiringPremium,
            percentage: totalUsers > 0 ? (personaCounts.aspiringPremium / totalUsers) * 100 : 0
        },
        core: {
            count: personaCounts.core,
            percentage: totalUsers > 0 ? (personaCounts.core / totalUsers) * 100 : 0
        },
        activationTargets: {
            count: personaCounts.activationTargets,
            percentage: totalUsers > 0 ? (personaCounts.activationTargets / totalUsers) * 100 : 0
        },
        lowerIncome: {
            count: personaCounts.lowerIncome,
            percentage: totalUsers > 0 ? (personaCounts.lowerIncome / totalUsers) * 100 : 0
        },
        nonActivated: {
            count: personaCounts.nonActivated,
            percentage: totalUsers > 0 ? (personaCounts.nonActivated / totalUsers) * 100 : 0
        }
    };
    
    return {
        totalUsers: totalUsers,
        linkBankConversion: (usersWithLinkedBank / totalUsers) * 100,
        firstCopyConversion: (usersWithCopies / totalUsers) * 100,
        depositConversion: (usersWithDeposits / totalUsers) * 100,
        subscriptionConversion: (usersWithSubscriptions / totalUsers) * 100,
        ...demographics,
        personaStats
    };
}
function performQuantitativeAnalysis(csvText, portfolioCsvText = null, creatorCsvText = null) {
    const parsed = parseCSV(csvText);
    const data = parsed.data;

    const cleanData = data.map(row => ({
        // Core Conversion Metrics
        totalCopies: cleanNumeric(row['Total Copies'] || row['E. Total Copies']),
        totalDeposits: cleanNumeric(row['Total Deposits'] || row['B. Total Deposits ($)']),
        totalSubscriptions: cleanNumeric(row['Total Subscriptions'] || row['M. Total Subscriptions']),
        
        // Account & Financial Metrics
        hasLinkedBank: (row['Linked Bank Account'] === true || row['Linked Bank Account'] === 'true' || 
                        row['Linked Bank Account'] === 1 || row['Linked Bank Account'] === '1' ||
                        row['A. Linked Bank Account'] === 1) ? 1 : 0,
        availableCopyCredits: cleanNumeric(row['Available Copy Credits'] || row['availableCopyCredits']),
        buyingPower: cleanNumeric(row['Buying Power'] || row['buyingPower']),
        totalDepositCount: cleanNumeric(row['Total Deposit Count'] || row['C. Total Deposit Count']),
        totalWithdrawals: cleanNumeric(row['Total Withdrawals'] || row['totalWithdrawals']),
        totalWithdrawalCount: cleanNumeric(row['Total Withdrawal Count'] || row['totalWithdrawalCount']),
        
        // Portfolio Trading Metrics - ADDED TO HANDLE CLEANED COLUMNS
        activeCreatedPortfolios: cleanNumeric(row['Active Created Portfolios'] || row['activeCreatedPortfolios']),
        lifetimeCreatedPortfolios: cleanNumeric(row['Lifetime Created Portfolios'] || row['lifetimeCreatedPortfolios']),
        totalBuys: cleanNumeric(row['Total Buys'] || row['totalBuys']),
        totalSells: cleanNumeric(row['Total Sells'] || row['totalSells']),
        totalTrades: cleanNumeric(row['Total Trades'] || row['totalTrades']),
        
        // Behavioral / Engagement Metrics
        totalCopyStarts: cleanNumeric(row['Total Copy Starts']),
        totalRegularCopies: cleanNumeric(row['Total Regular Copies'] || row['F. Total Regular Copies']),
        uniqueCreatorsInteracted: cleanNumeric(row['Unique Creators Interacted']),
        uniquePortfoliosInteracted: cleanNumeric(row['Unique Portfolios Interacted']),
        
        regularPDPViews: cleanNumeric(row['Regular PDP Views'] || row['H. Regular PDP Views']),
        premiumPDPViews: cleanNumeric(row['Premium PDP Views'] || row['I. Premium PDP Views']),
        paywallViews: cleanNumeric(row['Paywall Views'] || row['J. Paywall Views']),
        totalStripeViews: cleanNumeric(row['Total Stripe Views'] || row['R. Stripe Modal Views']),
        regularCreatorProfileViews: cleanNumeric(row['Regular Creator Profile Views'] || row['K. Regular Creator Profile Views']),
        premiumCreatorProfileViews: cleanNumeric(row['Premium Creator Profile Views'] || row['L. Premium Creator Profile Views']),
        
        appSessions: cleanNumeric(row['App Sessions'] || row['N. App Sessions']),
        discoverTabViews: cleanNumeric(row['Discover Tab Views'] || row['O. Discover Tab Views']),
        leaderboardViews: cleanNumeric(row['Leaderboard Views'] || row['P. Leaderboard Tab Views']),
        premiumTabViews: cleanNumeric(row['Premium Tab Views'] || row['Q. Premium Tab Views']),
        totalOfUserProfiles: cleanNumeric(row['Total Of User Profiles']),
        
        subscribedWithin7Days: cleanNumeric(row['Subscribed Within 7 Days'] || row['D. Subscribed within 7 days']),
        
        timeToFirstCopy: cleanNumeric(row['Time To First Copy']),
        timeToDeposit: cleanNumeric(row['Time To Deposit']),
        timeToLinkedBank: cleanNumeric(row['Time To Linked Bank']),
        
        creatorCardTaps: cleanNumeric(row['Creator Card Taps'] || row['S. Creator Card Taps']),
        portfolioCardTaps: cleanNumeric(row['Portfolio Card Taps'] || row['T. Portfolio Card Taps']),
        
        // Demographic Metrics
        income: row['Income'] || row['income'] || '',
        netWorth: row['Net Worth'] || row['netWorth'] || '',
        incomeEnum: convertIncomeToEnum(row['Income'] || row['income'] || ''),
        netWorthEnum: convertNetWorthToEnum(row['Net Worth'] || row['netWorth'] || ''),
        investingExperienceYears: row['Investing Experience Years'] || row['investingExperienceYears'] || '',
        investingActivity: row['Investing Activity'] || row['investingActivity'] || '',
        investingObjective: row['Investing Objective'] || row['investingObjective'] || '',
        investmentType: row['Investment Type'] || row['investmentType'] || ''
    }));

    const summaryStats = calculateSummaryStats(cleanData);
    const correlationResults = calculateCorrelations(cleanData);
    const regressionResults = {
        copies: performRegression(cleanData, 'totalCopies'),
        deposits: performRegression(cleanData, 'totalDeposits'),
        subscriptions: performRegression(cleanData, 'totalSubscriptions')
    };
    
    return {
        summaryStats,
        correlationResults,
        regressionResults,
        cleanData
    };
}
function makeDraggable(element) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    const header = element.querySelector('.qda-header');
    
    header.onmousedown = function(e) {
        e = e || window.event;
        e.preventDefault();
        pos3 = e.clientX;
        pos4 = e.clientY;
        document.onmouseup = function() {
            document.onmouseup = null;
            document.onmousemove = null;
        };
        document.onmousemove = function(e) {
            e = e || window.event;
            e.preventDefault();
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;
            element.style.top = (element.offsetTop - pos2) + "px";
            element.style.left = (element.offsetLeft - pos1) + "px";
            element.style.right = 'auto';
        };
    };
}
console.log('Enhanced QDA Tool loaded successfully!');
