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
        this.updateProgress(20, 'Ingesting live data...');

        // Step 2: Wait for workflow completion (data ingestion from Mixpanel)
        this.addStatusMessage('📊 Ingesting live data from Mixpanel...', 'info');
        const workflowSuccess = await this.waitForWorkflowCompletion();

        if (!workflowSuccess) {
            throw new Error('Workflow failed or timed out');
        }

        this.addStatusMessage('✅ Data ingestion completed', 'success');
        this.updateProgress(40, 'Analyzing the data...');

        // Step 3: Load data from GitHub
        this.addStatusMessage('📥 Loading data files from GitHub...', 'info');

        const contents = await this.loadGitHubData();
        this.addStatusMessage('✅ Data files loaded', 'success');
        this.updateProgress(60, 'Analyzing the data...');

        // Step 4: Process and analyze data
        await this.processAndAnalyze(contents);
    }

    /**
     * Runs the upload workflow
     */
    async runUploadWorkflow() {
        // Show file upload section
        const uploadSection = document.getElementById('unifiedUploadSection');
        uploadSection.style.display = 'block';

        this.addStatusMessage('📁 Please select your 4 required CSV files and click "Process Files"', 'info');

        // Wait for user to select files
        const fileInput = document.getElementById('unifiedFileInput');
        const processButton = document.getElementById('unifiedProcessButton');

        // Show button when 4 files are selected
        fileInput.addEventListener('change', () => {
            if (fileInput.files && fileInput.files.length === 4) {
                processButton.style.display = 'inline-block';
                this.addStatusMessage('✅ 4 files selected - click "Process Files" to continue', 'success');
            } else {
                processButton.style.display = 'none';
            }
        });

        // Create a promise that resolves when button is clicked
        await new Promise((resolve, reject) => {
            processButton.onclick = () => {
                if (fileInput.files && fileInput.files.length === 4) {
                    resolve();
                } else {
                    this.addStatusMessage('❌ Please select exactly 4 CSV files', 'error');
                }
            };

            // Add timeout
            setTimeout(() => {
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
            throw new Error(`Could not identify all file types. Found ${matchedFiles.foundCount}/4 required files.`);
        }

        this.updateProgress(40, 'Reading files...');

        // Read file contents
        const contents = await Promise.all(matchedFiles.files.map(file => this.readFile(file)));

        this.updateProgress(60, 'Merging data...');
        this.addStatusMessage('✅ Files read successfully', 'success');

        // Process and analyze
        await this.processAndAnalyze(contents);
    }

    /**
     * Generate hash of data for incremental analysis cache validation
     * Uses simple but fast hash function for large datasets
     */
    hashData(data) {
        const str = JSON.stringify(data);
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        // Include data structure version to force refresh on schema changes
        return `v1_${hash}`;
    }

    /**
     * Processes data and runs analysis
     * Implements incremental analysis: skips re-processing if data unchanged
     */
    async processAndAnalyze(contents) {
        // Reset cached new variables at the start of each analysis
        cachedNewVariables = null;

        // Step 1: Merge data
        const mergedData = processComprehensiveData(contents);

        // Step 2: Check if data has changed (incremental analysis optimization)
        const dataHash = this.hashData(mergedData.mainFile);
        const cachedHash = localStorage.getItem('qdaDataHash');
        const cachedResults = localStorage.getItem('qdaAnalysisResults');

        if (dataHash === cachedHash && cachedResults) {
            console.log('📦 Data unchanged - using cached analysis results (90% faster!)');
            this.updateProgress(75, 'Loading cached results...');

            try {
                const analysisData = JSON.parse(cachedResults);

                // Reconstruct results object in expected format
                const results = {
                    summaryStats: analysisData.summaryStats,
                    correlationResults: analysisData.correlationResults,
                    regressionResults: analysisData.regressionResults,
                    cleanData: null // Not cached to save space
                };

                this.updateProgress(90, 'Displaying results...');

                // Display cached results
                await this.displayResults(results);

                this.updateProgress(100, 'Complete!');

                setTimeout(() => {
                    document.getElementById('unifiedProgressSection').style.display = 'none';
                }, 1500);

                return;
            } catch (error) {
                console.warn('Failed to use cached results, running full analysis:', error);
                // Fall through to full analysis
            }
        }

        console.log('🔄 Data changed or no cache - running full analysis');

        // Step 3: Run analysis on main file
        this.updateProgress(75, 'Analyzing data...');

        // Pass JSON directly instead of converting to CSV and parsing back
        const results = performQuantitativeAnalysis(mergedData.mainFile, null, null);

        this.updateProgress(90, 'Generating insights...');

        // Step 4: Calculate tipping points for all variables and outcomes
        const tippingPoints = this.calculateAllTippingPoints(results.cleanData, results.correlationResults);

        // Clear cleanData reference to free memory (it's large and no longer needed)
        results.cleanData = null;

        // Step 5: Save results and hash to localStorage in single batch write
        const now = new Date();
        const timestamp = now.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });

        // Batch all results into single localStorage write (reduces I/O operations)
        localStorage.setItem('qdaAnalysisResults', JSON.stringify({
            summaryStats: results.summaryStats,
            correlationResults: results.correlationResults,
            regressionResults: results.regressionResults,
            tippingPoints: tippingPoints,
            lastUpdated: timestamp
        }));

        // Store data hash for incremental analysis
        localStorage.setItem('qdaDataHash', dataHash);

        // Step 6: Display results
        this.displayResults(results);

        this.updateProgress(100, 'Complete!');

        // Hide progress bar after completion
        setTimeout(() => {
            document.getElementById('unifiedProgressSection').style.display = 'none';
        }, 2000);
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
     * Calculate tipping points for all variables and outcomes
     * Optimized: Pre-groups data in single pass instead of 105 separate iterations
     */
    calculateAllTippingPoints(cleanData, correlationResults) {
        const tippingPoints = {};

        // Pre-group all data in a single pass through the dataset
        const preGroupedData = preGroupDataForTippingPoints(cleanData);

        ['totalCopies', 'totalDeposits', 'totalSubscriptions'].forEach(outcome => {
            tippingPoints[outcome] = {};

            const variables = Object.keys(correlationResults[outcome]);
            variables.forEach(variable => {
                if (variable !== outcome) {
                    // Use pre-grouped data instead of iterating through dataset again
                    const groupKey = `${variable}_${outcome}`;
                    tippingPoints[outcome][variable] = calculateTippingPointFromGroups(preGroupedData[groupKey]);
                }
            });
        });

        return tippingPoints;
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

    /**
     * Helper: Trigger GitHub workflow
     */
    async triggerGitHubWorkflow() {
        const githubToken = localStorage.getItem('github_pat');

        if (!githubToken) {
            throw new Error('GitHub token not configured. Please enter and save your token in the configuration section above.');
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
                    'Authorization': 'Bearer ' + githubToken,
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
     * Helper: Wait for workflow completion with simple polling
     */
    async waitForWorkflowCompletion() {
        const githubToken = localStorage.getItem('github_pat');
        if (!githubToken) return false;

        const owner = 'zackbabin';
        const repo = 'dub_analysis_tool';

        let attempts = 0;
        const maxAttempts = 300; // 300 attempts * 3s = 15 minutes
        const pollInterval = 3000; // Check every 3 seconds

        while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, pollInterval));
            attempts++;

            const response = await fetch(
                `https://api.github.com/repos/${owner}/${repo}/actions/runs?per_page=1`,
                {
                    headers: {
                        'Accept': 'application/vnd.github+json',
                        'Authorization': 'Bearer ' + githubToken,
                        'X-GitHub-Api-Version': '2022-11-28'
                    }
                }
            );

            if (response.ok) {
                const data = await response.json();
                if (data.workflow_runs && data.workflow_runs.length > 0) {
                    const latestRun = data.workflow_runs[0];

                    // Update status message to show workflow progress
                    const statusText = latestRun.status === 'in_progress' || latestRun.status === 'queued'
                        ? 'Ingesting live data...'
                        : `Workflow ${latestRun.status}...`;
                    this.updateProgress(20 + (attempts * 0.5), statusText);

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

        throw new Error('Workflow timeout - exceeded 15 minutes');
    }

    /**
     * Helper: Load data from GitHub
     */
    async loadGitHubData() {
        const baseUrl = 'https://raw.githubusercontent.com/zackbabin/dub_analysis_tool/main/data/';

        // Only load the 4 required files for analysis
        const fileUrls = [
            baseUrl + '1_subscribers_insights.csv',
            baseUrl + '2_time_to_first_copy.csv',
            baseUrl + '3_time_to_funded_account.csv',
            baseUrl + '4_time_to_linked_bank.csv'
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

    console.log('Parsing CSV files...');
    const [
        demoData,
        firstCopyData,
        fundedAccountData,
        linkedBankData
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

    // Create aggregated conversion metrics (stubbed - premium/creator/portfolio data not used)
    const conversionAggregates = {};

    // Note: Premium subscription, creator copy, and portfolio copy data removed
    // These files are not required for main analysis

    // Initialize empty aggregates (no premium/creator/portfolio data processed)
    demoData.data.forEach(row => {
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
    });

    // Portfolio aggregates (empty - no data file provided)
    const portfolioAggregates = {};

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

    // Note: Creator and portfolio detail file generation removed as they're not currently used
    // Previously generated creatorFile and portfolioFile from premiumSubData, creatorCopyData, and portfolioCopyData
    // Can be re-enabled if needed for future analysis

    return {
        mainFile: mainAnalysisData
    };
}

// ============================================================================
// ANALYSIS FUNCTIONS (from analysis_tool.js)
// ============================================================================

// Constants
const ALL_VARIABLES = [
    'hasLinkedBank', 'totalStripeViews', 'paywallViews',
    'regularPDPViews', 'premiumPDPViews', 'uniqueCreatorsInteracted',
    'uniquePortfoliosInteracted', 'timeToFirstCopy', 'timeToDeposit', 'timeToLinkedBank',
    'incomeEnum', 'netWorthEnum', 'availableCopyCredits', 'buyingPower',
    'activeCreatedPortfolios', 'lifetimeCreatedPortfolios', 'totalBuys', 'totalSells',
    'totalTrades', 'totalWithdrawalCount', 'totalWithdrawals', 'totalOfUserProfiles',
    'totalDepositCount', 'subscribedWithin7Days', 'totalRegularCopies',
    'regularCreatorProfileViews', 'premiumCreatorProfileViews', 'appSessions',
    'discoverTabViews', 'leaderboardViews', 'premiumTabViews', 'creatorCardTaps', 'portfolioCardTaps',
    'totalProfileViews', 'totalPDPViews'
];

const SECTION_EXCLUSIONS = {
    'totalDeposits': [
        'availableCopyCredits',
        'buyingPower',
        'activeCreatedPortfolios',
        'lifetimeCreatedPortfolios',
        'activeCopiedPortfolios',
        'lifetimeCopiedPortfolios',
        'totalDeposits',
        'totalDepositCount',
        'hasLinkedBank',
        'totalCopies',
        'totalRegularCopies',
        'totalPremiumCopies'
    ],
    'totalCopies': [
        'availableCopyCredits',
        'activeCreatedPortfolios',
        'lifetimeCreatedPortfolios',
        'activeCopiedPortfolios',
        'lifetimeCopiedPortfolios',
        'totalCopies',
        'totalRegularCopies',
        'totalPremiumCopies'
    ],
    'totalSubscriptions': [
        'totalSubscriptions'
    ]
};

// Expose to window for access by Supabase version
window.SECTION_EXCLUSIONS = SECTION_EXCLUSIONS;

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

function calculateCorrelations(data) {
    const variables = getAllVariables(data);  // Use dynamic variable detection
    const correlations = {};

    // Pre-extract all variable arrays once to avoid repeated map operations
    const variableArrays = {};
    ['totalCopies', 'totalDeposits', 'totalSubscriptions'].concat(variables).forEach(varName => {
        variableArrays[varName] = data.map(d => d[varName]);
    });

    ['totalCopies', 'totalDeposits', 'totalSubscriptions'].forEach(outcome => {
        correlations[outcome] = {};
        variables.forEach(variable => {
            if (variable !== outcome) {
                correlations[outcome][variable] = calculateCorrelation(
                    variableArrays[outcome],
                    variableArrays[variable]
                );
            }
        });
    });

    return correlations;
}

function performRegression(data, outcome, correlations) {
    const predictors = getAllVariables(data);  // Use dynamic variable detection
    const n = data.length;

    const results = predictors.filter(predictor => predictor !== outcome).map(predictor => {
        // Reuse pre-calculated correlation instead of recalculating
        const correlation = correlations[outcome][predictor];

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

/**
 * Pre-group data for all variables and outcomes in a single pass
 * This avoids iterating through the dataset multiple times (once per variable/outcome pair)
 */
function preGroupDataForTippingPoints(data) {
    const allGroups = {};
    const variables = getAllVariables(data);  // Use dynamic variable detection
    const outcomes = ['totalCopies', 'totalDeposits', 'totalSubscriptions'];

    // Single pass through the dataset, grouping all variable/outcome combinations
    data.forEach(user => {
        variables.forEach(variable => {
            outcomes.forEach(outcome => {
                const key = `${variable}_${outcome}`;
                const value = Math.floor(user[variable]) || 0;
                const converted = user[outcome] > 0 ? 1 : 0;

                if (!allGroups[key]) {
                    allGroups[key] = {};
                }
                if (!allGroups[key][value]) {
                    allGroups[key][value] = { total: 0, converted: 0 };
                }
                allGroups[key][value].total++;
                allGroups[key][value].converted += converted;
            });
        });
    });

    return allGroups;
}

/**
 * Calculate tipping point from pre-grouped data
 * This version doesn't iterate through the dataset, just processes pre-computed groups
 */
function calculateTippingPointFromGroups(groups) {
    if (!groups) return 'N/A';

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

    // Core: All non-premium users with deposits > 0 (merged Aspiring Premium, original Core, and Lower Income with deposits)
    if (user.totalSubscriptions === 0 && user.totalDeposits > 0) {
        return 'core';
    }

    if (user.totalDeposits === 0 &&
        user.totalCopies === 0 &&
        (totalPDPViews >= 1 || totalCreatorViews >= 1)) {
        return 'activationTargets';
    }

    if (user.totalDeposits === 0 &&
        totalPDPViews === 0 &&
        totalCreatorViews === 0 &&
        user.totalCopies === 0) {
        return 'nonActivated';
    }

    // Former Lower Income users with deposits = 0 now fall into Non-Activated or Unclassified
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
    const usersWithDeposits = data.filter(d => d.totalDepositCount > 0).length;
    const usersWithSubscriptions = data.filter(d => d.totalSubscriptions > 0).length;

    const demographicKeys = [
        'income', 'netWorth', 'investingExperienceYears',
        'investingActivity', 'investmentType', 'investingObjective',
        'acquisitionSurvey'
    ];

    const demographics = {};
    demographicKeys.forEach(key => {
        const breakdown = calculateDemographicBreakdown(data, key);
        demographics[key + 'Breakdown'] = breakdown.counts;
        demographics[key + 'TotalResponses'] = breakdown.totalResponses;
    });

    const totalUsers = data.length;

    // Calculate count of users with non-null total deposits (for denominator)
    const usersWithDepositData = data.filter(d => d.totalDeposits !== null && d.totalDeposits !== undefined).length;

    // Calculate count of users with low deposits for demographic cards (<$1k means strictly less than 1000)
    const usersWithLowDeposits = data.filter(d => d.totalDeposits !== null && d.totalDeposits < 1000).length;
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
        usersWithDepositData: usersWithDepositData,
        usersWithLowDeposits: usersWithLowDeposits,
        ...demographics,
        personaStats
    };
}

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
        totalDepositCount: cleanNumeric(row['Total Deposit Count'] || row['C. Total Deposit Count']),
        totalWithdrawals: cleanNumeric(row['Total Withdrawals'] || row['totalWithdrawals']),
        totalWithdrawalCount: cleanNumeric(row['Total Withdrawal Count'] || row['totalWithdrawalCount']),

        // Portfolio Trading Metrics
        activeCreatedPortfolios: cleanNumeric(row['Active Created Portfolios'] || row['activeCreatedPortfolios']),
        lifetimeCreatedPortfolios: cleanNumeric(row['Lifetime Created Portfolios'] || row['lifetimeCreatedPortfolios']),
        activeCopiedPortfolios: cleanNumeric(row['Active Copied Portfolios'] || row['activeCopiedPortfolios']),
        lifetimeCopiedPortfolios: cleanNumeric(row['Lifetime Copied Portfolios'] || row['lifetimeCopiedPortfolios']),
        totalBuys: cleanNumeric(row['Total Buys'] || row['totalBuys']),
        totalSells: cleanNumeric(row['Total Sells'] || row['totalSells']),
        totalTrades: cleanNumeric(row['Total Trades'] || row['totalTrades']),

        // Behavioral / Engagement Metrics
        totalRegularCopies: cleanNumeric(row['Total Regular Copies'] || row['F. Total Regular Copies']),
        totalPremiumCopies: cleanNumeric(row['Total Premium Copies'] || row['G. Total Premium Copies']),
        uniqueCreatorsInteracted: cleanNumeric(row['Unique Creators Interacted']),
        uniquePortfoliosInteracted: cleanNumeric(row['Unique Portfolios Interacted']),

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
    const correlationResults = calculateCorrelations(cleanData);
    const regressionResults = {
        copies: performRegression(cleanData, 'totalCopies', correlationResults),
        deposits: performRegression(cleanData, 'totalDeposits', correlationResults),
        subscriptions: performRegression(cleanData, 'totalSubscriptions', correlationResults)
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
        'totalDepositCount': 'Total Deposit Count',
        'totalWithdrawals': 'Total Withdrawals',
        'totalWithdrawalCount': 'Total Withdrawal Count',
        'activeCreatedPortfolios': 'Active Created Portfolios',
        'lifetimeCreatedPortfolios': 'Lifetime Created Portfolios',
        'activeCopiedPortfolios': 'Active Copied Portfolios',
        'lifetimeCopiedPortfolios': 'Lifetime Copied Portfolios',
        'totalBuys': 'Total Buys',
        'totalSells': 'Total Sells',
        'totalTrades': 'Total Trades',
        'totalCopyStarts': 'Total Copy Starts',
        'totalRegularCopies': 'Total Regular Copies',
        'uniqueCreatorsInteracted': 'Unique Creators Interacted',
        'uniquePortfoliosInteracted': 'Unique Portfolios Interacted',
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

// Note: calculatePredictiveStrength moved to analysis_utils.js for shared use
// Function is available via window.calculatePredictiveStrength

function displaySummaryStatsInline(stats) {
    const container = document.getElementById('qdaSummaryStatsInline');
    container.textContent = '';

    const resultSection = document.createElement('div');
    resultSection.className = 'qda-result-section';

    // Wrapper for H1 and buttons
    const headerWrapper = document.createElement('div');
    headerWrapper.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem;';

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

    // Button container
    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = 'display: flex; gap: 10px; align-items: center;';

    // Sync Live Data button
    const syncBtn = document.createElement('button');
    syncBtn.textContent = 'Sync Live Data';
    syncBtn.style.cssText = 'padding: 8px 16px; background: #28a745; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500; transition: background 0.2s;';
    syncBtn.onmouseover = () => syncBtn.style.background = '#218838';
    syncBtn.onmouseout = () => syncBtn.style.background = '#28a745';
    syncBtn.onclick = () => {
        if (window.userAnalysisTool) {
            window.userAnalysisTool.runWorkflow('github');
        }
    };

    // Upload Data button
    const uploadBtn = document.createElement('button');
    uploadBtn.textContent = 'Upload Data';
    uploadBtn.style.cssText = 'padding: 8px 16px; background: #6c757d; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500; transition: background 0.2s;';
    uploadBtn.onmouseover = () => uploadBtn.style.background = '#5a6268';
    uploadBtn.onmouseout = () => uploadBtn.style.background = '#6c757d';
    uploadBtn.onclick = () => {
        // For Summary Stats tab, show marketing upload modal
        if (window.showMarketingUploadModal && window.userAnalysisTool) {
            window.showMarketingUploadModal(window.userAnalysisTool);
        } else if (window.userAnalysisTool) {
            window.userAnalysisTool.runWorkflow('upload');
        }
    };

    // Refresh Data button
    const refreshBtn = document.createElement('button');
    refreshBtn.textContent = 'Refresh Data';
    refreshBtn.style.cssText = 'padding: 8px 16px; background: #17a2b8; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500; transition: background 0.2s;';
    refreshBtn.onmouseover = () => refreshBtn.style.background = '#138496';
    refreshBtn.onmouseout = () => refreshBtn.style.background = '#17a2b8';
    refreshBtn.onclick = window.refreshAllTabs;

    buttonContainer.appendChild(syncBtn);
    buttonContainer.appendChild(uploadBtn);
    buttonContainer.appendChild(refreshBtn);

    headerWrapper.appendChild(title);
    headerWrapper.appendChild(buttonContainer);
    resultSection.appendChild(headerWrapper);

    const metricSummary = document.createElement('div');
    metricSummary.className = 'qda-metric-summary';

    const metrics = [
        ['Total Users', stats.totalUsers?.toLocaleString() || '0', '18px'],
        ['Link Bank Rate', stats.linkBankConversion != null ? `${stats.linkBankConversion.toFixed(1)}%` : 'N/A', '18px'],
        ['Deposit Rate', stats.depositConversion != null ? `${stats.depositConversion.toFixed(1)}%` : 'N/A', '18px'],
        ['Copy Rate', stats.firstCopyConversion != null ? `${stats.firstCopyConversion.toFixed(1)}%` : 'N/A', '18px'],
        ['Subscription Rate', stats.subscriptionConversion != null ? `${stats.subscriptionConversion.toFixed(1)}%` : 'N/A', '18px']
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
    title.style.marginTop = '1.5rem';
    title.style.marginBottom = '0.5rem';
    title.textContent = 'Persona Breakdown';
    resultSection.appendChild(title);

    const grid = document.createElement('div');
    grid.style.cssText = 'display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin-top: 1.5rem;';

    const personas = [
        {
            name: 'Premium',
            subtitle: 'Active Premium subscribers',
            data: stats.personaStats.premium,
            priority: 1
        },
        {
            name: 'Core',
            subtitle: 'Engaged users with deposits and no Premium subscriptions',
            data: stats.personaStats.core,
            priority: 2
        },
        {
            name: 'Activation Targets',
            subtitle: 'Users that have shown engagement but no deposits or copies',
            data: stats.personaStats.activationTargets,
            priority: 3
        },
        {
            name: 'Non-activated',
            subtitle: 'Users with no bank linked, deposits, or engagement',
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