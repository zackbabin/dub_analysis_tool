// Unified Analysis Tool - Complete End-to-End Workflow
'use strict';

/**
 * This unified tool combines:
 * 1. Data fetching from Mixpanel (GitHub Actions workflow or direct API)
 * 2. Data merging (processing 7 CSV files into 3 outputs)
 * 3. Analysis execution (statistical analysis and visualization)
 */

class UserAnalysisTool {
    constructor() {
        this.mixpanelSync = null; // Lazy-loaded when GitHub workflow is used
        this.container = null;
        this.outputContainer = null;
        this.statusMessages = [];
    }

    /**
     * Creates the unified tool UI
     */
    createUI(container, outputContainer) {
        this.container = container;
        this.outputContainer = outputContainer;

        // Try to restore previous analysis results
        this.restoreAnalysisResults();

        const wrapper = document.createElement('div');
        wrapper.className = 'qda-inline-widget';

        // Content (no header)
        const content = document.createElement('div');
        content.className = 'qda-content';

        // Mode Selection
        const modeSection = this.createModeSection();
        content.appendChild(modeSection);

        // GitHub Token Configuration
        const tokenSection = this.createTokenSection();
        content.appendChild(tokenSection);

        // Status Display
        const statusSection = document.createElement('div');
        statusSection.id = 'unifiedStatusSection';
        statusSection.style.cssText = 'margin: 20px 0; padding: 15px; background: #f8f9fa; border-radius: 5px; min-height: 100px; display: none;';
        content.appendChild(statusSection);

        // Progress Bar
        const progressSection = document.createElement('div');
        progressSection.id = 'unifiedProgressSection';
        progressSection.style.cssText = 'margin: 20px 0; display: none;';
        progressSection.innerHTML = `
            <div style="background: #e9ecef; border-radius: 5px; overflow: hidden; height: 30px;">
                <div id="unifiedProgressBar" style="background: linear-gradient(90deg, #17a2b8, #138496); height: 100%; width: 0%; transition: width 0.3s; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 12px;">
                    0%
                </div>
            </div>
        `;
        content.appendChild(progressSection);

        wrapper.appendChild(content);
        container.innerHTML = '';
        container.appendChild(wrapper);
    }

    /**
     * Creates the mode selection section
     */
    createModeSection() {
        const section = document.createElement('div');
        section.style.cssText = 'margin-bottom: 20px;';

        const title = document.createElement('h4');
        title.textContent = 'Select Data Source';
        title.style.cssText = 'margin: 0 0 15px 0; color: #333;';
        section.appendChild(title);

        // Mode buttons
        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = 'display: flex; gap: 15px; margin-bottom: 20px; flex-wrap: wrap; justify-content: center;';

        // Option 1: Fetch from Mixpanel via GitHub Actions
        const githubBtn = this.createModeButton(
            'Sync Live Data',
            'Fetch the latest data from Mixpanel',
            '#28a745',
            '#28a745',
            () => this.runWorkflow('github')
        );
        buttonContainer.appendChild(githubBtn);

        // Option 2: Upload CSV files
        const uploadBtn = this.createModeButton(
            'Manually Upload Data',
            'Upload your own 7 CSV files for analysis',
            '#dee2e6',
            '#6c757d',
            () => this.runWorkflow('upload')
        );
        buttonContainer.appendChild(uploadBtn);

        section.appendChild(buttonContainer);

        // File upload section (hidden by default)
        const uploadSection = document.createElement('div');
        uploadSection.id = 'unifiedUploadSection';
        uploadSection.style.cssText = 'display: none; border: 2px dashed #17a2b8; border-radius: 8px; padding: 20px; background: #f8f9fa; margin-top: 15px;';
        uploadSection.innerHTML = `
            <div style="text-align: center;">
                <label style="font-weight: bold; color: #333; display: block; margin-bottom: 10px;">
                    Select 4 Required CSV Files
                </label>
                <div style="font-size: 12px; color: #6c757d; margin-bottom: 10px;">
                    Required: Subscriber Insights, Time to Linked Bank, Time to Funded Account, Time to First Copy
                </div>
                <input type="file" id="unifiedFileInput" accept=".csv" multiple style="padding: 8px; border: 1px solid #ddd; border-radius: 4px; width: 100%; margin-bottom: 15px;">
                <button id="unifiedProcessButton" class="qda-btn" style="display: none;">
                    Process Files
                </button>
            </div>
        `;
        section.appendChild(uploadSection);

        return section;
    }

    /**
     * Creates the GitHub token configuration section
     */
    createTokenSection() {
        const section = document.createElement('div');
        section.style.cssText = 'margin-bottom: 20px; padding: 20px; background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px;';

        const title = document.createElement('h4');
        title.textContent = '⚙️ GitHub Token Configuration';
        title.style.cssText = 'margin: 0 0 10px 0; color: #856404;';
        section.appendChild(title);

        const description = document.createElement('p');
        description.textContent = 'Required for "Sync Live Data" feature. Enter and save your GitHub Personal Access Token below:';
        description.style.cssText = 'margin: 0 0 15px 0; font-size: 13px; color: #856404;';
        section.appendChild(description);

        // Token input field
        const inputContainer = document.createElement('div');
        inputContainer.style.cssText = 'display: flex; gap: 10px; margin-bottom: 10px;';

        const input = document.createElement('input');
        input.type = 'password';
        input.id = 'githubTokenInput';
        input.placeholder = 'Enter GitHub Personal Access Token';
        input.style.cssText = 'flex: 1; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-family: monospace;';
        input.value = localStorage.getItem('github_pat') || '';
        inputContainer.appendChild(input);

        const saveBtn = document.createElement('button');
        saveBtn.textContent = 'Save Token';
        saveBtn.className = 'qda-btn';
        saveBtn.style.background = '#28a745';
        saveBtn.onclick = () => {
            const token = input.value.trim();
            if (token) {
                localStorage.setItem('github_pat', token);
                alert('✅ Token saved successfully!');
            } else {
                alert('❌ Please enter a valid token');
            }
        };
        inputContainer.appendChild(saveBtn);

        section.appendChild(inputContainer);

        // Default token with copy button
        const defaultTokenContainer = document.createElement('div');
        defaultTokenContainer.style.cssText = 'margin-top: 10px; padding: 10px; background: white; border: 1px solid #ddd; border-radius: 4px;';

        const defaultTokenLabel = document.createElement('div');
        defaultTokenLabel.textContent = 'Default Token (click to copy):';
        defaultTokenLabel.style.cssText = 'font-size: 12px; color: #6c757d; margin-bottom: 5px;';
        defaultTokenContainer.appendChild(defaultTokenLabel);

        const tokenDisplay = document.createElement('div');
        tokenDisplay.style.cssText = 'display: flex; align-items: center; gap: 10px;';

        const tokenText = document.createElement('code');
        tokenText.textContent = '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';
        tokenText.style.cssText = 'flex: 1; padding: 8px; background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 4px; font-size: 12px; word-break: break-all;';
        tokenDisplay.appendChild(tokenText);

        const copyBtn = document.createElement('button');
        copyBtn.textContent = '📋 Copy';
        copyBtn.className = 'qda-btn';
        copyBtn.style.cssText = 'background: #007bff; padding: 8px 15px; font-size: 12px;';
        copyBtn.onclick = () => {
            navigator.clipboard.writeText('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').then(() => {
                copyBtn.textContent = '✅ Copied!';
                setTimeout(() => {
                    copyBtn.textContent = '📋 Copy';
                }, 2000);
            });
        };
        tokenDisplay.appendChild(copyBtn);

        defaultTokenContainer.appendChild(tokenDisplay);
        section.appendChild(defaultTokenContainer);

        return section;
    }

    /**
     * Creates a styled mode selection button
     */
    createModeButton(title, description, borderColor, textColor, onClick) {
        const button = document.createElement('div');
        button.style.cssText = `
            flex: 1;
            min-width: 200px;
            padding: 20px;
            background: white;
            border: 2px solid ${borderColor};
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.3s;
            text-align: center;
            box-sizing: border-box;
        `;

        button.innerHTML = `
            <div style="font-weight: bold; color: ${textColor}; font-size: 16px; margin-bottom: 8px;">
                ${title}
            </div>
            <div style="font-size: 12px; color: #6c757d;">
                ${description}
            </div>
        `;

        button.onmouseover = () => {
            button.style.background = borderColor;
            button.querySelector('div:first-child').style.color = 'white';
            button.querySelector('div:last-child').style.color = 'white';
        };

        button.onmouseout = () => {
            button.style.background = 'white';
            button.querySelector('div:first-child').style.color = textColor;
            button.querySelector('div:last-child').style.color = '#6c757d';
        };

        button.onclick = onClick;

        return button;
    }

    /**
     * Runs the selected workflow
     */
    async runWorkflow(mode) {
        this.clearStatus();
        // Don't show status by default - only show for errors
        this.showProgress(0);

        try {
            if (mode === 'github') {
                await this.runGitHubWorkflow();
            } else if (mode === 'upload') {
                await this.runUploadWorkflow();
            }
        } catch (error) {
            this.addStatusMessage(`❌ Error: ${error.message}`, 'error');
            console.error('Workflow error:', error);
        }
    }

    /**
     * Runs the GitHub Actions workflow (Supabase version overrides this)
     * This base implementation is never called in production
     */
    async runGitHubWorkflow() {
        throw new Error('runGitHubWorkflow must be implemented by Supabase subclass');
    }

    /**
     * Saves analysis results to localStorage
     */
    saveAnalysisResults(resultsHTML) {
        try {
            const data = {
                html: resultsHTML,
                timestamp: new Date().toISOString()
            };
            localStorage.setItem('dubAnalysisResults', JSON.stringify(data));
        } catch (e) {
            console.warn('Failed to save analysis results to localStorage:', e);
        }
    }

    /**
     * Restores analysis results from localStorage
     */
    restoreAnalysisResults() {
        try {
            const saved = localStorage.getItem('dubAnalysisResults');
            if (saved) {
                const data = JSON.parse(saved);
                if (this.outputContainer && data.html) {
                    this.outputContainer.innerHTML = data.html;
                    console.log('Restored analysis results from', data.timestamp);
                }
            }
        } catch (e) {
            console.warn('Failed to restore analysis results from localStorage:', e);
        }
    }

    /**
     * Displays analysis results
     */
    displayResults(results) {
        // Clear output container
        this.outputContainer.innerHTML = '';

        // Create results div
        const resultsDiv = document.createElement('div');
        resultsDiv.id = 'qdaAnalysisResultsInline';
        resultsDiv.className = 'qda-analysis-results';
        this.outputContainer.appendChild(resultsDiv);

        // Add timestamp
        const timestamp = document.createElement('div');
        timestamp.className = 'qda-timestamp';

        // Load from batched localStorage (with fallback to old format for backward compatibility)
        let analysisData = null;
        try {
            const batchedData = localStorage.getItem('qdaAnalysisResults');
            if (batchedData) {
                analysisData = JSON.parse(batchedData);
            }
        } catch (e) {
            console.warn('Failed to load batched analysis data:', e);
        }

        // Use batched data or fall back to old format
        const lastUpdated = analysisData?.lastUpdated || localStorage.getItem('qdaLastUpdated');
        if (lastUpdated) {
            timestamp.textContent = `Last updated: ${lastUpdated}`;
            resultsDiv.appendChild(timestamp);
        }

        // Create containers
        resultsDiv.innerHTML += `
            <div id="qdaSummaryStatsInline"></div>
            <div id="qdaDemographicBreakdownInline"></div>
            <div id="qdaPersonaBreakdownInline"></div>
            <div id="qdaCombinedResultsInline"></div>
            <div id="qdaPortfolioResultsInline"></div>
            <div id="qdaCreatorResultsInline"></div>
            <div id="qdaCrossAnalysisResultsInline"></div>
        `;

        // Display results using existing functions
        displaySummaryStatsInline(results.summaryStats);
        displayDemographicBreakdownInline(results.summaryStats);
        displayPersonaBreakdownInline(results.summaryStats);

        // Load tipping points from batched data (with fallback to old format)
        const tippingPoints = analysisData?.tippingPoints || JSON.parse(localStorage.getItem('qdaTippingPoints') || 'null');
        displayCombinedAnalysisInline(results.correlationResults, results.regressionResults, null, tippingPoints);

        resultsDiv.style.display = 'block';

        // Save the complete HTML to localStorage for restoration on page reload
        this.saveAnalysisResults(this.outputContainer.innerHTML);
    }



    /**
     * Helper: Get or create MixpanelSync instance
     */
    getMixpanelSync() {
        if (!this.mixpanelSync) {
            this.mixpanelSync = new window.MixpanelSync();
        }
        return this.mixpanelSync;
    }

    // GitHub Actions integration methods removed - Supabase version overrides these

    /**
     * Helper: Read file
     */
    readFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsText(file);
        });
    }

    /**
     * UI Helper: Show status section
     */
    showStatus() {
        document.getElementById('unifiedStatusSection').style.display = 'block';
    }

    /**
     * UI Helper: Clear status messages
     */
    clearStatus() {
        this.statusMessages = [];
        document.getElementById('unifiedStatusSection').innerHTML = '';
    }

    /**
     * UI Helper: Add status message
     */
    addStatusMessage(message, type = 'info') {
        // Only show status section for errors
        if (type === 'error') {
            this.showStatus();
        }

        const statusSection = document.getElementById('unifiedStatusSection');
        const messageDiv = document.createElement('div');
        messageDiv.style.cssText = `
            padding: 8px;
            margin: 5px 0;
            border-radius: 4px;
            font-size: 13px;
            transition: opacity 0.5s ease-out;
            ${type === 'success' ? 'background: #d4edda; color: #155724;' : ''}
            ${type === 'error' ? 'background: #f8d7da; color: #721c24;' : ''}
            ${type === 'info' ? 'background: #d1ecf1; color: #0c5460;' : ''}
        `;
        messageDiv.textContent = message;
        statusSection.appendChild(messageDiv);

        // Auto-scroll to bottom
        statusSection.scrollTop = statusSection.scrollHeight;

        // Auto-hide success messages after 3 seconds
        if (type === 'success') {
            setTimeout(() => {
                messageDiv.style.opacity = '0';
                setTimeout(() => {
                    if (messageDiv.parentNode) {
                        messageDiv.remove();
                    }
                }, 500); // Wait for fade-out animation to complete
            }, 3000);
        }
    }

    /**
     * UI Helper: Show progress bar
     */
    showProgress(percent) {
        const progressSection = document.getElementById('unifiedProgressSection');
        if (progressSection) {
            progressSection.style.display = 'block';
        }
        this.updateProgress(percent);
    }

    /**
     * UI Helper: Update progress
     */
    updateProgress(percent, label = null) {
        const progressBar = document.getElementById('unifiedProgressBar');
        if (progressBar) {
            progressBar.style.width = `${percent}%`;
            // Update text in the inner div (first child)
            const textDiv = progressBar.querySelector('div');
            if (textDiv) {
                textDiv.textContent = label || `${Math.round(percent)}%`;
            } else {
                progressBar.textContent = label || `${Math.round(percent)}%`;
            }
        }
    }
}

// ============================================================================
// DATA MERGER FUNCTIONS (from data_merger.js)
// ============================================================================

/**
 * Matches uploaded files by analyzing their content structure
 */
async function matchFilesByName(files) {
    const requiredFiles = {
        demo: null,
        firstCopy: null,
        fundedAccount: null,
        linkedBank: null
    };

    console.log('Analyzing file structures to identify file types...');

    // Read first few lines of each file to analyze structure
    const fileAnalyses = await Promise.all(files.map(async file => {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const content = e.target.result;
                // Use shared CSV utility for header parsing
                const headers = window.CSVUtils.parseCSVHeaders(content, { maxLines: 1 });

                resolve({
                    file: file,
                    headers: headers,
                    headerString: headers.join('|').toLowerCase(),
                    filename: file.name.toLowerCase()
                });
            };
            reader.readAsText(file);
        });
    }));

    // Smart matching based on file content structure
    fileAnalyses.forEach(analysis => {
        const { file, headers, headerString, filename } = analysis;

        console.log(`Analyzing ${file.name}:`, headers);

        // Demo breakdown file
        if (headerString.includes('income') && headerString.includes('networth') &&
            (headerString.includes('total deposits') || headerString.includes('b. total deposits')) &&
            (headerString.includes('total subscriptions') || headerString.includes('m. total subscriptions') ||
             headerString.includes('d. subscribed within 7 days')) &&
            (headerString.includes('s. creator card taps') || headerString.includes('t. portfolio card taps') ||
             headerString.includes('creator card taps') || headerString.includes('portfolio card taps'))) {
            if (!requiredFiles.demo) {
                requiredFiles.demo = file;
                console.log(`✓ Identified DEMO file: ${file.name}`);
            }
        }

        // Time files
        else if (headerString.includes('funnel') && headerString.includes('distinct id') && headers.length === 3) {
            if ((filename.includes('first') && filename.includes('copy')) || filename.includes('portfolio')) {
                if (!requiredFiles.firstCopy) {
                    requiredFiles.firstCopy = file;
                    console.log(`✓ Identified FIRST COPY time file: ${file.name}`);
                }
            }
            else if (filename.includes('fund') || filename.includes('deposit')) {
                if (!requiredFiles.fundedAccount) {
                    requiredFiles.fundedAccount = file;
                    console.log(`✓ Identified FUNDED ACCOUNT time file: ${file.name}`);
                }
            }
            else if (filename.includes('bank') || filename.includes('link')) {
                if (!requiredFiles.linkedBank) {
                    requiredFiles.linkedBank = file;
                    console.log(`✓ Identified LINKED BANK time file: ${file.name}`);
                }
            }
        }
    });

    const allFilesFound = Object.values(requiredFiles).every(file => file !== null);
    const foundCount = Object.values(requiredFiles).filter(file => file !== null).length;

    return {
        success: allFilesFound,
        foundCount: foundCount,
        files: [
            requiredFiles.demo,
            requiredFiles.firstCopy,
            requiredFiles.fundedAccount,
            requiredFiles.linkedBank
        ]
    };
}

// ============================================================================
// ANALYSIS FUNCTIONS (from analysis_tool.js)
// ============================================================================

// Constants
const ALL_VARIABLES = [
    'hasLinkedBank', 'totalStripeViews', 'paywallViews',
    'regularPDPViews', 'premiumPDPViews',
    'incomeEnum', 'netWorthEnum', 'availableCopyCredits', 'buyingPower',
    'activeCreatedPortfolios', 'lifetimeCreatedPortfolios', 'totalOfUserProfiles',
    'totalDepositCount', 'totalWithdrawals', 'totalWithdrawalCount',
    'uniqueCreatorsViewed', 'uniquePortfoliosViewed', 'uniqueCreatorsInteracted', 'uniquePortfoliosInteracted',
    'totalRegularCopies',
    'regularCreatorProfileViews', 'premiumCreatorProfileViews', 'appSessions',
    'discoverTabViews', 'leaderboardViews', 'premiumTabViews', 'creatorCardTaps', 'portfolioCardTaps',
    'totalProfileViews', 'totalPDPViews'
];

/**
 * Helper: Convert column name to camelCase
 */
function toCamelCase(str) {
    return str
        .replace(/^[A-Z]\.\s*/, '')  // Remove "A. " prefix
        .replace(/\s*\(\$?\)\s*/g, '') // Remove ($) suffix
        .replace(/[^a-zA-Z0-9]+(.)/g, (m, chr) => chr.toUpperCase())
        .replace(/^./, str => str.toLowerCase());
}

/**
 * Helper: Detect new variables that aren't in the known list
 */
function detectNewVariables(cleanData) {
    if (!cleanData || cleanData.length === 0) return [];

    const firstUser = cleanData[0];
    const allFields = Object.keys(firstUser);

    const excludeFields = [
        'totalCopies', 'totalDeposits', 'totalSubscriptions',
        'income', 'netWorth', 'investingExperienceYears', 'investingActivity',
        'investingObjective', 'investmentType', 'distinctId'
    ];

    const newVariables = allFields.filter(field => {
        // Skip if in exclusion list
        if (excludeFields.includes(field)) return false;

        // Skip if not numeric
        if (typeof firstUser[field] !== 'number') return false;

        // Skip if already in known variables
        if (ALL_VARIABLES.includes(field)) return false;

        return true;
    });

    if (newVariables.length > 0) {
        console.log(`📊 Detected ${newVariables.length} new variables:`, newVariables);
    }

    return newVariables;
}

/**
 * Helper: Get all variables (known + new)
 * Cache the result to avoid duplicate detection logs
 */
let cachedNewVariables = null;
function getAllVariables(cleanData) {
    if (cachedNewVariables === null) {
        cachedNewVariables = detectNewVariables(cleanData);
    }
    return [...ALL_VARIABLES, ...cachedNewVariables];
}

/**
 * Helper functions for analysis
 */
// Use shared CSV parsing utility from csv_utils.js
function parseCSV(text) {
    return window.CSVUtils.parseCSV(text);
}

function cleanNumeric(value) {
    if (value === null || value === undefined || value === '' || isNaN(value)) return 0;
    return parseFloat(value) || 0;
}

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

// Note: classifyPersona and calculateSummaryStats removed - these are now handled server-side
// by the analyze-summary-stats edge function. Client-side CSV uploads for main_analysis data
// are no longer supported (manual uploads are only for marketing metrics)

function performQuantitativeAnalysis(jsonData, portfolioData = null, creatorData = null) {
    // Accept JSON directly instead of CSV text to avoid redundant parsing
    const data = jsonData;

    const cleanData = data.map(row => ({
        // Core Conversion Metrics
        totalCopies: cleanNumeric(row['Total Copies'] || row['E. Total Copies']),
        totalDeposits: cleanNumeric(row['Total Deposits'] || row['B. Total Deposits ($)']),
        totalSubscriptions: cleanNumeric(row['Total Subscriptions'] || row['M. Total Subscriptions']),

        // Account & Financial Metrics
        hasLinkedBank: (row['Linked Bank Account'] === true || row['Linked Bank Account'] === 'true' ||
                        row['Linked Bank Account'] === 1 || row['Linked Bank Account'] === '1' ||
                        row['A. Linked Bank Account'] === 1 || row['A. Linked Bank Account'] === '1') ? 1 : 0,
        availableCopyCredits: cleanNumeric(row['Available Copy Credits'] || row['availableCopyCredits']),
        buyingPower: cleanNumeric(row['Buying Power'] || row['buyingPower']),
        totalAchDeposits: cleanNumeric(row['Total ACH Deposits'] || row['total_ach_deposits']),

        // Portfolio Trading Metrics
        activeCreatedPortfolios: cleanNumeric(row['Active Created Portfolios'] || row['activeCreatedPortfolios']),
        lifetimeCreatedPortfolios: cleanNumeric(row['Lifetime Created Portfolios'] || row['lifetimeCreatedPortfolios']),
        activeCopiedPortfolios: cleanNumeric(row['Active Copied Portfolios'] || row['activeCopiedPortfolios']),
        lifetimeCopiedPortfolios: cleanNumeric(row['Lifetime Copied Portfolios'] || row['lifetimeCopiedPortfolios']),

        // Behavioral / Engagement Metrics
        totalRegularCopies: cleanNumeric(row['Total Regular Copies'] || row['F. Total Regular Copies']),
        totalPremiumCopies: cleanNumeric(row['Total Premium Copies'] || row['G. Total Premium Copies']),

        regularPDPViews: cleanNumeric(row['Regular PDP Views'] || row['H. Regular PDP Views']),
        premiumPDPViews: cleanNumeric(row['Premium PDP Views'] || row['I. Premium PDP Views']),
        totalPDPViews: cleanNumeric(row['Total PDP Views']),
        totalProfileViews: cleanNumeric(row['Total Profile Views']),
        paywallViews: cleanNumeric(row['Paywall Views'] || row['J. Paywall Views']),
        totalStripeViews: cleanNumeric(row['Total Stripe Views'] || row['R. Stripe Modal Views']),
        regularCreatorProfileViews: cleanNumeric(row['Regular Creator Profile Views'] || row['K. Regular Creator Profile Views']),
        premiumCreatorProfileViews: cleanNumeric(row['Premium Creator Profile Views'] || row['L. Premium Creator Profile Views']),

        appSessions: cleanNumeric(row['App Sessions'] || row['N. App Sessions']),
        discoverTabViews: cleanNumeric(row['Discover Tab Views'] || row['O. Discover Tab Views']),
        leaderboardViews: cleanNumeric(row['Leaderboard Views'] || row['P. Leaderboard Tab Views']),
        premiumTabViews: cleanNumeric(row['Premium Tab Views'] || row['Q. Premium Tab Views']),
        totalOfUserProfiles: cleanNumeric(row['Total Of User Profiles']),

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
        investmentType: row['Investment Type'] || row['investmentType'] || '',
        acquisitionSurvey: row['Acquisition Survey'] || row['acquisitionSurvey'] || ''
    }));

    // Step 2: Dynamically add any new columns that weren't hardcoded above
    if (data.length > 0) {
        const firstRow = data[0];
        const allColumns = Object.keys(firstRow);

        // List of columns to skip (non-numeric or already mapped)
        const skipColumns = [
            'Distinct ID', '$distinct_id', 'Income', 'income', 'Net Worth', 'netWorth',
            'Investing Experience Years', 'investingExperienceYears',
            'Investing Activity', 'investingActivity',
            'Investing Objective', 'investingObjective',
            'Investment Type', 'investmentType'
        ];

        allColumns.forEach(colName => {
            // Skip if in exclusion list
            if (skipColumns.includes(colName)) return;

            const camelCaseName = toCamelCase(colName);

            // Skip if already mapped by hardcoded logic
            if (cleanData[0].hasOwnProperty(camelCaseName)) return;

            // Add the new column dynamically to all rows
            cleanData.forEach((user, i) => {
                const value = data[i][colName];
                // Only add if numeric or can be converted to numeric
                user[camelCaseName] = cleanNumeric(value);
            });
        });

        const newVarsCount = Object.keys(cleanData[0]).length - 35; // Approximate count of hardcoded fields
        if (newVarsCount > 0) {
            console.log(`✨ Dynamically added ${newVarsCount} new variables from data`);
        }
    }

    const summaryStats = calculateSummaryStats(cleanData);

    // NOTE: Behavioral driver analysis (correlations, regressions, tipping points) is now
    // handled by the analyze-behavioral-drivers Edge Function and stored in database tables:
    // - deposit_drivers, copy_drivers, subscription_drivers
    // The frontend fetches from these tables instead of calculating client-side.

    return {
        summaryStats
    };
}

// Display helper functions
function createMetricCard(title, content, size = null) {
    const card = document.createElement('div');
    card.style.cssText = 'background-color: #f8f9fa; padding: 1rem; border-radius: 8px;';

    const titleEl = document.createElement('div');
    titleEl.style.cssText = 'font-size: 0.875rem; color: #2563eb; font-weight: 600; margin-bottom: 0.5rem;';
    titleEl.textContent = title;
    card.appendChild(titleEl);

    const contentEl = document.createElement('div');
    contentEl.style.cssText = 'font-size: 1.5rem; font-weight: bold;';
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
        'totalAchDeposits': 'Total ACH Deposits',
        'totalDepositCount': 'Total Deposit Count',
        'totalWithdrawals': 'Total Withdrawals',
        'totalWithdrawalCount': 'Total Withdrawal Count',
        'uniqueCreatorsViewed': 'Unique Creator Views',
        'uniquePortfoliosViewed': 'Unique Portfolio Views',
        'didCopy': 'Did Copy',
        'didSubscribe': 'Did Subscribe',
        'activeCreatedPortfolios': 'Active Created Portfolios',
        'lifetimeCreatedPortfolios': 'Lifetime Created Portfolios',
        'activeCopiedPortfolios': 'Active Copied Portfolios',
        'lifetimeCopiedPortfolios': 'Lifetime Copied Portfolios',
        'totalCopyStarts': 'Total Copy Starts',
        'totalRegularCopies': 'Total Regular Copies',
        'regularPDPViews': 'Regular PDP Views',
        'premiumPDPViews': 'Premium PDP Views',
        'totalPDPViews': 'Total PDP Views',
        'totalProfileViews': 'Total Profile Views',
        'paywallViews': 'Paywall Views',
        'totalStripeViews': 'Total Stripe Views',
        'regularCreatorProfileViews': 'Regular Creator Profile Views',
        'premiumCreatorProfileViews': 'Premium Creator Profile Views',
        'appSessions': 'App Sessions',
        'discoverTabViews': 'Discover Tab Views',
        'leaderboardViews': 'Leaderboard Views',
        'premiumTabViews': 'Premium Tab Views',
        'totalOfUserProfiles': 'Total User Profiles',
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

// Note: calculatePredictiveStrength moved to analysis_utils.js for shared use
// Function is available via window.calculatePredictiveStrength

function displaySummaryStatsInline(stats) {
    const container = document.getElementById('qdaSummaryStatsInline');
    container.textContent = '';

    const resultSection = document.createElement('div');
    resultSection.className = 'qda-result-section';

    // Wrapper for H1
    const headerWrapper = document.createElement('div');
    headerWrapper.style.cssText = 'margin-bottom: 0.25rem;';

    const title = document.createElement('h1');
    title.style.cssText = 'margin: 0;';
    title.innerHTML = `<span class="info-tooltip">Summary Statistics<span class="info-icon">i</span>
        <span class="tooltip-text">
            <strong>Summary Statistics</strong>
            High-level conversion metrics and user behavior across the entire platform.
            <ul>
                <li><strong>Data Source:</strong> <a href="https://mixpanel.com/project/2599235/view/3138115/app/boards#id=10576025&editor-card-id=%22report-85713544%22" target="_blank" style="color: #17a2b8;">Chart 85713544</a></li>
                <li><strong>Metrics:</strong> User demographics, deposits, copies, subscriptions, engagement</li>
                <li><strong>Updated:</strong> Real-time sync from Mixpanel</li>
            </ul>
        </span>
    </span>`;

    headerWrapper.appendChild(title);
    resultSection.appendChild(headerWrapper);

    const metricSummary = document.createElement('div');
    metricSummary.className = 'qda-metric-summary';

    const metrics = [
        ['Total Users', stats.totalUsers?.toLocaleString() || '0', '18px'],
        ['Link Bank Rate', stats.linkBankConversion != null ? `${stats.linkBankConversion.toFixed(1)}%` : 'N/A', '18px'],
        ['Deposit Rate', stats.depositConversion != null ? `${stats.depositConversion.toFixed(1)}%` : 'N/A', '18px'],
        ['Copy Rate', stats.firstCopyConversion != null ? `${stats.firstCopyConversion.toFixed(1)}%` : 'N/A', '18px']
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
    resultSection.style.marginTop = '2rem';

    const title = document.createElement('h2');
    title.style.marginTop = '1.5rem';
    title.style.marginBottom = '0.25rem';
    title.textContent = 'Demographic Breakdown';
    resultSection.appendChild(title);

    // Metric cards grid: 4 cards showing key demographic percentages
    const metricsGrid = document.createElement('div');
    metricsGrid.style.cssText = 'display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-top: 1rem; margin-bottom: 1.5rem;';

    // Calculate metric percentages
    const incomeBreakdown = stats.incomeBreakdown || {};
    const netWorthBreakdown = stats.netWorthBreakdown || {};
    const experienceBreakdown = stats.investingExperienceYearsBreakdown || {};

    // Use same denominators as tables (users who responded to each survey question)
    const incomeTotalResponses = stats.incomeTotalResponses || 0;
    const netWorthTotalResponses = stats.netWorthTotalResponses || 0;
    const experienceTotalResponses = stats.investingExperienceYearsTotalResponses || 0;
    const usersWithDepositData = stats.usersWithDepositData || 0;

    // 1. <$100k Income: <25k, 25k–50k, 50k–100k (DB format: en-dash, no $, no spaces)
    const lowIncomeCount = (incomeBreakdown['<25k'] || 0) +
                          (incomeBreakdown['25k–50k'] || 0) +
                          (incomeBreakdown['50k–100k'] || 0);
    const lowIncomePercent = incomeTotalResponses > 0 ? ((lowIncomeCount / incomeTotalResponses) * 100).toFixed(1) : '0.0';

    // 2. <$100k Net Worth (DB format: <100k - no $, no space)
    const lowNetWorthCount = netWorthBreakdown['<100k'] || 0;
    const lowNetWorthPercent = netWorthTotalResponses > 0 ? ((lowNetWorthCount / netWorthTotalResponses) * 100).toFixed(1) : '0.0';

    // 3. <1 Years Investing: "0" or "<1" (DB format: no space after <)
    const newInvestorCount = (experienceBreakdown['0'] || 0) + (experienceBreakdown['<1'] || 0);
    const newInvestorPercent = experienceTotalResponses > 0 ? ((newInvestorCount / experienceTotalResponses) * 100).toFixed(1) : '0.0';

    // 4. <$1k Total Deposits: use users with non-null deposit data as denominator
    const lowDepositsCount = stats.usersWithLowDeposits || 0;
    const lowDepositsPercent = usersWithDepositData > 0 ? ((lowDepositsCount / usersWithDepositData) * 100).toFixed(1) : '0.0';

    // Create metric cards
    metricsGrid.appendChild(createMetricCard('<$100k Income', `${lowIncomePercent}%`));
    metricsGrid.appendChild(createMetricCard('<$100k Net Worth', `${lowNetWorthPercent}%`));
    metricsGrid.appendChild(createMetricCard('<1 Years Investing', `${newInvestorPercent}%`));
    metricsGrid.appendChild(createMetricCard('<$1k Total Deposits', `${lowDepositsPercent}%`));

    resultSection.appendChild(metricsGrid);

    // First row: 4-column grid for first 4 tables
    const grid1 = document.createElement('div');
    grid1.style.cssText = 'display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin-bottom: 20px;';

    // Second row: 3-column grid for last 3 tables
    const grid2 = document.createElement('div');
    grid2.style.cssText = 'display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px;';

    const createBreakdownTable = (titleText, data, totalResponses, isAcquisitionSurvey = false, targetGrid = grid1) => {
        const tableContainer = document.createElement('div');

        const table = document.createElement('table');
        table.className = 'qda-regression-table';
        table.style.fontSize = '12px';
        table.style.width = '100%';

        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        [titleText, 'Percentage'].forEach(header => {
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

        // Special handling for Acquisition Survey: aggregate all "Other" responses
        if (isAcquisitionSurvey) {
            const otherItems = dataArray.filter(item =>
                item.category.toLowerCase().includes('other')
            );
            const nonOtherItems = dataArray.filter(item =>
                !item.category.toLowerCase().includes('other')
            );

            if (otherItems.length > 0) {
                // Calculate total count and percentage for all "Other" items
                const totalOtherCount = otherItems.reduce((sum, item) => sum + item.count, 0);
                const totalOtherPercentage = totalResponses > 0 ? (totalOtherCount / totalResponses) * 100 : 0;

                // Get top 5 "Other" responses by count
                const sortedOtherItems = [...otherItems].sort((a, b) => b.count - a.count);
                const top5Other = sortedOtherItems.slice(0, 5).map(item => {
                    // Extract the actual response text after "Other - "
                    const match = item.category.match(/Other\s*-\s*(.+)/i);
                    return match ? match[1].trim() : item.category;
                });

                // Create aggregated "Other" row
                const aggregatedOther = {
                    category: `Other - ${top5Other.join(', ')}`,
                    count: totalOtherCount,
                    percentage: totalOtherPercentage
                };

                // Combine non-Other items with aggregated Other
                dataArray = [...nonOtherItems, aggregatedOther];
            }

            // Filter out items with less than 0.1% for Acquisition Survey
            dataArray = dataArray.filter(item => item.percentage >= 0.1);
        }

        dataArray.sort((a, b) => b.percentage - a.percentage);

        // Use DocumentFragment to batch DOM insertions
        const fragment = document.createDocumentFragment();
        dataArray.forEach(item => {
            const percentageFormatted = item.percentage.toFixed(1) + '%';
            fragment.appendChild(createTableRow([item.category, percentageFormatted]));
        });
        tbody.appendChild(fragment);

        table.appendChild(tbody);

        // Wrap table in scrollable container for mobile
        const tableWrapper = document.createElement('div');
        tableWrapper.className = 'table-wrapper';
        tableWrapper.appendChild(table);

        tableContainer.appendChild(tableWrapper);
        targetGrid.appendChild(tableContainer);
    };

    // First 4 tables go in grid1 (4-column layout)
    const row1Configs = [
        { key: 'income', title: 'Income' },
        { key: 'netWorth', title: 'Net Worth' },
        { key: 'investingExperienceYears', title: 'Investing Experience Years' },
        { key: 'investingActivity', title: 'Investing Activity' }
    ];

    // Last 3 tables go in grid2 (3-column layout)
    const row2Configs = [
        { key: 'investmentType', title: 'Investment Type' },
        { key: 'investingObjective', title: 'Investing Objective' },
        { key: 'acquisitionSurvey', title: 'Acquisition Survey' }
    ];

    row1Configs.forEach(config => {
        createBreakdownTable(
            config.title,
            stats[config.key + 'Breakdown'],
            stats[config.key + 'TotalResponses'],
            false, // Not Acquisition Survey
            grid1  // First row grid
        );
    });

    row2Configs.forEach(config => {
        createBreakdownTable(
            config.title,
            stats[config.key + 'Breakdown'],
            stats[config.key + 'TotalResponses'],
            config.key === 'acquisitionSurvey', // True only for Acquisition Survey
            grid2  // Second row grid
        );
    });

    resultSection.appendChild(grid1);
    resultSection.appendChild(grid2);
    container.appendChild(resultSection);
}

function displayPersonaBreakdownInline(stats) {
    const container = document.getElementById('qdaPersonaBreakdownInline');
    container.textContent = '';

    const resultSection = document.createElement('div');
    resultSection.className = 'qda-result-section';
    resultSection.style.marginTop = '2rem';

    const title = document.createElement('h2');
    title.style.cssText = 'margin-top: 0; margin-bottom: 0.5rem;';
    title.innerHTML = `<span class="info-tooltip">Persona Breakdown<span class="info-icon">i</span>
        <span class="tooltip-text">
            <strong>Persona Breakdown</strong>
            User segmentation based on engagement and subscription status.
            <ul>
                <li><strong>Premium:</strong> Users with ≥1 active subscription</li>
                <li><strong>Core:</strong> Users with 0 subscriptions and ≥1 portfolio copy</li>
                <li><strong>Activation Targets:</strong> Users with 0 subscriptions, 0 copies, $0 deposits, but ≥3 profile views OR ≥3 PDP views</li>
                <li><strong>Non-activated:</strong> Users with no bank linked, $0 deposits, and <3 profile views AND <3 PDP views</li>
            </ul>
        </span>
    </span>`;
    resultSection.appendChild(title);

    const grid = document.createElement('div');
    grid.style.cssText = 'display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin-top: 1.5rem;';

    const personas = [
        {
            name: 'Premium',
            subtitle: 'Users with ≥1 active subscription',
            data: stats.personaStats.premium,
            priority: 1
        },
        {
            name: 'Core',
            subtitle: '0 subscriptions and ≥1 portfolio copy',
            data: stats.personaStats.core,
            priority: 2
        },
        {
            name: 'Activation Targets',
            subtitle: '0 subs, 0 copies, $0 deposits, ≥3 views',
            data: stats.personaStats.activationTargets,
            priority: 3
        },
        {
            name: 'Non-activated',
            subtitle: 'No bank linked, $0 deposits, <3 views',
            data: stats.personaStats.nonActivated,
            priority: 4
        }
    ];

    personas.forEach(p => {
        const card = document.createElement('div');
        card.style.cssText = 'background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 8px; padding: 15px;';

        const nameEl = document.createElement('div');
        nameEl.style.cssText = 'font-weight: bold; color: #007bff; margin-bottom: 5px; font-size: 16px;';
        nameEl.textContent = p.name;
        card.appendChild(nameEl);

        const subtitleEl = document.createElement('div');
        subtitleEl.style.cssText = 'font-size: 12px; color: #6c757d; margin-bottom: 10px;';
        subtitleEl.textContent = p.subtitle;
        card.appendChild(subtitleEl);

        const percentageEl = document.createElement('div');
        percentageEl.style.cssText = 'font-size: 24px; font-weight: bold; color: #28a745; margin-bottom: 5px; text-align: left;';
        percentageEl.textContent = `${p.data.percentage.toFixed(1)}%`;
        card.appendChild(percentageEl);

        const countEl = document.createElement('div');
        countEl.style.cssText = 'font-size: 13px; color: #333; text-align: left;';
        countEl.textContent = `(N=${p.data.count.toLocaleString()})`;
        card.appendChild(countEl);

        grid.appendChild(card);
    });

    resultSection.appendChild(grid);
    container.appendChild(resultSection);
}

function displayCombinedAnalysisInline(correlationResults, regressionResults, cleanData, tippingPoints) {
    const container = document.getElementById('qdaCombinedResultsInline');
    container.textContent = '';

    const resultSection = document.createElement('div');
    resultSection.className = 'qda-result-section';

    const title = document.createElement('h1');
    title.textContent = '📊 Behavioral Analysis';
    resultSection.appendChild(title);

    const orderedOutcomes = [
        { outcome: 'totalDeposits', label: 'Deposit Funds' },
        { outcome: 'totalCopies', label: 'Portfolio Copies' },
        { outcome: 'totalSubscriptions', label: 'Subscriptions' }
    ];

    orderedOutcomes.forEach((config) => {
        const outcome = config.outcome;
        const outcomeLabel = config.label;

        const outcomeTitle = document.createElement('h2');
        outcomeTitle.textContent = outcomeLabel;
        resultSection.appendChild(outcomeTitle);

        const allVariables = Object.keys(correlationResults[outcome]);
        const regressionData = regressionResults[outcome.replace('total', '').toLowerCase()];

        // Note: Variable filtering now handled by Edge Function via INCLUSIONS
        const filteredVariables = allVariables;

        const combinedData = filteredVariables.map(variable => {
            const correlation = correlationResults[outcome][variable];
            const regressionItem = regressionData.find(item => item.variable === variable);

            let tippingPoint = 'N/A';
            if (tippingPoints && tippingPoints[outcome] && tippingPoints[outcome][variable]) {
                tippingPoint = tippingPoints[outcome][variable];
            } else if (cleanData) {
                tippingPoint = calculateTippingPoint(cleanData, variable, outcome);
            }

            return {
                variable: variable,
                correlation: correlation,
                tStat: regressionItem ? regressionItem.tStat : 0,
                tippingPoint: tippingPoint
            };
        }).sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));

        // Calculate predictive strength using combined correlation + T-stat method
        combinedData.forEach(item => {
            const result = window.calculatePredictiveStrength(item.correlation, item.tStat);
            item.predictiveStrength = result.strength;
            item.predictiveClass = result.className;
        });

        const table = document.createElement('table');
        table.className = 'qda-regression-table';

        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        const headers = [
            { text: 'Variable', tooltip: null },
            { text: 'Correlation', tooltip: null },
            { text: 'T-Statistic', tooltip: null },
            {
                text: 'Predictive Strength',
                tooltip: `<strong>Predictive Strength</strong>
                    Combines statistical significance and effect size using a two-stage approach:
                    <ul>
                        <li><strong>Stage 1:</strong> T-statistic ≥1.96 (95% confidence)</li>
                        <li><strong>Stage 2:</strong> Weighted score = Correlation (90%) + T-stat (10%)</li>
                        <li><strong>Ranges:</strong> Very Strong (≥5.5), Strong (≥4.5), Moderate-Strong (≥3.5), Moderate (≥2.5), Weak-Moderate (≥1.5), Weak (≥0.5)</li>
                    </ul>
                    Higher scores indicate stronger and more reliable predictive relationships.`
            },
            {
                text: 'Tipping Point',
                tooltip: `<strong>Tipping Point</strong>
                    The "magic number" threshold where user behavior changes significantly:
                    <ul>
                        <li>Identifies the value where the largest jump in conversion rate occurs</li>
                        <li>Only considers groups with 10+ users and >10% conversion rate</li>
                        <li>Represents the minimum exposure needed for behavioral change</li>
                    </ul>
                    Example: If tipping point is 5, users who view 5+ items convert at much higher rates.`
            }
        ];

        headers.forEach(headerData => {
            const th = document.createElement('th');
            if (headerData.tooltip) {
                th.innerHTML = `${headerData.text}<span class="info-tooltip"><span class="info-icon">i</span><span class="tooltip-text">${headerData.tooltip}</span></span>`;
            } else {
                th.textContent = headerData.text;
            }
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');

        // Use DocumentFragment to batch DOM insertions
        const fragment = document.createDocumentFragment();
        combinedData.slice(0, 10).forEach(item => {
            const rowData = [
                getVariableLabel(item.variable),
                item.correlation.toFixed(2),
                item.tStat.toFixed(2),
                { text: item.predictiveStrength, className: item.predictiveClass, html: true },
                item.tippingPoint !== 'N/A' ?
                    (typeof item.tippingPoint === 'number' ? item.tippingPoint.toFixed(1) : item.tippingPoint) :
                    'N/A'
            ];
            fragment.appendChild(createTableRow(rowData));
        });
        tbody.appendChild(fragment);
        table.appendChild(tbody);

        // Wrap table in scrollable container for mobile
        const tableWrapper = document.createElement('div');
        tableWrapper.className = 'table-wrapper';
        tableWrapper.appendChild(table);

        resultSection.appendChild(tableWrapper);
    });

    container.appendChild(resultSection);
}

// ============================================================================
// EXPORTS
// ============================================================================

// Export to window
window.UserAnalysisTool = UserAnalysisTool;

console.log('✅ User Analysis Tool loaded successfully!');