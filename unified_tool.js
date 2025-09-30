// Unified Analysis Tool - Complete End-to-End Workflow
'use strict';

/**
 * This unified tool combines:
 * 1. Data fetching from Mixpanel (GitHub Actions workflow or direct API)
 * 2. Data merging (processing 7 CSV files into 3 outputs)
 * 3. Analysis execution (statistical analysis and visualization)
 */

class UnifiedAnalysisTool {
    constructor() {
        this.mixpanelSync = new window.MixpanelSync();
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

        const wrapper = document.createElement('div');
        wrapper.className = 'qda-inline-widget';
        wrapper.style.maxWidth = '800px';
        wrapper.style.margin = '0 auto';

        // Content (no header)
        const content = document.createElement('div');
        content.className = 'qda-content';

        // Mode Selection
        const modeSection = this.createModeSection();
        content.appendChild(modeSection);

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
            'Trigger GitHub Actions to fetch latest data from Mixpanel',
            '#28a745',
            () => this.runWorkflow('github')
        );
        buttonContainer.appendChild(githubBtn);

        // Option 2: Upload CSV files
        const uploadBtn = this.createModeButton(
            'Manually Upload Data',
            'Upload your own 7 CSV files for analysis',
            '#17a2b8',
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
                    Select All 7 CSV Files
                </label>
                <input type="file" id="unifiedFileInput" accept=".csv" multiple style="padding: 8px; border: 1px solid #ddd; border-radius: 4px; width: 100%;">
            </div>
        `;
        section.appendChild(uploadSection);

        return section;
    }

    /**
     * Creates a styled mode selection button
     */
    createModeButton(title, description, color, onClick) {
        const button = document.createElement('div');
        button.style.cssText = `
            flex: 1;
            min-width: 200px;
            padding: 20px;
            background: white;
            border: 2px solid ${color};
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.3s;
            text-align: center;
        `;

        button.innerHTML = `
            <div style="font-weight: bold; color: ${color}; font-size: 16px; margin-bottom: 8px;">
                ${title}
            </div>
            <div style="font-size: 12px; color: #6c757d;">
                ${description}
            </div>
        `;

        button.onmouseover = () => {
            button.style.background = color;
            button.querySelector('div:first-child').style.color = 'white';
            button.querySelector('div:last-child').style.color = 'white';
        };

        button.onmouseout = () => {
            button.style.background = 'white';
            button.querySelector('div:first-child').style.color = color;
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
        this.showStatus();
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
     * Runs the GitHub Actions workflow
     */
    async runGitHubWorkflow() {
        // Step 1: Trigger GitHub Actions
        this.addStatusMessage('🚀 Triggering GitHub Actions workflow...', 'info');
        this.updateProgress(10, 'Triggering workflow...');

        const triggered = await this.triggerGitHubWorkflow();
        if (!triggered) {
            throw new Error('Failed to trigger GitHub workflow');
        }

        this.addStatusMessage('✅ Workflow triggered successfully', 'success');
        this.updateProgress(20, 'Workflow started...');

        // Step 2: Wait for workflow completion
        this.addStatusMessage('⏳ Waiting for workflow to complete (checking every 5s)...', 'info');
        const workflowSuccess = await this.waitForWorkflowCompletion();

        if (!workflowSuccess) {
            throw new Error('Workflow failed or timed out');
        }

        this.addStatusMessage('✅ Data fetch completed', 'success');
        this.updateProgress(40, 'Loading data...');

        // Step 3: Load data from GitHub
        this.addStatusMessage('📥 Loading data files from GitHub...', 'info');
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for GitHub to update

        const contents = await this.loadGitHubData();
        this.addStatusMessage('✅ Data files loaded', 'success');
        this.updateProgress(60, 'Merging data...');

        // Step 4: Process and merge data
        await this.processAndAnalyze(contents);
    }

    /**
     * Runs the upload workflow
     */
    async runUploadWorkflow() {
        // Show file upload section
        const uploadSection = document.getElementById('unifiedUploadSection');
        uploadSection.style.display = 'block';

        this.addStatusMessage('📁 Please select your 7 CSV files and click here when ready', 'info');

        // Wait for user to select files
        const fileInput = document.getElementById('unifiedFileInput');

        // Create a promise that resolves when files are selected
        await new Promise((resolve, reject) => {
            const checkInterval = setInterval(() => {
                if (fileInput.files && fileInput.files.length === 7) {
                    clearInterval(checkInterval);
                    resolve();
                }
            }, 500);

            // Add timeout
            setTimeout(() => {
                clearInterval(checkInterval);
                reject(new Error('File selection timeout'));
            }, 300000); // 5 minutes
        });

        this.updateProgress(20, 'Files selected...');
        this.addStatusMessage('✅ Files selected', 'success');

        // Read files
        this.addStatusMessage('📖 Reading CSV files...', 'info');
        const files = Array.from(fileInput.files);

        // Match files by content
        const matchedFiles = await this.matchFilesByName(files);
        if (!matchedFiles.success) {
            throw new Error(`Could not identify all file types. Found ${matchedFiles.foundCount}/7 files.`);
        }

        this.updateProgress(40, 'Reading files...');
        this.addStatusMessage('✅ Files identified', 'success');

        // Read file contents
        const contents = await Promise.all(matchedFiles.files.map(file => this.readFile(file)));

        this.updateProgress(60, 'Merging data...');
        this.addStatusMessage('✅ Files read successfully', 'success');

        // Process and analyze
        await this.processAndAnalyze(contents);
    }

    /**
     * Processes data and runs analysis
     */
    async processAndAnalyze(contents) {
        // Step 1: Merge data
        this.addStatusMessage('🔄 Merging data files...', 'info');

        const mergedData = processComprehensiveData(contents);

        this.updateProgress(70, 'Data merged...');
        this.addStatusMessage('✅ Data merged successfully', 'success');
        this.addStatusMessage(`   - Main file: ${mergedData.mainFile.length} records`, 'info');

        // Step 2: Skip download creation for unified workflow
        // (Files are already saved to GitHub by the workflow)

        this.updateProgress(80, 'Running analysis...');

        // Step 3: Run analysis on main file
        this.addStatusMessage('📊 Running statistical analysis...', 'info');

        const mainCSV = this.convertToCSV(mergedData.mainFile);
        const results = performQuantitativeAnalysis(mainCSV, null, null);

        this.updateProgress(85, 'Calculating tipping points...');
        this.addStatusMessage('📈 Calculating tipping points...', 'info');

        // Step 3.5: Calculate tipping points for all variables and outcomes
        const tippingPoints = this.calculateAllTippingPoints(results.cleanData, results.correlationResults);
        this.addStatusMessage('✅ Tipping points calculated', 'success');

        this.updateProgress(90, 'Displaying results...');
        this.addStatusMessage('✅ Analysis complete', 'success');

        // Step 4: Save results to localStorage (skip cleanData - it's too large)
        localStorage.setItem('qdaSummaryStats', JSON.stringify(results.summaryStats));
        localStorage.setItem('qdaCorrelationResults', JSON.stringify(results.correlationResults));
        localStorage.setItem('qdaRegressionResults', JSON.stringify(results.regressionResults));
        localStorage.setItem('qdaTippingPoints', JSON.stringify(tippingPoints));
        // Note: Not storing cleanData to avoid quota issues

        const now = new Date();
        const timestamp = now.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
        localStorage.setItem('qdaLastUpdated', timestamp);

        // Step 5: Display results
        this.addStatusMessage('📈 Displaying results...', 'info');
        this.displayResults(results);

        this.updateProgress(100, 'Complete!');
        this.addStatusMessage('✅ Workflow completed successfully!', 'success');

        // Hide status after a delay
        setTimeout(() => {
            document.getElementById('unifiedStatusSection').style.display = 'none';
            document.getElementById('unifiedProgressSection').style.display = 'none';
        }, 5000);
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
        const lastUpdated = localStorage.getItem('qdaLastUpdated');
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

        // Load tipping points from localStorage
        const tippingPoints = JSON.parse(localStorage.getItem('qdaTippingPoints'));
        displayCombinedAnalysisInline(results.correlationResults, results.regressionResults, null, tippingPoints);

        resultsDiv.style.display = 'block';
    }

    /**
     * Calculate tipping points for all variables and outcomes
     */
    calculateAllTippingPoints(cleanData, correlationResults) {
        const tippingPoints = {};

        ['totalCopies', 'totalDeposits', 'totalSubscriptions'].forEach(outcome => {
            tippingPoints[outcome] = {};

            const variables = Object.keys(correlationResults[outcome]);
            variables.forEach(variable => {
                if (variable !== outcome) {
                    tippingPoints[outcome][variable] = calculateTippingPoint(cleanData, variable, outcome);
                }
            });
        });

        return tippingPoints;
    }

    /**
     * Helper: Convert JSON to CSV
     */
    convertToCSV(data) {
        if (!data || data.length === 0) return '';

        const headers = Object.keys(data[0]);
        const rows = [headers.join(',')];

        data.forEach(row => {
            const values = headers.map(header => {
                const value = row[header];
                if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
                    return `"${value.replace(/"/g, '""')}"`;
                }
                return value ?? '';
            });
            rows.push(values.join(','));
        });

        return rows.join('\n');
    }

    /**
     * Helper: Trigger GitHub workflow
     */
    async triggerGitHubWorkflow() {
        let githubToken = localStorage.getItem('github_pat');

        if (!githubToken) {
            githubToken = prompt('Enter your GitHub Personal Access Token (with "workflow" scope):');
            if (!githubToken) {
                throw new Error('GitHub token is required');
            }

            if (confirm('Save this token for future use?')) {
                localStorage.setItem('github_pat', githubToken);
            }
        }

        const owner = 'zackbabin';
        const repo = 'dub_analysis_tool';
        const workflow_id = 'mixpanel-sync.yml';

        const response = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow_id}/dispatches`,
            {
                method: 'POST',
                headers: {
                    'Accept': 'application/vnd.github+json',
                    'Authorization': `Bearer ${githubToken}`,
                    'X-GitHub-Api-Version': '2022-11-28'
                },
                body: JSON.stringify({ ref: 'main' })
            }
        );

        if (response.status === 204) {
            return true;
        } else if (response.status === 401) {
            localStorage.removeItem('github_pat');
            throw new Error('Invalid GitHub token');
        } else {
            const error = await response.text();
            throw new Error(`Failed to trigger workflow: ${error}`);
        }
    }

    /**
     * Helper: Wait for workflow completion
     */
    async waitForWorkflowCompletion() {
        const githubToken = localStorage.getItem('github_pat');
        if (!githubToken) return false;

        const owner = 'zackbabin';
        const repo = 'dub_analysis_tool';

        let attempts = 0;
        const maxAttempts = 180; // 15 minutes (5 seconds * 180 = 900 seconds)

        while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 5000));
            attempts++;

            const response = await fetch(
                `https://api.github.com/repos/${owner}/${repo}/actions/runs?per_page=1`,
                {
                    headers: {
                        'Accept': 'application/vnd.github+json',
                        'Authorization': `Bearer ${githubToken}`,
                        'X-GitHub-Api-Version': '2022-11-28'
                    }
                }
            );

            if (response.ok) {
                const data = await response.json();
                if (data.workflow_runs && data.workflow_runs.length > 0) {
                    const latestRun = data.workflow_runs[0];

                    this.updateProgress(20 + (attempts * 0.5), `Workflow ${latestRun.status}...`);

                    if (latestRun.status === 'completed') {
                        if (latestRun.conclusion === 'success') {
                            return true;
                        } else {
                            throw new Error(`Workflow failed: ${latestRun.html_url}`);
                        }
                    }
                }
            }
        }

        throw new Error('Workflow timeout');
    }

    /**
     * Helper: Load data from GitHub
     */
    async loadGitHubData() {
        const baseUrl = 'https://raw.githubusercontent.com/zackbabin/dub_analysis_tool/main/data/';

        const fileUrls = [
            baseUrl + '1_subscribers_insights.csv',
            baseUrl + '2_time_to_first_copy.csv',
            baseUrl + '3_time_to_funded_account.csv',
            baseUrl + '4_time_to_linked_bank.csv',
            baseUrl + '5_premium_subscriptions.csv',
            baseUrl + '6_creator_copy_funnel.csv',
            baseUrl + '7_portfolio_copy_funnel.csv'
        ];

        const contents = await Promise.all(
            fileUrls.map(async (url) => {
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`Failed to fetch ${url}`);
                }
                return await response.text();
            })
        );

        return contents;
    }

    /**
     * Helper: Match files by content
     */
    async matchFilesByName(files) {
        return await matchFilesByName(files);
    }

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
        const statusSection = document.getElementById('unifiedStatusSection');
        const messageDiv = document.createElement('div');
        messageDiv.style.cssText = `
            padding: 8px;
            margin: 5px 0;
            border-radius: 4px;
            font-size: 13px;
            ${type === 'success' ? 'background: #d4edda; color: #155724;' : ''}
            ${type === 'error' ? 'background: #f8d7da; color: #721c24;' : ''}
            ${type === 'info' ? 'background: #d1ecf1; color: #0c5460;' : ''}
        `;
        messageDiv.textContent = message;
        statusSection.appendChild(messageDiv);

        // Auto-scroll to bottom
        statusSection.scrollTop = statusSection.scrollHeight;
    }

    /**
     * UI Helper: Show progress bar
     */
    showProgress(percent) {
        document.getElementById('unifiedProgressSection').style.display = 'block';
        this.updateProgress(percent);
    }

    /**
     * UI Helper: Update progress
     */
    updateProgress(percent, label = null) {
        const progressBar = document.getElementById('unifiedProgressBar');
        progressBar.style.width = `${percent}%`;
        progressBar.textContent = label || `${Math.round(percent)}%`;
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
        linkedBank: null,
        premiumSub: null,
        creatorCopy: null,
        portfolioCopy: null
    };

    console.log('Analyzing file structures to identify file types...');

    // Read first few lines of each file to analyze structure
    const fileAnalyses = await Promise.all(files.map(async file => {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const content = e.target.result;
                const lines = content.split('\n').slice(0, 3);
                const headers = lines[0] ? lines[0].split(',').map(h => h.trim().replace(/"/g, '')) : [];

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

        // Premium subscription
        else if (headerString.includes('creatorusername') &&
                 headerString.includes('viewed creator paywall') &&
                 headerString.includes('viewed stripe modal')) {
            if (!requiredFiles.premiumSub) {
                requiredFiles.premiumSub = file;
                console.log(`✓ Identified PREMIUM SUBSCRIPTION file: ${file.name}`);
            }
        }

        // Creator copy
        else if (headerString.includes('creatorusername') &&
                 headerString.includes('viewed portfolio details') &&
                 !headerString.includes('portfolioticker')) {
            if (!requiredFiles.creatorCopy) {
                requiredFiles.creatorCopy = file;
                console.log(`✓ Identified CREATOR COPY file: ${file.name}`);
            }
        }

        // Portfolio copy
        else if (headerString.includes('portfolioticker') &&
                 headerString.includes('viewed portfolio details')) {
            if (!requiredFiles.portfolioCopy) {
                requiredFiles.portfolioCopy = file;
                console.log(`✓ Identified PORTFOLIO COPY file: ${file.name}`);
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
            requiredFiles.linkedBank,
            requiredFiles.premiumSub,
            requiredFiles.creatorCopy,
            requiredFiles.portfolioCopy
        ]
    };
}

/**
 * Processes and merges comprehensive data from 7 CSV files
 */
function processComprehensiveData(contents) {
    // Helper function to find column value with flexible matching
    function getColumnValue(row, ...possibleNames) {
        for (const name of possibleNames) {
            if (row[name] !== undefined && row[name] !== null) {
                return row[name];
            }
        }
        return '';
    }

    // Helper function to clean column names
    function cleanColumnName(name) {
        return name
            .replace(/^[A-Z]\.\s*/, '')
            .replace(/\s*\(\$?\)\s*/, '')
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
            .replace(/\b\w/g, l => l.toUpperCase())
            .replace(/\bI D\b/g, 'ID');
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
        const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
        const data = lines.slice(1).map(line => {
            const values = line.split(',');
            const row = {};
            headers.forEach((h, i) => row[h] = values[i] ? values[i].trim().replace(/"/g, '') : '');
            return row;
        });
        return { headers, data };
    }

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

    // Normalize distinct_id keys
    function normalizeId(row) {
        return row['Distinct ID'] || row['$distinct_id'];
    }

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

    // Helper function for time conversion
    function secondsToDays(seconds) {
        if (!seconds || isNaN(seconds)) return '';
        return Math.round((seconds / 86400) * 100) / 100;
    }

    // Create main analysis file
    const mainAnalysisData = demoData.data.map(row => {
        const id = normalizeId(row);
        const clean = {};

        // Clean original columns with normalized names
        Object.keys(row).forEach(k => {
            const cleanedName = cleanColumnName(k);
            clean[cleanedName] = cleanValue(row[k]);
        });

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

    // Create creator detail file
    const creatorDetailMap = {};

    premiumSubData.data.forEach(row => {
        const id = normalizeId(row);
        const creator = row['creatorUsername'];
        if (!id || !creator) return;

        const key = `${id}_${creator}`;
        creatorDetailMap[key] = {
            distinct_id: id,
            creatorUsername: creator,
            paywall_views: parseInt(row['(1) Viewed Creator Paywall'] || 0),
            stripe_views: parseInt(row['(2) Viewed Stripe Modal'] || 0),
            subscriptions: parseInt(row['(3) Subscribed to Creator'] || 0),
            portfolio_views: 0,
            copy_starts: 0,
            copies: 0
        };
    });

    creatorCopyData.data.forEach(row => {
        const id = normalizeId(row);
        const creator = row['creatorUsername'];
        if (!id || !creator) return;

        const key = `${id}_${creator}`;
        if (!creatorDetailMap[key]) {
            creatorDetailMap[key] = {
                distinct_id: id,
                creatorUsername: creator,
                paywall_views: 0,
                stripe_views: 0,
                subscriptions: 0,
                portfolio_views: 0,
                copy_starts: 0,
                copies: 0
            };
        }

        creatorDetailMap[key].portfolio_views += parseInt(row['(1) Viewed Portfolio Details'] || 0);
        creatorDetailMap[key].copy_starts += parseInt(row['(2) Started Copy Portfolio'] || 0);
        creatorDetailMap[key].copies += parseInt(row['(3) Copied Portfolio'] || 0);
    });

    const creatorDetailData = Object.values(creatorDetailMap);

    // Create portfolio detail file
    const portfolioDetailData = portfolioCopyData.data.map(row => ({
        distinct_id: normalizeId(row),
        portfolioTicker: row['portfolioTicker'],
        portfolio_views: parseInt(row['(1) Viewed Portfolio Details'] || 0),
        copy_starts: parseInt(row['(2) Started Copy Portfolio'] || 0),
        copies: parseInt(row['(3) Copied Portfolio'] || 0)
    })).filter(row => row.distinct_id);

    return {
        mainFile: mainAnalysisData,
        creatorFile: creatorDetailData,
        portfolioFile: portfolioDetailData
    };
}

// ============================================================================
// ANALYSIS FUNCTIONS (from analysis_tool.js)
// ============================================================================

// Constants
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

const SECTION_EXCLUSIONS = {
    'totalDeposits': ['totalDepositCount'],
    'totalCopies': ['totalBuys', 'totalTrades', 'totalRegularCopies']
};

/**
 * Helper functions for analysis
 */
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
        const lowerIncomes = ['Less than $25,000', '<25k', '$25,000-$49,999', '25k–50k', '$50,000-$74,999', '50k–100k'];
        if (!income) return true;
        const incomeStr = String(income);
        return incomeStr.trim() === '' || lowerIncomes.includes(incomeStr);
    }

    function isLowerOrUnknownNetWorth(netWorth) {
        const lowerNetWorths = ['Less than $10,000', '<10k', '$10,000-$49,999', '10k–50k', '$50,000-$99,999', '50k–100k'];
        if (!netWorth) return true;
        const netWorthStr = String(netWorth);
        return netWorthStr.trim() === '' || lowerNetWorths.includes(netWorthStr);
    }

    function isHigherOrUnknownIncome(income) {
        const lowerIncomes = ['Less than $25,000', '<25k', '$25,000-$49,999', '25k–50k', '$50000-$74,999', '50k–100k'];
        if (!income) return true;
        const incomeStr = String(income);
        return incomeStr.trim() === '' || !lowerIncomes.includes(incomeStr);
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
    // Use totalDepositCount as fallback if totalDeposits is not available
    const usersWithLinkedBank = data.filter(d => d.hasLinkedBank === 1).length;
    const usersWithCopies = data.filter(d => d.totalCopies > 0).length;
    const usersWithDeposits = data.filter(d => (d.totalDeposits > 0) || (d.totalDepositCount > 0)).length;
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

        // Portfolio Trading Metrics
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

// Display helper functions
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
        nameEl.textContent = p.name;
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

function displayCombinedAnalysisInline(correlationResults, regressionResults, cleanData, tippingPoints) {
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
        combinedData.slice(0, 20).forEach(item => {
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

// ============================================================================
// EXPORTS
// ============================================================================

// Export to window
window.UnifiedAnalysisTool = UnifiedAnalysisTool;

console.log('✅ Unified Analysis Tool loaded successfully!');