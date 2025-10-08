// User Analysis Tool - Supabase Version
// Extends UserAnalysisTool to use Supabase instead of GitHub Actions
// Keeps original user_analysis_tool.js intact for backward compatibility

'use strict';

/**
 * Supabase-powered version of UserAnalysisTool
 * Overrides specific methods to use Supabase Edge Functions and database
 */
class UserAnalysisToolSupabase extends UserAnalysisTool {
    constructor() {
        super();
        this.supabaseIntegration = null;
    }

    /**
     * Override: Create UI with Supabase-specific configuration
     */
    createUI(container, outputContainers) {
        // Check if Supabase is already initialized globally
        if (window.supabaseIntegration) {
            this.supabaseIntegration = window.supabaseIntegration;
        }

        // Store output containers for each tab
        this.outputContainers = outputContainers;

        // Restore cached results immediately on page load
        this.restoreAnalysisResults();

        // Call parent to create base UI (just the data source selection)
        super.createUI(container, null);
    }

    /**
     * Override: Restore cached analysis results for all tabs
     */
    restoreAnalysisResults() {
        try {
            const saved = localStorage.getItem('dubAnalysisResults');
            if (saved) {
                const data = JSON.parse(saved);
                if (this.outputContainers) {
                    // Restore cached HTML to each tab (if available)
                    if (data.summary) this.outputContainers.summary.innerHTML = data.summary;
                    if (data.portfolio) this.outputContainers.portfolio.innerHTML = data.portfolio;
                    if (data.subscription) this.outputContainers.subscription.innerHTML = data.subscription;
                    if (data.creator) this.outputContainers.creator.innerHTML = data.creator;

                    console.log('✅ Restored analysis results from', data.timestamp);
                }
            }
        } catch (e) {
            console.warn('Failed to restore analysis results from localStorage:', e);
        }
    }

    /**
     * Override: Create token section - No configuration needed since credentials are hardcoded
     */
    createTokenSection() {
        // Return empty div - no configuration UI needed
        const section = document.createElement('div');
        section.style.display = 'none';
        return section;
    }

    /**
     * Override: Trigger Supabase Edge Function instead of GitHub workflow
     */
    async triggerGitHubWorkflow() {
        if (!this.supabaseIntegration) {
            throw new Error('Supabase not configured. Please save your Supabase credentials first.');
        }

        console.log('Triggering Supabase Edge Function...');

        // Call the Edge Function (credentials stored in Supabase secrets)
        const result = await this.supabaseIntegration.triggerMixpanelSync();

        console.log('✅ Supabase sync completed:', result.stats);
        return true;
    }

    /**
     * Override: No need to poll - Edge Function is synchronous
     */
    async waitForWorkflowCompletion() {
        // Edge Function completes synchronously, no need to poll
        console.log('✅ Edge Function completed (synchronous)');
        return true;
    }

    /**
     * Override: Load data from Supabase instead of GitHub
     */
    async loadGitHubData() {
        if (!this.supabaseIntegration) {
            throw new Error('Supabase not configured. Please save your Supabase credentials first.');
        }

        console.log('Loading data from Supabase database...');

        // Load from Supabase database (returns CSV format for compatibility)
        const contents = await this.supabaseIntegration.loadDataFromSupabase();

        console.log('✅ Data loaded from Supabase');
        return contents;
    }

    /**
     * Override: Run the GitHub workflow using Supabase
     */
    async runGitHubWorkflow() {
        // Step 1: Trigger Supabase Edge Function
        this.updateProgress(15, 'Syncing data...');

        const triggered = await this.triggerGitHubWorkflow();
        if (!triggered) {
            throw new Error('Failed to trigger Supabase sync');
        }

        this.updateProgress(30, 'Loading data...');

        // Step 2: Load data from Supabase
        const contents = await this.loadGitHubData();
        this.updateProgress(50, 'Merging data...');

        // Step 3: Process and analyze data
        await this.processAndAnalyze(contents);
    }

    /**
     * Override: Full control over results display with integrated caching
     */
    async displayResults(results) {
        // Step 1: Try to restore from cache FIRST (instant display)
        const cached = localStorage.getItem('dubAnalysisResults');
        if (cached) {
            try {
                const data = JSON.parse(cached);
                if (data.timestamp) {
                    // Restore cached HTML to each tab (if available)
                    if (data.summary) this.outputContainers.summary.innerHTML = data.summary;
                    if (data.portfolio) this.outputContainers.portfolio.innerHTML = data.portfolio;
                    if (data.subscription) this.outputContainers.subscription.innerHTML = data.subscription;
                    if (data.creator) this.outputContainers.creator.innerHTML = data.creator;

                    const cacheAge = Math.floor((Date.now() - new Date(data.timestamp).getTime()) / 60000);
                    console.log(`✅ Restored complete analysis from cache (${cacheAge} min ago)`);
                    // Fall through to rebuild with fresh data
                }
            } catch (e) {
                console.warn('Failed to restore from cache, rebuilding:', e);
            }
        }

        // Step 2: Build complete HTML with fresh data (modifies DOM directly)
        await this.buildCompleteHTML(results);

        // Step 3: Cache complete rendered HTML for all tabs
        try {
            localStorage.setItem('dubAnalysisResults', JSON.stringify({
                summary: this.outputContainers.summary.innerHTML,
                portfolio: this.outputContainers.portfolio.innerHTML,
                subscription: this.outputContainers.subscription.innerHTML,
                creator: this.outputContainers.creator.innerHTML,
                timestamp: new Date().toISOString()
            }));
            console.log('✅ Cached complete analysis for all tabs');
        } catch (error) {
            console.warn('Failed to cache:', error);
        }
    }

    /**
     * Build complete HTML including all analysis sections
     * Now renders to separate main tab containers instead of nested tabs
     */
    async buildCompleteHTML(results) {
        // Clear combination cache to ensure fresh data after analysis runs
        this.supabaseIntegration.clearCombinationCache();

        // Load all engagement data in parallel with base analysis
        const [
            engagementSummary,
            topSubscriptionCombos,
            hiddenGems,
            hiddenGemsSummary,
            copyEngagementSummary,
            topCopyCombos,
            subscriptionDistribution
            // topSequences // COMMENTED OUT: Portfolio sequence analysis temporarily disabled
        ] = await Promise.all([
            this.supabaseIntegration.loadEngagementSummary().catch(e => { console.warn('Failed to load engagement summary:', e); return null; }),
            this.supabaseIntegration.loadTopSubscriptionCombinations('expected_value', 10, 3).catch(e => { console.warn('Failed to load subscription combos:', e); return []; }),
            this.supabaseIntegration.loadHiddenGems().catch(e => { console.warn('Failed to load hidden gems:', e); return []; }),
            this.supabaseIntegration.loadHiddenGemsSummary().catch(e => { console.warn('Failed to load hidden gems summary:', e); return null; }),
            this.supabaseIntegration.loadCopyEngagementSummary().catch(e => { console.warn('Failed to load copy engagement summary:', e); return null; }),
            this.supabaseIntegration.loadTopCopyCombinations('expected_value', 10, 3).catch(e => { console.warn('Failed to load copy combos:', e); return []; }),
            this.supabaseIntegration.loadSubscriptionDistribution().catch(e => { console.warn('Failed to load subscription distribution:', e); return []; })
            // this.supabaseIntegration.loadTopPortfolioSequenceCombinations('expected_value', 10, 3).catch(e => { console.warn('Failed to load sequences:', e); return []; }) // COMMENTED OUT
        ]);
        const topSequences = []; // Empty array for now

        // === SUMMARY TAB ===
        const summaryContainer = this.outputContainers.summary;
        summaryContainer.innerHTML = `
            <div class="qda-analysis-results">
                <div id="qdaSummaryStatsInline"></div>
                <div id="qdaDemographicBreakdownInline"></div>
                <div id="qdaPersonaBreakdownInline"></div>
            </div>
        `;

        displaySummaryStatsInline(results.summaryStats);
        displayDemographicBreakdownInline(results.summaryStats);
        displayPersonaBreakdownInline(results.summaryStats);

        // Load tipping points for correlation analysis
        const analysisData = JSON.parse(localStorage.getItem('qdaAnalysisResults') || 'null');
        const tippingPoints = analysisData?.tippingPoints || JSON.parse(localStorage.getItem('qdaTippingPoints') || 'null');

        // Transform correlationResults from object to array format expected by render functions
        const correlationArray = [
            { outcome: 'totalCopies', variables: results.correlationResults.totalCopies },
            { outcome: 'totalDeposits', variables: results.correlationResults.totalDeposits },
            { outcome: 'totalSubscriptions', variables: results.correlationResults.totalSubscriptions }
        ];

        // === PORTFOLIO TAB ===
        const portfolioContainer = this.outputContainers.portfolio;
        portfolioContainer.innerHTML = `
            <div class="qda-analysis-results">
                <div id="portfolioHeaderSection"></div>
                <div id="portfolioContentSection"></div>
            </div>
        `;

        // Add Portfolio Analysis H1 Header
        const portfolioHeaderSection = document.getElementById('portfolioHeaderSection');
        portfolioHeaderSection.innerHTML = `
            <div class="qda-result-section">
                <h1>Portfolio Analysis</h1>
            </div>
        `;

        // Build Portfolio Content Section
        const portfolioContentSection = document.getElementById('portfolioContentSection');

        if (results.correlationResults?.totalCopies && results.regressionResults?.copies) {
            // Add Portfolio Copies Section FIRST
            const metricsHTML = this.generateCopyMetricsHTML(copyEngagementSummary);
            const hiddenGemsHTML = this.generateHiddenGemsHTML(hiddenGemsSummary, hiddenGems);
            const combinationsHTML = this.generateCopyCombinationsHTML(topCopyCombos);
            // const portfolioSequencesHTML = this.generatePortfolioSequencesHTML(topSequences); // COMMENTED OUT

            const copiesHTML = `
                <div class="qda-result-section">
                    ${metricsHTML}
                    ${hiddenGemsHTML}
                </div>
            `;
            portfolioContentSection.insertAdjacentHTML('beforeend', copiesHTML);

            // Add Deposit Funds Section AFTER Hidden Gems and Combinations
            if (results.correlationResults?.totalDeposits && results.regressionResults?.deposits) {
                const depositHeaderHTML = this.generateCorrelationHeaderHTML('Top Deposit Funds Drivers', 'The top events that are the strongest predictors of deposits');
                const depositHTML = `
                    <div class="qda-result-section" style="margin-top: 2rem;">
                        ${depositHeaderHTML}
                    </div>
                `;
                portfolioContentSection.insertAdjacentHTML('beforeend', depositHTML);

                try {
                    const depositsTable = this.buildCorrelationTable(results.correlationResults.totalDeposits, results.regressionResults.deposits, 'deposits', tippingPoints);
                    const depositSection = portfolioContentSection.querySelector('.qda-result-section:last-child');
                    depositSection.appendChild(depositsTable);
                } catch (e) {
                    console.error('Error building deposits table:', e);
                    const depositSection = portfolioContentSection.querySelector('.qda-result-section:last-child');
                    depositSection.innerHTML += '<p style="color: #dc3545;">Error displaying deposit analysis. Please try syncing again.</p>';
                }
            }

            // Add Top Portfolio Copy Drivers Section LAST
            const correlationHeaderHTML = this.generateCorrelationHeaderHTML('Top Portfolio Copy Drivers', 'The top events that are the strongest predictors of copies');
            const copyDriversHTML = `
                <div class="qda-result-section" style="margin-top: 2rem;">
                    ${correlationHeaderHTML}
                </div>
            `;
            portfolioContentSection.insertAdjacentHTML('beforeend', copyDriversHTML);

            try {
                const copiesTable = this.buildCorrelationTable(results.correlationResults.totalCopies, results.regressionResults.copies, 'copies', tippingPoints);
                const copyDriversSection = portfolioContentSection.querySelector('.qda-result-section:last-child');
                copyDriversSection.appendChild(copiesTable);

                // Add combinations after Portfolio Copy Drivers table
                copyDriversSection.insertAdjacentHTML('beforeend', combinationsHTML);
            } catch (e) {
                console.error('Error building portfolio copies table:', e);
                const copyDriversSection = portfolioContentSection.querySelector('.qda-result-section:last-child');
                copyDriversSection.innerHTML += '<p style="color: #dc3545;">Error displaying portfolio copy analysis. Please try syncing again.</p>';
            }
        } else {
            portfolioContentSection.innerHTML = `
                <div class="qda-result-section">
                    <p style="color: #6c757d; font-style: italic;">Portfolio analysis data will be available after syncing.</p>
                </div>
            `;
        }

        // === SUBSCRIPTION TAB ===
        const subscriptionContainer = this.outputContainers.subscription;
        subscriptionContainer.innerHTML = `
            <div class="qda-analysis-results">
                <div id="subscriptionAnalysisSection"></div>
            </div>
        `;

        // Build Subscriptions Section with all enhancements
        const subscriptionSection = document.getElementById('subscriptionAnalysisSection');

        // Check if subscription data exists
        if (results.correlationResults?.totalSubscriptions && results.regressionResults?.subscriptions) {
            const subMetricsHTML = this.generateSubscriptionMetricsHTML(engagementSummary);

            // Build price distribution HTML from loaded subscription distribution data
            let priceDistributionHTML = '';
            if (subscriptionDistribution && subscriptionDistribution.length > 0) {
                // Convert loaded data to format expected by table generation
                const priceData = {};
                subscriptionDistribution.forEach(row => {
                    // Use monthly_price as the key and total_subscriptions as the count
                    const price = parseFloat(row.monthly_price || row.subscription_price);
                    priceData[price] = (priceData[price] || 0) + (row.total_subscriptions || 0);
                });

                const priceTableHTML = this.createSubscriptionPriceTableHTML(priceData);
                priceDistributionHTML = `
                    <h2 style="margin-top: 1.5rem; margin-bottom: 0.25rem;">Subscription Price Distribution</h2>
                    ${priceTableHTML}
                `;
            } else {
                priceDistributionHTML = `
                    <h2 style="margin-top: 1.5rem; margin-bottom: 0.25rem;">Subscription Price Distribution</h2>
                    <p style="color: #6c757d; font-style: italic;">No subscription price data available. Please run "Sync Creator Data" to fetch this data.</p>
                `;
            }

            const subCorrelationHeaderHTML = this.generateCorrelationHeaderHTML('Top Subscription Drivers', 'The top events that are the strongest predictors of subscriptions');
            const subCombinationsHTML = this.generateSubscriptionCombinationsHTML(topSubscriptionCombos);

            subscriptionSection.innerHTML = `
                <div class="qda-result-section">
                    <h1>Subscription Analysis</h1>
                    ${subMetricsHTML}
                    ${priceDistributionHTML}
                    ${subCorrelationHeaderHTML}
                </div>
            `;

            try {
                const subscriptionsTable = this.buildCorrelationTable(results.correlationResults.totalSubscriptions, results.regressionResults.subscriptions, 'subscriptions', tippingPoints);
                subscriptionSection.querySelector('.qda-result-section').appendChild(subscriptionsTable);
                subscriptionSection.querySelector('.qda-result-section').insertAdjacentHTML('beforeend', subCombinationsHTML);
            } catch (e) {
                console.error('Error building subscriptions table:', e);
                subscriptionSection.querySelector('.qda-result-section').innerHTML += '<p style="color: #dc3545;">Error displaying subscription analysis. Please try syncing again.</p>';
            }
        } else {
            subscriptionSection.innerHTML = `
                <div class="qda-result-section">
                    <h1>Subscription Analysis</h1>
                    <p style="color: #6c757d; font-style: italic;">Subscription analysis data will be available after syncing.</p>
                </div>
            `;
        }

        // === CREATOR TAB ===
        const creatorContainer = this.outputContainers.creator;

        // Load and display creator analysis data
        try {
            const creatorData = await this.supabaseIntegration.loadCreatorDataFromSupabase();
            if (creatorData && creatorData.length > 0) {
                // Process creator data
                const creatorResults = await this.processCreatorData(creatorData[0]);

                if (creatorResults && creatorResults.summaryStats) {
                    // Set up container structure
                    creatorContainer.innerHTML = `
                        <div class="qda-analysis-results">
                            <div id="creatorSummarySection"></div>
                        </div>
                    `;

                    // Display Summary Stats (3 metric cards only)
                    const summarySection = document.getElementById('creatorSummarySection');
                    const stats = creatorResults.summaryStats;

                    summarySection.innerHTML = `
                        <div class="qda-result-section">
                            <h1>Summary Statistics</h1>
                            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 2rem; margin-top: 1.5rem;">
                                ${this.createMetricCardHTML('Total Creators', stats.totalCreators.toLocaleString())}
                                ${this.createMetricCardHTML('Core Creators', (stats.creatorTypes['Regular'] || 0).toLocaleString())}
                                ${this.createMetricCardHTML('Premium Creators', (stats.creatorTypes['Premium'] || 0).toLocaleString())}
                            </div>
                        </div>
                    `;
                } else {
                    creatorContainer.innerHTML = `
                        <div class="qda-analysis-results">
                            <p style="color: #6c757d; font-style: italic; text-align: center; padding: 60px 20px;">
                                Creator analysis data will be available after syncing.
                            </p>
                        </div>
                    `;
                }
            } else {
                // No data available
                creatorContainer.innerHTML = `
                    <div class="qda-analysis-results">
                        <p style="color: #6c757d; font-style: italic; text-align: center; padding: 60px 20px;">
                            Creator analysis data will be available after syncing.
                        </p>
                    </div>
                `;
            }
        } catch (e) {
            console.warn('Failed to load creator analysis:', e);
            creatorContainer.innerHTML = `
                <div class="qda-analysis-results">
                    <p style="color: #6c757d; font-style: italic; text-align: center; padding: 60px 20px;">
                        Creator analysis data will be available after syncing.
                    </p>
                </div>
            `;
        }

        // Add timestamp to all tabs
        const timestampStr = new Date().toLocaleString('en-US', {
            month: 'numeric',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
        localStorage.setItem('qdaLastUpdated', timestampStr);

        [summaryContainer, portfolioContainer, subscriptionContainer, creatorContainer].forEach(container => {
            const timestamp = document.createElement('div');
            timestamp.className = 'qda-timestamp';
            timestamp.textContent = `Last updated: ${timestampStr}`;
            const resultsDiv = container.querySelector('.qda-analysis-results');
            if (resultsDiv) {
                resultsDiv.insertBefore(timestamp, resultsDiv.firstChild);
            }
        });
    }

    /**
     * Generate Subscription Metrics HTML (inserted before correlation table)
     * Uses array.join() for optimal string building performance
     */
    generateSubscriptionMetricsHTML(summaryData) {
        if (!summaryData || summaryData.length !== 2) {
            return '';
        }

        const subscribersData = summaryData.find(d => d.did_subscribe === true) || {};
        const nonSubscribersData = summaryData.find(d => d.did_subscribe === false) || {};

        const metrics = [
            { label: 'Avg Profile Views', primaryValue: subscribersData.avg_profile_views || 0, secondaryValue: nonSubscribersData.avg_profile_views || 0 },
            { label: 'Avg PDP Views', primaryValue: subscribersData.avg_pdp_views || 0, secondaryValue: nonSubscribersData.avg_pdp_views || 0 },
            { label: 'Unique Creators', primaryValue: subscribersData.avg_unique_creators || 0, secondaryValue: nonSubscribersData.avg_unique_creators || 0 },
            { label: 'Unique Portfolios', primaryValue: subscribersData.avg_unique_portfolios || 0, secondaryValue: nonSubscribersData.avg_unique_portfolios || 0 }
        ];

        const parts = [
            '<div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 2rem; margin-top: 1.5rem;">'
        ];

        metrics.forEach(metric => {
            parts.push(
                `<div style="background-color: #f8f9fa; padding: 1rem; border-radius: 8px;">
                    <div style="font-size: 0.875rem; color: #2563eb; font-weight: 600; margin-bottom: 0.5rem;">${metric.label}</div>
                    <div style="font-size: 1.5rem; font-weight: bold;">
                        ${parseFloat(metric.primaryValue).toFixed(1)}
                        <span style="font-size: 0.9rem; color: #6c757d; font-weight: normal;">vs ${parseFloat(metric.secondaryValue).toFixed(1)}</span>
                    </div>
                </div>`
            );
        });

        parts.push('</div>');
        return parts.join('');
    }

    /**
     * Generate Subscription Combinations HTML (inserted after correlation table)
     * Uses array.join() for optimal string building performance
     */
    generateSubscriptionCombinationsHTML(topCombinations) {
        if (!topCombinations || topCombinations.length === 0) {
            return '';
        }

        const tooltipHTML = `<span class="info-tooltip">
            <span class="info-icon">i</span>
            <span class="tooltip-text">
                <strong>High-Impact Creator Combinations</strong>
                Identifies 3-creator combinations that drive subscriptions:
                <ul>
                    <li><strong>Method:</strong> Logistic regression with Newton-Raphson optimization</li>
                    <li><strong>Filters:</strong> Min 3 users exposed per combination, max 200 creators analyzed</li>
                    <li><strong>Ranking:</strong> By Expected Value (Lift × Total Conversions) - balances impact and volume</li>
                    <li><strong>Metrics:</strong> Lift (impact multiplier), odds ratio, precision, recall</li>
                </ul>
                Shows top 10 combinations sorted by Expected Value. Users must view ALL 3 creators to be counted as "exposed."
            </span>
        </span>`;

        const parts = [
            '<div class="qda-result-section" style="margin-top: 2rem;">',
            this.generateCombinationsTableHTML(
                `High-Impact Creator Combinations${tooltipHTML}`,
                'Users who viewed these creator combinations were significantly more likely to subscribe',
                topCombinations,
                (combo) => `${combo.username_1 || combo.value_1}, ${combo.username_2 || combo.value_2}, ${combo.username_3 || combo.value_3}`,
                'Creators Viewed',
                'Total Subs'
            ),
            '</div>'
        ];

        return parts.join('');
    }

    /**
     * Generate Hidden Gems HTML
     * Uses array.join() for optimal string building performance
     */
    generateHiddenGemsHTML(summaryData, hiddenGems) {
        if (!summaryData && (!hiddenGems || hiddenGems.length === 0)) {
            return '';
        }

        const tooltipHTML = `<span class="info-tooltip">
            <span class="info-icon">i</span>
            <span class="tooltip-text">
                <strong>Hidden Gems</strong>
                Portfolios attracting attention but not yet frequently copied:
                <ul>
                    <li><strong>Criteria:</strong> ≥10 total PDP views, ≥5:1 views-to-copies ratio, ≤100 total copies</li>
                    <li><strong>Data Source:</strong> portfolio_creator_engagement_metrics materialized view</li>
                    <li><strong>Ranking:</strong> By total PDP views (descending)</li>
                    <li><strong>Limit:</strong> Top 10 portfolios shown</li>
                </ul>
                These portfolios show potential for growth opportunities.
            </span>
        </span>`;

        const parts = [
            '<div class="qda-result-section" style="margin-top: 2rem;">',
            `<h2 style="margin-top: 1.5rem; margin-bottom: 0.25rem;">Hidden Gems${tooltipHTML}</h2>`,
            '<p style="font-size: 0.875rem; color: #6c757d; margin-top: 0; margin-bottom: 1rem;">Portfolios with high engagement but low conversion (Total PDP Views to Copies ratio ≥ 5:1, max 100 copies)</p>'
        ];

        // Summary Stats
        if (summaryData) {
            parts.push('<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-bottom: 2rem;">');

            const metrics = [
                { label: 'Total Hidden Gems', value: summaryData.total_hidden_gems || 0, format: 'number' },
                { label: 'Avg Total PDP Views', value: summaryData.avg_pdp_views || 0, format: 'decimal' },
                { label: 'Avg Conversion Rate', value: summaryData.avg_conversion_rate || 0, format: 'percent' }
            ];

            metrics.forEach(metric => {
                let displayValue = '';
                if (metric.format === 'number') {
                    displayValue = parseInt(metric.value).toLocaleString();
                } else if (metric.format === 'decimal') {
                    displayValue = parseFloat(metric.value).toFixed(1);
                } else if (metric.format === 'percent') {
                    displayValue = parseFloat(metric.value).toFixed(2) + '%';
                }

                parts.push(
                    `<div style="background-color: #f8f9fa; padding: 1rem; border-radius: 8px;">
                        <div style="font-size: 0.875rem; color: #2563eb; font-weight: 600; margin-bottom: 0.5rem;">${metric.label}</div>
                        <div style="font-size: 1.5rem; font-weight: bold;">${displayValue}</div>
                    </div>`
                );
            });

            parts.push('</div>');
        }

        // Hidden Gems Table
        const topHiddenGems = hiddenGems && hiddenGems.length > 0 ? hiddenGems.slice(0, 10) : [];

        if (topHiddenGems.length > 0) {
            parts.push(
                '<table style="width: 100%; border-collapse: collapse; margin-top: 1rem; font-size: 0.85rem; font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;">',
                `<thead>
                    <tr style="background-color: #f8f9fa; border-bottom: 2px solid #dee2e6;">
                        <th style="padding: 0.75rem; text-align: left;">Portfolio</th>
                        <th style="padding: 0.75rem; text-align: left;">Creator</th>
                        <th style="padding: 0.75rem; text-align: right;">Total PDP Views</th>
                        <th style="padding: 0.75rem; text-align: right;">Unique Views</th>
                        <th style="padding: 0.75rem; text-align: right;">Copies</th>
                        <th style="padding: 0.75rem; text-align: right;">Conv Rate</th>
                    </tr>
                </thead>
                <tbody>`
            );

            topHiddenGems.forEach((gem, index) => {
                const rowBg = index % 2 === 0 ? '#ffffff' : '#f8f9fa';
                parts.push(
                    `<tr style="border-bottom: 1px solid #dee2e6; background-color: ${rowBg};">
                        <td style="padding: 0.75rem;">${gem.portfolio_ticker || 'N/A'}</td>
                        <td style="padding: 0.75rem;">${gem.creator_username || 'N/A'}</td>
                        <td style="padding: 0.75rem; text-align: right;">${parseInt(gem.total_pdp_views).toLocaleString()}</td>
                        <td style="padding: 0.75rem; text-align: right;">${parseInt(gem.unique_views).toLocaleString()}</td>
                        <td style="padding: 0.75rem; text-align: right;">${parseInt(gem.total_copies).toLocaleString()}</td>
                        <td style="padding: 0.75rem; text-align: right;">${parseFloat(gem.conversion_rate_pct).toFixed(1)}%</td>
                    </tr>`
                );
            });

            parts.push('</tbody></table>');
        }

        parts.push('</div>');
        return parts.join('');
    }

    /**
     * Generate Copy Metrics HTML (inserted before correlation table)
     * Uses array.join() for optimal string building performance
     */
    generateCopyMetricsHTML(summaryData) {
        if (!summaryData || summaryData.length !== 2) {
            return '';
        }

        const copiersData = summaryData.find(d => d.did_copy === true) || {};
        const nonCopiersData = summaryData.find(d => d.did_copy === false) || {};

        const metrics = [
            { label: 'Avg Profile Views', primaryValue: copiersData.avg_profile_views || 0, secondaryValue: nonCopiersData.avg_profile_views || 0 },
            { label: 'Avg PDP Views', primaryValue: copiersData.avg_pdp_views || 0, secondaryValue: nonCopiersData.avg_pdp_views || 0 },
            { label: 'Unique Creators', primaryValue: copiersData.avg_unique_creators || 0, secondaryValue: nonCopiersData.avg_unique_creators || 0 },
            { label: 'Unique Portfolios', primaryValue: copiersData.avg_unique_portfolios || 0, secondaryValue: nonCopiersData.avg_unique_portfolios || 0 }
        ];

        const parts = [
            '<div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 2rem; margin-top: 1.5rem;">'
        ];

        metrics.forEach(metric => {
            parts.push(
                `<div style="background-color: #f8f9fa; padding: 1rem; border-radius: 8px;">
                    <div style="font-size: 0.875rem; color: #2563eb; font-weight: 600; margin-bottom: 0.5rem;">${metric.label}</div>
                    <div style="font-size: 1.5rem; font-weight: bold;">
                        ${parseFloat(metric.primaryValue).toFixed(1)}
                        <span style="font-size: 0.9rem; color: #6c757d; font-weight: normal;">vs ${parseFloat(metric.secondaryValue).toFixed(1)}</span>
                    </div>
                </div>`
            );
        });

        parts.push('</div>');
        return parts.join('');
    }

    /**
     * Generate Correlation Header HTML (h3 + subtitle for correlation table)
     * Uses array.join() for optimal string building performance
     */
    generateCorrelationHeaderHTML(title, subtitle) {
        const parts = [
            `<h2 style="margin-top: 1.5rem; margin-bottom: 0.25rem;">${title}</h2>`,
            `<p style="font-size: 0.875rem; color: #6c757d; margin-top: 0; margin-bottom: 1rem;">${subtitle}</p>`
        ];
        return parts.join('');
    }

    /**
     * Generate Copy Combinations HTML (inserted after correlation table)
     * Uses array.join() for optimal string building performance
     */
    generateCopyCombinationsHTML(topCombinations) {
        if (!topCombinations || topCombinations.length === 0) {
            return '';
        }

        const tooltipHTML = `<span class="info-tooltip">
            <span class="info-icon">i</span>
            <span class="tooltip-text">
                <strong>High-Impact Portfolio Combinations</strong>
                Identifies 3-portfolio combinations that drive copies:
                <ul>
                    <li><strong>Method:</strong> Logistic regression with Newton-Raphson optimization</li>
                    <li><strong>Filters:</strong> Min 3 users exposed per combination, max 200 portfolios analyzed</li>
                    <li><strong>Ranking:</strong> By Expected Value (Lift × Total Conversions) - balances impact and volume</li>
                    <li><strong>Metrics:</strong> Lift (impact multiplier), odds ratio, precision, recall</li>
                </ul>
                Shows top 10 combinations sorted by Expected Value. Users must view ALL 3 portfolios to be counted as "exposed."
            </span>
        </span>`;

        const parts = [
            '<div class="qda-result-section" style="margin-top: 2rem;">',
            this.generateCombinationsTableHTML(
                `High-Impact Portfolio Combinations${tooltipHTML}`,
                'Users who viewed these portfolio combinations were significantly more likely to copy',
                topCombinations,
                (combo) => `${combo.value_1}, ${combo.value_2}, ${combo.value_3}`,
                'Portfolios Viewed',
                'Total Copies'
            ),
            '</div>'
        ];

        return parts.join('');
    }

    /**
     * Generate Portfolio Sequences HTML
     * Uses array.join() for optimal string building performance
     */
    generatePortfolioSequencesHTML(topSequences) {
        console.log('Portfolio sequences data:', topSequences);
        if (!topSequences || topSequences.length === 0) {
            console.warn('No portfolio sequences to display');
            return '';
        }

        const tooltipHTML = `<span class="info-tooltip">
            <span class="info-icon">i</span>
            <span class="tooltip-text">
                <strong>Portfolio Sequence Analysis</strong>
                Identifies the first 3 portfolios viewed (in exact order) that drive copies:
                <ul>
                    <li><strong>Method:</strong> Logistic regression analyzing sequential viewing patterns</li>
                    <li><strong>Filters:</strong> Min 3 users exposed per sequence</li>
                    <li><strong>Order Matters:</strong> [A, B, C] is different from [B, A, C]</li>
                    <li><strong>Ranking:</strong> By Expected Value (Lift × Total Conversions) - balances impact and volume</li>
                </ul>
                Reveals optimal onboarding paths for new users.
            </span>
        </span>`;

        const impactTooltipHTML = `<span class="info-tooltip">
            <span class="info-icon">i</span>
            <span class="tooltip-text">
                <strong>Impact (Lift)</strong>
                Measures conversion likelihood multiplier:
                <ul>
                    <li><strong>Formula:</strong> Group conversion rate ÷ Overall baseline rate</li>
                    <li><strong>Example:</strong> 2.5x means users who viewed this sequence were 2.5 times more likely to convert</li>
                    <li><strong>Interpretation:</strong> Higher lift = stronger predictive signal</li>
                </ul>
            </span>
        </span>`;

        const parts = [
            '<div class="qda-result-section" style="margin-top: 2rem;">',
            `<h3 style="margin-top: 1.5rem;">Portfolio Sequence Analysis${tooltipHTML}</h3>`,
            '<p style="font-size: 0.875rem; color: #6c757d; margin-top: 0; margin-bottom: 1rem;">This analysis identifies the first three PDP views that drive highest likelihood to copy</p>',
            '<table style="width: 100%; border-collapse: collapse; margin-top: 1rem; font-size: 0.85rem; font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;">',
            `<thead>
                <tr style="background-color: #f8f9fa; border-bottom: 2px solid #dee2e6;">
                    <th style="padding: 0.75rem; text-align: left;">Rank</th>
                    <th style="padding: 0.75rem; text-align: left;">Portfolio Sequence</th>
                    <th style="padding: 0.75rem; text-align: right;">Impact${impactTooltipHTML}</th>
                    <th style="padding: 0.75rem; text-align: right;">Users</th>
                    <th style="padding: 0.75rem; text-align: right;">Total Copies</th>
                    <th style="padding: 0.75rem; text-align: right;">Conv Rate</th>
                </tr>
            </thead>
            <tbody>`
        ];

        topSequences.forEach((seq, index) => {
            const displayValue = `${seq.value_1} → ${seq.value_2} → ${seq.value_3}`;
            const rowBg = index % 2 === 0 ? '#ffffff' : '#f8f9fa';
            parts.push(
                `<tr style="border-bottom: 1px solid #dee2e6; background-color: ${rowBg};">
                    <td style="padding: 0.75rem; font-weight: 600;">${index + 1}</td>
                    <td style="padding: 0.75rem;">${displayValue}</td>
                    <td style="padding: 0.75rem; text-align: right; font-weight: 600; color: #2563eb;">${parseFloat(seq.lift).toFixed(2)}x lift</td>
                    <td style="padding: 0.75rem; text-align: right;">${parseInt(seq.users_with_exposure).toLocaleString()}</td>
                    <td style="padding: 0.75rem; text-align: right;">${parseInt(seq.total_conversions || 0).toLocaleString()}</td>
                    <td style="padding: 0.75rem; text-align: right;">${(parseFloat(seq.conversion_rate_in_group) * 100).toFixed(1)}%</td>
                </tr>`
            );
        });

        parts.push(
            '</tbody></table>',
            '</div>'
        );

        return parts.join('');
    }

    /**
     * Generate Combinations Table HTML (DRY helper)
     * Uses array.join() for optimal string building performance
     */
    generateCombinationsTableHTML(title, subtitle, data, valueFormatter, columnLabel, conversionLabel) {
        const impactTooltipHTML = `<span class="info-tooltip">
            <span class="info-icon">i</span>
            <span class="tooltip-text">
                <strong>Impact (Lift)</strong>
                Measures conversion likelihood multiplier:
                <ul>
                    <li><strong>Formula:</strong> Group conversion rate ÷ Overall baseline rate</li>
                    <li><strong>Example:</strong> 2.5x means users who viewed this combination were 2.5 times more likely to convert</li>
                    <li><strong>Interpretation:</strong> Higher lift = stronger predictive signal</li>
                </ul>
            </span>
        </span>`;

        const parts = [
            '<div style="margin-top: 2rem;">',
            `<h3 style="margin-top: 1.5rem; margin-bottom: 0.25rem;">${title}</h3>`,
            `<p style="font-size: 0.875rem; color: #6c757d; margin-top: 0; margin-bottom: 1rem;">${subtitle}</p>`,
            '<table style="width: 100%; border-collapse: collapse; margin-top: 1rem; font-size: 0.85rem; font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;">',
            `<thead>
                <tr style="background-color: #f8f9fa; border-bottom: 2px solid #dee2e6;">
                    <th style="padding: 0.75rem; text-align: left;">Rank</th>
                    <th style="padding: 0.75rem; text-align: left;">${columnLabel}</th>
                    <th style="padding: 0.75rem; text-align: right;">Impact${impactTooltipHTML}</th>
                    <th style="padding: 0.75rem; text-align: right;">Users</th>
                    <th style="padding: 0.75rem; text-align: right;">${conversionLabel}</th>
                    <th style="padding: 0.75rem; text-align: right;">Conv Rate</th>
                </tr>
            </thead>
            <tbody>`
        ];

        // Build rows as separate array items
        data.forEach((combo, index) => {
            const displayValue = valueFormatter(combo);
            const rowBg = index % 2 === 0 ? '#ffffff' : '#f8f9fa';
            parts.push(
                `<tr style="border-bottom: 1px solid #dee2e6; background-color: ${rowBg};">
                    <td style="padding: 0.75rem; font-weight: 600;">${index + 1}</td>
                    <td style="padding: 0.75rem;">${displayValue}</td>
                    <td style="padding: 0.75rem; text-align: right; font-weight: 600; color: #2563eb;">${parseFloat(combo.lift).toFixed(2)}x lift</td>
                    <td style="padding: 0.75rem; text-align: right;">${parseInt(combo.users_with_exposure).toLocaleString()}</td>
                    <td style="padding: 0.75rem; text-align: right;">${parseInt(combo.total_conversions || 0).toLocaleString()}</td>
                    <td style="padding: 0.75rem; text-align: right;">${(parseFloat(combo.conversion_rate_in_group) * 100).toFixed(1)}%</td>
                </tr>`
            );
        });

        parts.push(
            '</tbody></table>',
            '</div>'
        );

        return parts.join('');
    }



    /**
     * Create metric card HTML (for creator summary stats)
     */
    createMetricCardHTML(title, content, size = null) {
        return `
            <div style="background-color: #f8f9fa; padding: 1rem; border-radius: 8px;">
                <div style="font-size: 0.875rem; color: #2563eb; font-weight: 600; margin-bottom: 0.5rem;">${title}</div>
                <div style="font-size: 1.5rem; font-weight: bold;">${content}</div>
            </div>
        `;
    }

    /**
     * Build creator correlation table (specialized for creator metrics)
     */
    buildCreatorCorrelationTable(correlationData, regressionData, tippingPoints) {
        const outcome = 'totalSubscriptions';

        const allVariables = Object.keys(correlationData);
        const filteredVariables = allVariables; // No exclusions for creator data

        const combinedData = filteredVariables.map(variable => {
            const correlation = correlationData[variable];
            const regressionItem = regressionData.find(item => item.variable === variable);

            let tippingPoint = 'N/A';
            if (tippingPoints && tippingPoints[outcome] && tippingPoints[outcome][variable]) {
                tippingPoint = tippingPoints[outcome][variable];
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
            const result = window.calculatePredictiveStrength?.(item.correlation, item.tStat) || { strength: 'N/A', className: '' };
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
                    The "magic number" threshold where creator behavior changes significantly:
                    <ul>
                        <li>Identifies the value where the largest jump in conversion rate occurs</li>
                        <li>Only considers groups with 10+ creators and >10% conversion rate</li>
                        <li>Represents the minimum exposure needed for behavioral change</li>
                    </ul>
                    Example: If tipping point is 5, creators with 5+ of this metric convert at much higher rates.`
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
        const fragment = document.createDocumentFragment();

        combinedData.slice(0, 10).forEach(item => {
            const row = document.createElement('tr');

            // Variable - convert camelCase to readable format
            const varCell = document.createElement('td');
            const readableVar = item.variable.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
            varCell.textContent = readableVar;
            row.appendChild(varCell);

            // Correlation
            const corrCell = document.createElement('td');
            corrCell.textContent = item.correlation.toFixed(2);
            row.appendChild(corrCell);

            // T-Stat
            const tStatCell = document.createElement('td');
            tStatCell.textContent = item.tStat.toFixed(2);
            row.appendChild(tStatCell);

            // Predictive Strength
            const strengthCell = document.createElement('td');
            const strengthSpan = document.createElement('span');
            strengthSpan.className = item.predictiveClass;
            strengthSpan.textContent = item.predictiveStrength;
            strengthCell.appendChild(strengthSpan);
            row.appendChild(strengthCell);

            // Tipping Point
            const tpCell = document.createElement('td');
            tpCell.textContent = item.tippingPoint !== 'N/A' ?
                (typeof item.tippingPoint === 'number' ? item.tippingPoint.toFixed(1) : item.tippingPoint) :
                'N/A';
            row.appendChild(tpCell);

            fragment.appendChild(row);
        });

        tbody.appendChild(fragment);
        table.appendChild(tbody);

        return table;
    }

    /**
     * Build correlation table (reusable for Deposits, Copies, Subscriptions)
     */
    buildCorrelationTable(correlationData, regressionData, outcomeKey, tippingPoints) {
        const outcomeMap = {
            'deposits': 'totalDeposits',
            'copies': 'totalCopies',
            'subscriptions': 'totalSubscriptions'
        };
        const outcome = outcomeMap[outcomeKey];

        const allVariables = Object.keys(correlationData);
        const excludedVars = window.SECTION_EXCLUSIONS?.[outcome] || [];
        const filteredVariables = allVariables.filter(variable => !excludedVars.includes(variable));

        const combinedData = filteredVariables.map(variable => {
            const correlation = correlationData[variable];
            const regressionItem = regressionData.find(item => item.variable === variable);

            let tippingPoint = 'N/A';
            if (tippingPoints && tippingPoints[outcome] && tippingPoints[outcome][variable]) {
                tippingPoint = tippingPoints[outcome][variable];
            }

            return {
                variable: variable,
                correlation: correlation,
                tStat: regressionItem ? regressionItem.tStat : 0,
                tippingPoint: tippingPoint
            };
        }).sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));

        // Calculate predictive strength using window function
        combinedData.forEach(item => {
            const result = window.calculatePredictiveStrength?.(item.correlation, item.tStat) || { strength: 'N/A', className: '' };
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
        const fragment = document.createDocumentFragment();

        combinedData.slice(0, 10).forEach(item => {
            const row = document.createElement('tr');

            // Variable
            const varCell = document.createElement('td');
            varCell.textContent = window.getVariableLabel?.(item.variable) || item.variable;
            row.appendChild(varCell);

            // Correlation
            const corrCell = document.createElement('td');
            corrCell.textContent = item.correlation.toFixed(2);
            row.appendChild(corrCell);

            // T-Stat
            const tStatCell = document.createElement('td');
            tStatCell.textContent = item.tStat.toFixed(2);
            row.appendChild(tStatCell);

            // Predictive Strength
            const strengthCell = document.createElement('td');
            const strengthSpan = document.createElement('span');
            strengthSpan.className = item.predictiveClass;
            strengthSpan.textContent = item.predictiveStrength;
            strengthCell.appendChild(strengthSpan);
            row.appendChild(strengthCell);

            // Tipping Point
            const tpCell = document.createElement('td');
            tpCell.textContent = item.tippingPoint !== 'N/A' ?
                (typeof item.tippingPoint === 'number' ? item.tippingPoint.toFixed(1) : item.tippingPoint) :
                'N/A';
            row.appendChild(tpCell);

            fragment.appendChild(row);
        });

        tbody.appendChild(fragment);
        table.appendChild(tbody);

        return table;
    }

    /**
     * Process creator data for display
     */
    async processCreatorData(csvContent) {
        try {
            // Create a temporary creator tool instance just for processing
            const tempTool = new CreatorAnalysisTool();

            // Parse CSV
            const parsedData = tempTool.parseCSV(csvContent);

            // Clean and transform data
            const cleanData = tempTool.cleanCreatorData(parsedData);

            // Run analysis
            const results = tempTool.performCreatorAnalysis(cleanData);

            return results;
        } catch (e) {
            console.error('Error processing creator data:', e);
            return null;
        }
    }

    /**
     * Create subscription price table HTML (returns HTML string)
     */
    createSubscriptionPriceTableHTML(priceData) {
        const sortedPrices = Object.entries(priceData).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));

        let html = '<table class="qda-regression-table">';
        html += '<thead><tr><th>Price Point</th><th>Count</th></tr></thead>';
        html += '<tbody>';

        sortedPrices.forEach(([price, count]) => {
            html += `<tr><td>$${parseFloat(price).toFixed(2)}</td><td>${count}</td></tr>`;
        });

        html += '</tbody></table>';
        return html;
    }

    /**
     * Create subscription price table (returns DOM element)
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

}

// Export to window
window.UserAnalysisToolSupabase = UserAnalysisToolSupabase;

console.log('✅ User Analysis Tool (Supabase) loaded successfully!');
