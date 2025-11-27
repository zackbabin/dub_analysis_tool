// Creator Analysis Tool - Complete End-to-End Workflow
'use strict';

/**
 * This tool analyzes creator performance data including:
 * 1. Summary Statistics (total creators, creator types)
 * 2. Breakdowns (copies, subscriptions, portfolios)
 * 3. Behavioral Analysis (correlations and regressions for copies and subscriptions)
 */

class CreatorAnalysisTool {
    constructor() {
        this.container = null;
        this.outputContainer = null;
        this.statusMessages = [];
    }

    /**
     * Creates the creator tool UI
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

        // Status Display
        const statusSection = document.createElement('div');
        statusSection.id = 'creatorStatusSection';
        statusSection.style.cssText = 'margin: 20px 0; padding: 15px; background: #f8f9fa; border-radius: 5px; min-height: 100px; display: none;';
        content.appendChild(statusSection);

        // Progress Bar
        const progressSection = document.createElement('div');
        progressSection.id = 'creatorProgressSection';
        progressSection.style.cssText = 'margin: 20px 0; display: none;';
        progressSection.innerHTML = `
            <div style="background: #e9ecef; border-radius: 5px; overflow: hidden; height: 30px;">
                <div id="creatorProgressBar" style="background: linear-gradient(90deg, #17a2b8, #138496); height: 100%; width: 0%; transition: width 0.3s; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 12px;">
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

        // Sync Live Data button
        const syncBtn = this.createModeButton(
            'Sync Live Data',
            'Fetch latest creator data from Mixpanel',
            '#28a745',
            '#28a745',
            () => this.runWorkflow('sync')
        );
        buttonContainer.appendChild(syncBtn);

        // Manually Upload Data button
        const uploadBtn = this.createModeButton(
            'Manually Upload Data',
            'Upload creator CSV file for analysis',
            '#dee2e6',
            '#6c757d',
            () => this.runWorkflow('upload')
        );
        buttonContainer.appendChild(uploadBtn);

        section.appendChild(buttonContainer);

        // File upload section (hidden by default)
        const uploadSection = document.createElement('div');
        uploadSection.id = 'creatorUploadSection';
        uploadSection.style.cssText = 'display: none; border: 2px dashed #17a2b8; border-radius: 8px; padding: 20px; background: #f8f9fa; margin-top: 15px;';
        uploadSection.innerHTML = `
            <div style="text-align: center;">
                <label style="font-weight: bold; color: #333; display: block; margin-bottom: 10px;">
                    Select Creator CSV File
                </label>
                <div style="font-size: 12px; color: #6c757d; margin-bottom: 10px;">
                    Upload a single CSV file containing creator data
                </div>
                <input type="file" id="creatorFileInput" accept=".csv" style="padding: 8px; border: 1px solid #ddd; border-radius: 4px; width: 100%; margin-bottom: 15px;">
                <button id="creatorProcessButton" class="qda-btn" style="display: none;">
                    Process File
                </button>
            </div>
        `;
        section.appendChild(uploadSection);

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
        this.showProgress(0);

        try {
            if (mode === 'sync') {
                await this.runSyncWorkflow();
            } else if (mode === 'upload') {
                this.showUploadSection();
            }
        } catch (error) {
            this.addStatusMessage(`❌ Error: ${error.message}`, 'error');
            console.error('Workflow error:', error);
        }
    }

    /**
     * Shows the upload section and sets up file input handler
     */
    showUploadSection() {
        const fileInput = document.getElementById('creatorFileInput');

        if (!fileInput) {
            this.addStatusMessage('❌ Error: File input not found. Please refresh the page.', 'error');
            console.error('Missing file input element');
            return;
        }

        // Trigger file picker
        fileInput.click();
    }

    /**
     * Reads a file as text
     */
    readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = (e) => reject(new Error('Failed to read file'));
            reader.readAsText(file);
        });
    }

    /**
     * Runs the upload workflow (to be overridden by Supabase version)
     */
    async runUploadWorkflow(csvContent) {
        throw new Error('runUploadWorkflow must be overridden by subclass');
    }

    /**
     * Runs the sync workflow (to be overridden by Supabase version)
     */
    async runSyncWorkflow() {
        throw new Error('runSyncWorkflow must be overridden by subclass');
    }

    /**
     * Processes data and runs analysis
     */
    async processAndAnalyze(csvContent) {
        // Parse CSV
        this.updateProgress(50, 'Parsing data...');
        const parsedData = this.parseCSV(csvContent);

        // Clean and transform data
        this.updateProgress(60, 'Cleaning data...');
        const cleanData = this.cleanCreatorData(parsedData);

        // Run analysis
        this.updateProgress(75, 'Analyzing data...');
        const results = this.performCreatorAnalysis(cleanData);

        this.updateProgress(90, 'Generating insights...');

        // Clear cleanData reference to free memory
        results.cleanData = null;

        // Save results to localStorage
        const now = new Date();
        const timestamp = now.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });

        localStorage.setItem('creatorAnalysisResults', JSON.stringify({
            summaryStats: results.summaryStats,
            lastUpdated: timestamp
        }));

        // Display results
        this.displayResults(results);

        this.updateProgress(100, 'Complete!');

        // Hide progress bar after completion (with safety check)
        setTimeout(() => {
            const progressSection = document.getElementById('creatorProgressSection');
            if (progressSection) {
                progressSection.style.display = 'none';
            }
        }, 2000);
    }

    /**
     * Parse CSV data
     * Uses shared CSV parsing utility from csv_utils.js
     */
    parseCSV(text) {
        return window.CSVUtils.parseCSV(text);
    }

    /**
     * Clean and transform creator data
     */
    cleanCreatorData(parsedData) {
        console.log(`=== Cleaning Creator Data ===`);
        console.log(`Raw parsed rows: ${parsedData.data.length}`);

        const cleanedRows = parsedData.data.map(row => {
            // Parse raw_data if it exists
            let rawData = {};
            if (row['raw_data']) {
                try {
                    rawData = typeof row['raw_data'] === 'string'
                        ? JSON.parse(row['raw_data'])
                        : row['raw_data'];
                } catch (e) {
                    console.warn('Failed to parse raw_data for', row['creator_username'], e);
                }
            }

            const cleanRow = {
                // Identifiers
                email: row['email'] || '',
                creatorUsername: row['creator_username'] || '',

                // Type from raw_data with fallback to row-level field
                type: rawData['type'] || row['type'] || 'Regular',

                // Enriched metrics (from Mixpanel or default to 0)
                totalCopies: this.cleanNumeric(row['total_copies']),
                totalSubscriptions: this.cleanNumeric(row['total_subscriptions'])
            };

            // Add ALL fields from raw_data (for correlation analysis)
            Object.keys(rawData).forEach(key => {
                // Skip fields we've already handled at the top level
                if (key === 'type' || key === 'email') return;

                const value = rawData[key];

                // Try to parse as numeric first
                const numericValue = this.cleanNumeric(value);

                // Include all numeric fields (even if 0 or null - important for correlation analysis)
                if (typeof value === 'number' || !isNaN(parseFloat(value)) || value === null || value === undefined || value === '') {
                    cleanRow[key] = numericValue;
                }
                // Include string fields
                else if (typeof value === 'string') {
                    cleanRow[key] = value;
                }
            });

            return cleanRow;
        });

        const filteredRows = cleanedRows.filter(row => row.email || row.creatorUsername);
        console.log(`Cleaned rows: ${cleanedRows.length}`);
        console.log(`After filtering (must have email or username): ${filteredRows.length}`);

        return filteredRows;
    }

    /**
     * Helper: Clean numeric values
     */
    cleanNumeric(value) {
        if (value === null || value === undefined || value === '' || isNaN(value)) return 0;
        return parseFloat(value) || 0;
    }

    /**
     * Perform creator analysis
     * Note: Summary stats are now calculated server-side via premium_creator_summary_stats view
     * Manual CSV uploads store data in database and displayResults is overridden to fetch from view
     */
    performCreatorAnalysis(cleanData) {
        return {
            summaryStats: null, // Calculated server-side, not client-side
            cleanData
        };
    }

    /**
     * Display analysis results
     */
    displayResults(results) {
        // Clear output container
        this.outputContainer.innerHTML = '';

        // Create results div
        const resultsDiv = document.createElement('div');
        resultsDiv.id = 'creatorAnalysisResultsInline';
        resultsDiv.className = 'qda-analysis-results';
        this.outputContainer.appendChild(resultsDiv);

        // Add timestamp
        const timestamp = document.createElement('div');
        timestamp.className = 'qda-timestamp';

        const analysisData = JSON.parse(localStorage.getItem('creatorAnalysisResults') || '{}');
        const lastUpdated = analysisData.lastUpdated;
        if (lastUpdated) {
            timestamp.textContent = `Last updated: ${lastUpdated}`;
            resultsDiv.appendChild(timestamp);
        }

        // Create containers
        resultsDiv.innerHTML += `
            <div id="creatorSummaryStatsInline"></div>
            <div id="creatorBreakdownInline"></div>
        `;

        // Display results
        this.displayCreatorSummaryStats(results.summaryStats);
        this.displayCreatorBreakdown(results.summaryStats);

        resultsDiv.style.display = 'block';

        // Save HTML for restoration
        this.saveAnalysisResults(this.outputContainer.innerHTML);
    }

    /**
     * Display creator summary statistics
     */
    displayCreatorSummaryStats(stats) {
        console.log('=== Displaying Summary Stats ===');
        console.log('Stats object:', stats);

        const container = document.getElementById('creatorSummaryStatsInline');
        if (!container) {
            console.error('❌ Container creatorSummaryStatsInline not found!');
            return;
        }
        container.innerHTML = '';

        const section = document.createElement('div');
        section.className = 'qda-result-section';

        // Add H1 title
        const title = document.createElement('h1');
        title.textContent = 'Creator Analysis';
        section.appendChild(title);

        const metricSummary = document.createElement('div');
        metricSummary.className = 'qda-metric-summary';

        // Core metrics with same style as other tabs
        const metrics = [
            ['Total Creators', stats.totalCreators.toLocaleString()],
            ['Core Creators', (stats.creatorTypes['Regular'] || 0).toLocaleString()],
            ['Premium Creators', (stats.creatorTypes['Premium'] || 0).toLocaleString()]
        ];

        console.log('Metric cards to display:', metrics);

        metrics.forEach(([title, content]) => {
            const card = document.createElement('div');
            card.className = 'qda-metric-card';
            card.innerHTML = `
                <div style="font-size: 0.875rem; color: #2563eb; font-weight: 600; margin-bottom: 0.5rem;">${title}</div>
                <div style="font-size: 1.5rem; font-weight: bold; color: #000;">${content}</div>
            `;
            metricSummary.appendChild(card);
        });

        section.appendChild(metricSummary);
        container.appendChild(section);
    }

    /**
     * Display creator breakdown
     */
    displayCreatorBreakdown(stats) {
        const container = document.getElementById('creatorBreakdownInline');
        container.innerHTML = '';

        const section = document.createElement('div');
        section.className = 'qda-result-section';

        const title = document.createElement('h1');
        title.textContent = 'Distribution Breakdown';
        section.appendChild(title);

        // Copy distribution
        const copyTitle = document.createElement('h4');
        copyTitle.textContent = 'Copy Distribution';
        section.appendChild(copyTitle);

        const copyInfo = document.createElement('p');
        copyInfo.textContent = `${stats.creatorsWithCopies.toLocaleString()} creators (${stats.copyConversion.toFixed(1)}%) have generated at least one copy`;
        section.appendChild(copyInfo);

        // Subscription price distribution
        const subTitle = document.createElement('h4');
        subTitle.textContent = 'Subscription Price Distribution';
        section.appendChild(subTitle);

        if (Object.keys(stats.subscriptionPrices).length > 0) {
            const priceTable = this.createSubscriptionPriceTable(stats.subscriptionPrices);

            // Wrap table in scrollable container for mobile
            const tableWrapper = document.createElement('div');
            tableWrapper.className = 'table-wrapper';
            tableWrapper.appendChild(priceTable);

            section.appendChild(tableWrapper);
        } else {
            const placeholder = document.createElement('p');
            placeholder.textContent = 'No subscription price data available yet. This will be populated when subscription price data is added.';
            placeholder.style.fontStyle = 'italic';
            placeholder.style.color = '#6c757d';
            section.appendChild(placeholder);
        }

        // Portfolio performance (placeholder)
        const portfolioTitle = document.createElement('h4');
        portfolioTitle.textContent = 'Portfolio Performance Distribution';
        section.appendChild(portfolioTitle);

        const portfolioPlaceholder = document.createElement('p');
        portfolioPlaceholder.textContent = 'Portfolio performance metrics will be displayed here once the data source is defined.';
        portfolioPlaceholder.style.fontStyle = 'italic';
        portfolioPlaceholder.style.color = '#6c757d';
        section.appendChild(portfolioPlaceholder);

        container.appendChild(section);
    }

    /**
     * Create metric card
     */
    createMetricCard(title, content, size = null) {
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

    /**
     * Save analysis results to localStorage
     */
    saveAnalysisResults(resultsHTML) {
        try {
            const data = {
                html: resultsHTML,
                timestamp: new Date().toISOString()
            };
            localStorage.setItem('creatorAnalysisResultsHTML', JSON.stringify(data));
        } catch (e) {
            console.warn('Failed to save creator analysis results to localStorage:', e);
        }
    }

    /**
     * Restore analysis results from localStorage
     */
    restoreAnalysisResults() {
        try {
            // Version check - clear cache if structure has changed
            const CACHE_VERSION = '2.15'; // Removed dead calculateCreatorSummaryStats function
            const cachedVersion = localStorage.getItem('creatorAnalysisCacheVersion');

            if (cachedVersion !== CACHE_VERSION) {
                console.log('Cache version mismatch, clearing old cache...');
                localStorage.removeItem('creatorAnalysisResultsHTML');
                localStorage.removeItem('creatorAnalysisResults');
                localStorage.setItem('creatorAnalysisCacheVersion', CACHE_VERSION);
                return;
            }

            const saved = localStorage.getItem('creatorAnalysisResultsHTML');
            if (saved) {
                const data = JSON.parse(saved);
                if (this.outputContainer && data.html) {
                    this.outputContainer.innerHTML = data.html;
                    console.log('Restored creator analysis results from', data.timestamp);
                }
            }
        } catch (e) {
            console.warn('Failed to restore creator analysis results from localStorage:', e);
        }
    }

    // UI Helper Methods
    showStatus() {
        document.getElementById('creatorStatusSection').style.display = 'block';
    }

    clearStatus() {
        this.statusMessages = [];
        document.getElementById('creatorStatusSection').innerHTML = '';
    }

    addStatusMessage(message, type = 'info') {
        if (type === 'error') {
            this.showStatus();
        }

        const statusSection = document.getElementById('creatorStatusSection');
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

    showProgress(percent) {
        const progressSection = document.getElementById('creatorProgressSection');
        console.log('showProgress called, progressSection found:', !!progressSection);
        if (progressSection) {
            progressSection.style.display = 'block';
            progressSection.style.visibility = 'visible';
            progressSection.style.opacity = '1';
            console.log('✅ Progress section displayed, computed style:', window.getComputedStyle(progressSection).display);
        } else {
            console.error('❌ Progress section not found! Element ID: creatorProgressSection');
        }
        this.updateProgress(percent);
    }

    updateProgress(percent, label = null) {
        const progressBar = document.getElementById('creatorProgressBar');
        if (progressBar) {
            progressBar.style.width = `${percent}%`;
            // Update text in the inner div
            const textDiv = progressBar.querySelector('div');
            if (textDiv) {
                textDiv.textContent = label || `${Math.round(percent)}%`;
            } else {
                progressBar.textContent = label || `${Math.round(percent)}%`;
            }
        }
    }
}

// Export to window
window.CreatorAnalysisTool = CreatorAnalysisTool;

console.log('✅ Creator Analysis Tool loaded successfully!');
