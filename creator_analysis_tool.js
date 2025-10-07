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

        section.appendChild(buttonContainer);

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
            }
        } catch (error) {
            this.addStatusMessage(`❌ Error: ${error.message}`, 'error');
            console.error('Workflow error:', error);
        }
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

        // Hide progress bar after completion
        setTimeout(() => {
            document.getElementById('creatorProgressSection').style.display = 'none';
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
        return parsedData.data.map(row => ({
            // Identifiers
            creatorId: row['creator_id'] || '',
            creatorUsername: row['creator_username'] || '',
            creatorType: row['creator_type'] || 'Regular',

            // All 11 metrics from Insights by Creators chart
            totalProfileViews: this.cleanNumeric(row['total_profile_views']),
            totalPDPViews: this.cleanNumeric(row['total_pdp_views']),
            totalPaywallViews: this.cleanNumeric(row['total_paywall_views']),
            totalStripeViews: this.cleanNumeric(row['total_stripe_views']),
            totalSubscriptions: this.cleanNumeric(row['total_subscriptions']),
            totalSubscriptionRevenue: this.cleanNumeric(row['total_subscription_revenue']),
            totalCancelledSubscriptions: this.cleanNumeric(row['total_cancelled_subscriptions']),
            totalExpiredSubscriptions: this.cleanNumeric(row['total_expired_subscriptions']),
            totalCopies: this.cleanNumeric(row['total_copies']),
            totalInvestmentCount: this.cleanNumeric(row['total_investment_count']),
            totalInvestments: this.cleanNumeric(row['total_investments'])
        })).filter(row => row.creatorId);
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

        // Creator type breakdown
        const creatorTypes = {};
        data.forEach(creator => {
            const type = creator.creatorType || 'Regular';
            creatorTypes[type] = (creatorTypes[type] || 0) + 1;
        });

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
     * Calculate correlations for creator variables
     */
    calculateCorrelations(data) {
        // All 11 metrics from Insights by Creators chart
        // Note: We exclude totalCopies and totalSubscriptions since they are the outcome variables
        const variables = [
            'totalProfileViews',
            'totalPDPViews',
            'totalPaywallViews',
            'totalStripeViews',
            'totalSubscriptionRevenue',
            'totalCancelledSubscriptions',
            'totalExpiredSubscriptions',
            'totalInvestmentCount',
            'totalInvestments'
        ];

        const correlations = {};

        // Pre-extract all variable arrays
        const variableArrays = {};
        ['totalCopies', 'totalSubscriptions'].concat(variables).forEach(varName => {
            variableArrays[varName] = data.map(d => d[varName]);
        });

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
        const container = document.getElementById('creatorSummaryStatsInline');
        container.innerHTML = '';

        const section = document.createElement('div');
        section.className = 'qda-result-section';

        const title = document.createElement('h1');
        title.textContent = 'Summary Statistics';
        section.appendChild(title);

        const metricSummary = document.createElement('div');
        metricSummary.className = 'qda-metric-summary';

        // Core metrics
        const metrics = [
            ['Total Creators', stats.totalCreators.toLocaleString(), '18px'],
            ['Core Creators', (stats.creatorTypes['Regular'] || 0).toLocaleString(), '18px'],
            ['Premium Creators', (stats.creatorTypes['Premium'] || 0).toLocaleString(), '18px']
        ];

        metrics.forEach(([title, content, size]) => {
            metricSummary.appendChild(this.createMetricCard(title, content, size));
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
            section.appendChild(priceTable);
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
        const container = document.getElementById('creatorBehavioralAnalysisInline');
        container.innerHTML = '';

        const section = document.createElement('div');
        section.className = 'qda-result-section';

        const title = document.createElement('h1');
        title.textContent = 'Behavioral Analysis';
        section.appendChild(title);

        const outcomes = [
            { outcome: 'totalCopies', label: 'Portfolio Copies', key: 'copies' },
            { outcome: 'totalSubscriptions', label: 'Subscriptions', key: 'subscriptions' }
        ];

        outcomes.forEach(config => {
            const outcomeTitle = document.createElement('h4');
            outcomeTitle.textContent = config.label;
            section.appendChild(outcomeTitle);

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
            section.appendChild(table);
        });

        container.appendChild(section);
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
        const labels = {
            'totalProfileViews': 'Total Profile Views',
            'totalPDPViews': 'Total PDP Views',
            'totalPaywallViews': 'Total Paywall Views',
            'totalStripeViews': 'Total Stripe Views',
            'totalSubscriptionRevenue': 'Total Subscription Revenue',
            'totalCancelledSubscriptions': 'Total Cancelled Subscriptions',
            'totalExpiredSubscriptions': 'Total Expired Subscriptions',
            'totalInvestmentCount': 'Total Investment Count',
            'totalInvestments': 'Total Investments ($)'
        };

        return labels[variable] || variable.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
    }

    /**
     * Calculate predictive strength
     */
    calculatePredictiveStrength(correlation, tStat) {
        const absCorr = Math.abs(correlation);
        const absTStat = Math.abs(tStat);

        if (absTStat < 1.96) {
            return { strength: 'Very Weak', className: 'qda-strength-very-weak' };
        }

        let corrScore = 0;
        if (absCorr >= 0.50) corrScore = 6;
        else if (absCorr >= 0.30) corrScore = 5;
        else if (absCorr >= 0.20) corrScore = 4;
        else if (absCorr >= 0.10) corrScore = 3;
        else if (absCorr >= 0.05) corrScore = 2;
        else if (absCorr >= 0.02) corrScore = 1;
        else corrScore = 0;

        let tScore = 0;
        if (absTStat >= 3.29) tScore = 6;
        else if (absTStat >= 2.58) tScore = 5;
        else if (absTStat >= 1.96) tScore = 4;

        const combinedScore = (corrScore * 0.9) + (tScore * 0.1);

        if (combinedScore >= 5.5) {
            return { strength: 'Very Strong', className: 'qda-strength-very-strong' };
        } else if (combinedScore >= 4.5) {
            return { strength: 'Strong', className: 'qda-strength-strong' };
        } else if (combinedScore >= 3.5) {
            return { strength: 'Moderate - Strong', className: 'qda-strength-moderate-strong' };
        } else if (combinedScore >= 2.5) {
            return { strength: 'Moderate', className: 'qda-strength-moderate' };
        } else if (combinedScore >= 1.5) {
            return { strength: 'Weak - Moderate', className: 'qda-strength-weak-moderate' };
        } else if (combinedScore >= 0.5) {
            return { strength: 'Weak', className: 'qda-strength-weak' };
        } else {
            return { strength: 'Very Weak', className: 'qda-strength-very-weak' };
        }
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
            ${type === 'success' ? 'background: #d4edda; color: #155724;' : ''}
            ${type === 'error' ? 'background: #f8d7da; color: #721c24;' : ''}
            ${type === 'info' ? 'background: #d1ecf1; color: #0c5460;' : ''}
        `;
        messageDiv.textContent = message;
        statusSection.appendChild(messageDiv);
        statusSection.scrollTop = statusSection.scrollHeight;
    }

    showProgress(percent) {
        document.getElementById('creatorProgressSection').style.display = 'block';
        this.updateProgress(percent);
    }

    updateProgress(percent, label = null) {
        const progressBar = document.getElementById('creatorProgressBar');
        progressBar.style.width = `${percent}%`;
        progressBar.textContent = label || `${Math.round(percent)}%`;
    }
}

// Export to window
window.CreatorAnalysisTool = CreatorAnalysisTool;

console.log('✅ Creator Analysis Tool loaded successfully!');
