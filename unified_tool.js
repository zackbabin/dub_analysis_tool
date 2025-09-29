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

        // Header
        const header = document.createElement('div');
        header.className = 'qda-header';
        header.innerHTML = '<h3 style="margin: 0;">Unified Analysis Workflow</h3>';
        wrapper.appendChild(header);

        // Content
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
            'Fetch Fresh Data',
            'Trigger GitHub Actions to fetch latest data from Mixpanel',
            '#28a745',
            () => this.runWorkflow('github')
        );
        buttonContainer.appendChild(githubBtn);

        // Option 2: Upload CSV files
        const uploadBtn = this.createModeButton(
            'Upload CSV Files',
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

        const mergedData = window.processComprehensiveData(contents);

        this.updateProgress(70, 'Data merged...');
        this.addStatusMessage('✅ Data merged successfully', 'success');
        this.addStatusMessage(`   - Main file: ${mergedData.mainFile.length} records`, 'info');
        this.addStatusMessage(`   - Creator file: ${mergedData.creatorFile.length} records`, 'info');
        this.addStatusMessage(`   - Portfolio file: ${mergedData.portfolioFile.length} records`, 'info');

        // Step 2: Skip download creation for unified workflow
        // (Files are already saved to GitHub by the workflow)

        this.updateProgress(80, 'Running analysis...');

        // Step 3: Run analysis on main file
        this.addStatusMessage('📊 Running statistical analysis...', 'info');

        const mainCSV = this.convertToCSV(mergedData.mainFile);
        const results = window.performQuantitativeAnalysis(mainCSV, null, null);

        this.updateProgress(90, 'Displaying results...');
        this.addStatusMessage('✅ Analysis complete', 'success');

        // Step 4: Save results to localStorage
        localStorage.setItem('qdaSummaryStats', JSON.stringify(results.summaryStats));
        localStorage.setItem('qdaCorrelationResults', JSON.stringify(results.correlationResults));
        localStorage.setItem('qdaRegressionResults', JSON.stringify(results.regressionResults));
        localStorage.setItem('qdaCleanData', JSON.stringify(results.cleanData));

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
        window.displaySummaryStatsInline(results.summaryStats);
        window.displayDemographicBreakdownInline(results.summaryStats);
        window.displayPersonaBreakdownInline(results.summaryStats);
        window.displayCombinedAnalysisInline(results.correlationResults, results.regressionResults, results.cleanData);

        resultsDiv.style.display = 'block';
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
        // Use the existing matchFilesByName function from data_merger.js
        return await window.matchFilesByName(files);
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

// Export to window
window.UnifiedAnalysisTool = UnifiedAnalysisTool;

console.log('✅ Unified Analysis Tool loaded successfully!');