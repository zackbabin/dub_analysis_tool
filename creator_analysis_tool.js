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

        // Calculate tipping points
        const tippingPoints = this.calculateAllTippingPoints(results.cleanData, results.correlationResults);

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
            correlationResults: results.correlationResults,
            regressionResults: results.regressionResults,
            tippingPoints: tippingPoints,
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
     */
    performCreatorAnalysis(cleanData) {
        const summaryStats = this.calculateCreatorSummaryStats(cleanData);
        const correlationResults = this.calculateCorrelations(cleanData);
        const regressionResults = {
            copies: this.performRegression(cleanData, 'totalCopies', correlationResults),
            subscriptions: this.performRegression(cleanData, 'totalSubscriptions', correlationResults)
        };

        return {
            summaryStats,
            correlationResults,
            regressionResults,
            cleanData
        };
    }

    /**
     * Calculate summary statistics for creators
     */
    calculateCreatorSummaryStats(data) {
        const totalCreators = data.length;

        console.log('=== Creator Summary Stats Calculation ===');
        console.log(`Total creators (after cleaning): ${totalCreators}`);

        // Sample first 5 creators to verify data structure
        if (data.length > 0) {
            console.log('Sample creator data (first 5):');
            data.slice(0, 5).forEach((creator, idx) => {
                console.log(`Creator ${idx + 1}:`, {
                    email: creator.email,
                    username: creator.creatorUsername,
                    type: creator.type,
                    totalCopies: creator.totalCopies,
                    totalSubscriptions: creator.totalSubscriptions
                });
            });
        }

        // Creator type breakdown
        const creatorTypes = {};
        data.forEach(creator => {
            // Check both 'type' (from raw_data) and 'creatorType' (legacy) fields
            const type = creator.type || creator.creatorType || 'Regular';
            creatorTypes[type] = (creatorTypes[type] || 0) + 1;
        });

        console.log('Creator type breakdown:', creatorTypes);
        console.log(`  - Regular: ${creatorTypes['Regular'] || 0}`);
        console.log(`  - Premium: ${creatorTypes['Premium'] || 0}`);
        console.log(`  - Other types:`, Object.keys(creatorTypes).filter(k => k !== 'Regular' && k !== 'Premium'));

        // Subscription price distribution
        const subscriptionPrices = {};
        data.forEach(creator => {
            if (creator.totalSubscriptions > 0 && creator.subscriptionPrice > 0) {
                const price = creator.subscriptionPrice;
                subscriptionPrices[price] = (subscriptionPrices[price] || 0) + 1;
            }
        });

        // Copy distribution
        const creatorsWithCopies = data.filter(c => c.totalCopies > 0).length;
        const creatorsWithSubscriptions = data.filter(c => c.totalSubscriptions > 0).length;

        console.log(`Creators with copies: ${creatorsWithCopies}`);
        console.log(`Creators with subscriptions: ${creatorsWithSubscriptions}`);

        return {
            totalCreators,
            creatorTypes,
            subscriptionPrices,
            creatorsWithCopies,
            creatorsWithSubscriptions,
            copyConversion: (creatorsWithCopies / totalCreators) * 100,
            subscriptionConversion: (creatorsWithSubscriptions / totalCreators) * 100
        };
    }

    /**
     * Calculate correlations for creator variables (dynamic from raw_data)
     */
    calculateCorrelations(data) {
        console.log('=== Correlation Calculation ===');
        console.log(`Input data length: ${data ? data.length : 0}`);

        if (!data || data.length === 0) {
            console.log('No data for correlation analysis');
            return {
                totalCopies: {},
                totalSubscriptions: {}
            };
        }

        // Dynamically detect all numeric variables from the first row
        const firstRow = data[0];
        const allKeys = Object.keys(firstRow);

        console.log(`All keys in first row (${allKeys.length}):`, allKeys);

        // Exclude non-numeric and identifier fields
        const excludedKeys = ['email', 'creatorUsername', 'type', 'totalCopies', 'totalSubscriptions'];

        // Get all numeric variables that have at least some variation
        const variables = allKeys.filter(key => {
            if (excludedKeys.includes(key)) return false;

            // Check if this field has numeric values with variation
            const values = data.map(d => d[key] || 0);
            const hasVariation = new Set(values).size > 1;
            const isNumeric = values.every(v => typeof v === 'number' || !isNaN(v));

            return isNumeric && hasVariation;
        });

        console.log(`Found ${variables.length} numeric variables for correlation analysis:`, variables.slice(0, 10));
        if (variables.length === 0) {
            console.warn('⚠️ No numeric variables found for correlation analysis!');
        }

        const correlations = {};

        // Pre-extract all variable arrays
        const variableArrays = {};
        ['totalCopies', 'totalSubscriptions'].concat(variables).forEach(varName => {
            variableArrays[varName] = data.map(d => d[varName] || 0);
        });

        // Calculate correlations for both outcome variables
        ['totalCopies', 'totalSubscriptions'].forEach(outcome => {
            correlations[outcome] = {};
            variables.forEach(variable => {
                if (variable !== outcome) {
                    correlations[outcome][variable] = this.calculateCorrelation(
                        variableArrays[outcome],
                        variableArrays[variable]
                    );
                }
            });
        });

        return correlations;
    }

    /**
     * Calculate correlation between two arrays
     */
    calculateCorrelation(x, y) {
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

    /**
     * Perform regression analysis
     */
    performRegression(data, outcome, correlations) {
        // Safety check: ensure correlations and correlations[outcome] exist
        if (!correlations || !correlations[outcome]) {
            console.warn(`No correlation data found for outcome: ${outcome}`);
            return [];
        }

        const variables = Object.keys(correlations[outcome]);
        const n = data.length;

        const results = variables.map(variable => {
            const correlation = correlations[outcome][variable];

            let tStat = 0;
            if (Math.abs(correlation) > 0.001 && n > 2) {
                const denominator = 1 - (correlation * correlation);
                if (denominator > 0.001) {
                    tStat = correlation * Math.sqrt((n - 2) / denominator);
                }
            }

            return {
                variable: variable,
                correlation: correlation,
                tStat: tStat,
                significant: Math.abs(tStat) > 1.96
            };
        });

        return results.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
    }

    /**
     * Calculate tipping points for all variables
     */
    calculateAllTippingPoints(cleanData, correlationResults) {
        const tippingPoints = {};

        ['totalCopies', 'totalSubscriptions'].forEach(outcome => {
            tippingPoints[outcome] = {};

            const variables = Object.keys(correlationResults[outcome]);
            variables.forEach(variable => {
                if (variable !== outcome) {
                    tippingPoints[outcome][variable] = this.calculateTippingPoint(cleanData, variable, outcome);
                }
            });
        });

        return tippingPoints;
    }

    /**
     * Calculate tipping point for a variable
     */
    calculateTippingPoint(data, variable, outcome) {
        const groups = {};
        data.forEach(creator => {
            const value = Math.floor(creator[variable]) || 0;
            const converted = creator[outcome] > 0 ? 1 : 0;

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
            .filter(item => item.total >= 5)
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
            <div id="creatorBehavioralAnalysisInline"></div>
        `;

        // Display results
        this.displayCreatorSummaryStats(results.summaryStats);
        this.displayCreatorBreakdown(results.summaryStats);

        const tippingPoints = analysisData.tippingPoints;
        this.displayCreatorBehavioralAnalysis(results.correlationResults, results.regressionResults, tippingPoints);

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
     * Display creator behavioral analysis
     */
    displayCreatorBehavioralAnalysis(correlationResults, regressionResults, tippingPoints) {
        console.log('=== Displaying Behavioral Analysis ===');
        console.log('Correlation results:', correlationResults);
        console.log('Regression results:', regressionResults);
        console.log('Tipping points:', tippingPoints);

        const container = document.getElementById('creatorBehavioralAnalysisInline');
        if (!container) {
            console.error('❌ Container creatorBehavioralAnalysisInline not found!');
            return;
        }
        container.innerHTML = '';

        const outcomes = [
            { outcome: 'totalCopies', label: 'Top Portfolio Copy Drivers', key: 'copies' }
            // { outcome: 'totalSubscriptions', label: 'Top Subscription Drivers', key: 'subscriptions' }
        ];

        outcomes.forEach((config, index) => {
            console.log(`Processing outcome: ${config.outcome}`);

            if (!correlationResults[config.outcome]) {
                console.warn(`⚠️ No correlation results for ${config.outcome}`);
                return;
            }

            const correlationKeys = Object.keys(correlationResults[config.outcome]);
            console.log(`  - Found ${correlationKeys.length} variables with correlations`);
            // Create a separate section for each outcome
            const outcomeSection = document.createElement('div');
            outcomeSection.className = 'qda-result-section';
            outcomeSection.style.cssText = index === 0 ? 'margin-top: 3rem;' : 'margin-top: 3rem;';

            // Add H2 section header with tooltip
            const sectionTitle = document.createElement('h2');
            sectionTitle.style.cssText = 'margin-top: 0; margin-bottom: 0.5rem; display: inline;';
            sectionTitle.textContent = config.label;
            outcomeSection.appendChild(sectionTitle);

            // Add tooltip next to H2
            const tooltipHTML = `<span class="info-tooltip" style="vertical-align: middle; margin-left: 8px;">
                <span class="info-icon">i</span>
                <span class="tooltip-text">
                    <strong>Creator Behavioral Analysis</strong>
                    Statistical correlation and regression analysis to identify key creator metrics:
                    <ul>
                        <li><strong>Method:</strong> Pearson correlation coefficient with t-statistic significance testing</li>
                        <li><strong>Variables:</strong> Profile views, PDP views, paywall views, stripe views, subscription revenue, cancellations, expirations, investment count, investment amount</li>
                        <li><strong>Significance:</strong> t-statistic > 1.96 indicates 95% confidence level</li>
                        <li><strong>Predictive Strength:</strong> Two-stage scoring: (1) Statistical significance, (2) Weighted score = Correlation (90%) + T-stat (10%)</li>
                        <li><strong>Tipping Points:</strong> Identifies threshold values where conversion rates significantly increase</li>
                    </ul>
                    Results sorted by absolute correlation strength.
                </span>
            </span>`;

            const tooltipSpan = document.createElement('span');
            tooltipSpan.innerHTML = tooltipHTML;
            outcomeSection.appendChild(tooltipSpan);

            const allVariables = Object.keys(correlationResults[config.outcome]);
            const regressionData = regressionResults[config.key];

            const combinedData = allVariables.map(variable => {
                const correlation = correlationResults[config.outcome][variable];
                const regressionItem = regressionData.find(item => item.variable === variable);

                let tippingPoint = 'N/A';
                if (tippingPoints && tippingPoints[config.outcome] && tippingPoints[config.outcome][variable]) {
                    tippingPoint = tippingPoints[config.outcome][variable];
                }

                return {
                    variable: variable,
                    correlation: correlation,
                    tStat: regressionItem ? regressionItem.tStat : 0,
                    tippingPoint: tippingPoint
                };
            }).sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));

            // Calculate predictive strength
            combinedData.forEach(item => {
                const result = this.calculatePredictiveStrength(item.correlation, item.tStat);
                item.predictiveStrength = result.strength;
                item.predictiveClass = result.className;
            });

            const table = this.createBehavioralTable(combinedData);

            // Wrap table in scrollable container for mobile
            const tableWrapper = document.createElement('div');
            tableWrapper.className = 'table-wrapper';
            tableWrapper.appendChild(table);

            outcomeSection.appendChild(tableWrapper);

            container.appendChild(outcomeSection);
        });
    }

    /**
     * Create subscription price table
     */
    createSubscriptionPriceTable(priceData) {
        const table = document.createElement('table');
        table.className = 'qda-regression-table';

        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        ['Price Point', 'Count'].forEach(header => {
            const th = document.createElement('th');
            th.textContent = header;
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        Object.entries(priceData)
            .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))
            .forEach(([price, count]) => {
                const row = document.createElement('tr');
                const priceCell = document.createElement('td');
                priceCell.textContent = `$${parseFloat(price).toFixed(2)}`;
                row.appendChild(priceCell);

                const countCell = document.createElement('td');
                countCell.textContent = count;
                row.appendChild(countCell);

                tbody.appendChild(row);
            });

        table.appendChild(tbody);
        return table;
    }

    /**
     * Create behavioral analysis table
     */
    createBehavioralTable(data) {
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
                    The "magic number" threshold where creator behavior changes significantly:
                    <ul>
                        <li>Identifies the value where the largest jump in conversion rate occurs</li>
                        <li>Only considers groups with 10+ creators and >10% conversion rate</li>
                        <li>Represents the minimum exposure needed for behavioral change</li>
                    </ul>
                    Example: If tipping point is 5, creators with 5+ exposures convert at much higher rates.`
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
        data.slice(0, 15).forEach(item => {
            const row = document.createElement('tr');

            const varCell = document.createElement('td');
            varCell.textContent = this.getVariableLabel(item.variable);
            row.appendChild(varCell);

            const corrCell = document.createElement('td');
            corrCell.textContent = item.correlation.toFixed(2);
            row.appendChild(corrCell);

            const tStatCell = document.createElement('td');
            tStatCell.textContent = item.tStat.toFixed(2);
            row.appendChild(tStatCell);

            const strengthCell = document.createElement('td');
            const strengthSpan = document.createElement('span');
            strengthSpan.className = item.predictiveClass;
            strengthSpan.textContent = item.predictiveStrength;
            strengthCell.appendChild(strengthSpan);
            row.appendChild(strengthCell);

            const tippingCell = document.createElement('td');
            tippingCell.textContent = item.tippingPoint !== 'N/A' ?
                (typeof item.tippingPoint === 'number' ? item.tippingPoint.toFixed(1) : item.tippingPoint) :
                'N/A';
            row.appendChild(tippingCell);

            tbody.appendChild(row);
        });

        table.appendChild(tbody);
        return table;
    }

    /**
     * Get variable label for display
     */
    getVariableLabel(variable) {
        // Convert camelCase to Title Case (e.g., totalProfileViews -> Total Profile Views)
        return variable.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
    }

    /**
     * Calculate predictive strength
     * Note: Implementation moved to analysis_utils.js for shared use across tools
     */
    calculatePredictiveStrength(correlation, tStat) {
        return window.calculatePredictiveStrength(correlation, tStat);
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
            const CACHE_VERSION = '2.3'; // Updated for optimized edge functions
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
