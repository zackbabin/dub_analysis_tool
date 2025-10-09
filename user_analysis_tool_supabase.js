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
     * Override: Create data source section - Only show "Sync Live Data" button (hide "Manually Upload Data")
     */
    createDataSourceSection() {
        const section = document.createElement('div');
        section.style.cssText = 'margin-bottom: 20px;';

        const title = document.createElement('h4');
        title.textContent = 'Select Data Source';
        title.style.cssText = 'margin: 0 0 15px 0; color: #333;';
        section.appendChild(title);

        // Mode buttons container
        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = 'display: flex; gap: 15px; margin-bottom: 20px; flex-wrap: wrap; justify-content: center;';

        // Only show "Sync Live Data" button
        const githubBtn = this.createModeButton(
            'Sync Live Data',
            'Fetch the latest data from Mixpanel',
            '#28a745',
            '#28a745',
            () => this.runWorkflow('github')
        );
        buttonContainer.appendChild(githubBtn);

        section.appendChild(buttonContainer);

        return section;
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

        // Also trigger subscription price analysis
        console.log('Triggering subscription price analysis...');
        try {
            const priceResult = await this.supabaseIntegration.triggerSubscriptionPriceAnalysis();
            if (priceResult && priceResult.success) {
                console.log('✅ Subscription price analysis completed:', priceResult.stats);
            }
        } catch (error) {
            console.warn('⚠️ Subscription price analysis failed:', error.message);
            // Continue even if price analysis fails - it's supplementary data
        }

        // Trigger event sequence sync
        console.log('Triggering event sequence sync...');
        try {
            const seqSyncResult = await this.supabaseIntegration.triggerEventSequenceSync();
            if (seqSyncResult && seqSyncResult.success) {
                console.log('✅ Event sequence sync completed:', seqSyncResult.stats);

                // After sync, trigger Claude AI analysis for both copies and subscriptions
                console.log('Triggering event sequence analysis for copies...');
                const copyAnalysisResult = await this.supabaseIntegration.triggerEventSequenceAnalysis('copies');
                if (copyAnalysisResult && copyAnalysisResult.success) {
                    console.log('✅ Copy sequence analysis completed:', copyAnalysisResult.stats);
                }

                console.log('Triggering event sequence analysis for subscriptions...');
                const subAnalysisResult = await this.supabaseIntegration.triggerEventSequenceAnalysis('subscriptions');
                if (subAnalysisResult && subAnalysisResult.success) {
                    console.log('✅ Subscription sequence analysis completed:', subAnalysisResult.stats);
                }
            }
        } catch (error) {
            console.warn('⚠️ Event sequence analysis failed:', error.message);
            // Continue even if sequence analysis fails - it's supplementary data
        }

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
            subscriptionDistribution,
            copySequenceAnalysis,
            subscriptionSequenceAnalysis
            // topSequences // COMMENTED OUT: Portfolio sequence analysis temporarily disabled
        ] = await Promise.all([
            this.supabaseIntegration.loadEngagementSummary().catch(e => { console.warn('Failed to load engagement summary:', e); return null; }),
            this.supabaseIntegration.loadTopSubscriptionCombinations('expected_value', 10, 3).catch(e => { console.warn('Failed to load subscription combos:', e); return []; }),
            this.supabaseIntegration.loadHiddenGems().catch(e => { console.warn('Failed to load hidden gems:', e); return []; }),
            this.supabaseIntegration.loadHiddenGemsSummary().catch(e => { console.warn('Failed to load hidden gems summary:', e); return null; }),
            this.supabaseIntegration.loadCopyEngagementSummary().catch(e => { console.warn('Failed to load copy engagement summary:', e); return null; }),
            this.supabaseIntegration.loadTopCopyCombinations('expected_value', 10, 3).catch(e => { console.warn('Failed to load copy combos:', e); return []; }),
            this.supabaseIntegration.loadSubscriptionDistribution().catch(e => { console.warn('Failed to load subscription distribution:', e); return []; }),
            this.supabaseIntegration.loadEventSequenceAnalysis('copies').catch(e => { console.warn('Failed to load copy sequences:', e); return null; }),
            this.supabaseIntegration.loadEventSequenceAnalysis('subscriptions').catch(e => { console.warn('Failed to load subscription sequences:', e); return null; })
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
                <div id="portfolioContentSection"></div>
            </div>
        `;

        // Build Portfolio Content Section
        const portfolioContentSection = document.getElementById('portfolioContentSection');

        if (results.correlationResults?.totalCopies && results.regressionResults?.copies) {
            // Build all HTML sections first
            const metricsHTML = this.generateCopyMetricsHTML(copyEngagementSummary);
            const hiddenGemsHTML = this.generateHiddenGemsHTML(hiddenGemsSummary, hiddenGems);
            const combinationsHTML = this.generateCopyCombinationsHTML(topCopyCombos);

            const copySequenceHTML = copySequenceAnalysis ?
                this.generateConversionPathHTML(copySequenceAnalysis, 'Copies') : '';

            // Build complete HTML structure with H1 in same section as metrics
            let portfolioHTML = `
                <div class="qda-result-section">
                    <h1 style="margin-bottom: 0.25rem;">Portfolio Analysis</h1>
                    ${metricsHTML}
                    ${hiddenGemsHTML}
                </div>
            `;

            // Add Deposit Funds Section
            if (results.correlationResults?.totalDeposits && results.regressionResults?.deposits) {
                try {
                    const depositHeaderHTML = this.generateCorrelationHeaderHTML('Top Deposit Funds Drivers', 'The top events that are the strongest predictors of deposits');
                    const depositsTable = this.buildCorrelationTable(results.correlationResults.totalDeposits, results.regressionResults.deposits, 'deposits', tippingPoints);

                    // Create wrapper for deposit section
                    const depositWrapper = document.createElement('div');
                    depositWrapper.className = 'qda-result-section';
                    depositWrapper.style.marginTop = '3rem';
                    depositWrapper.innerHTML = depositHeaderHTML;
                    depositWrapper.appendChild(depositsTable);

                    portfolioHTML += depositWrapper.outerHTML;
                } catch (e) {
                    console.error('Error building deposits table:', e);
                    portfolioHTML += `
                        <div class="qda-result-section" style="margin-top: 3rem;">
                            ${this.generateCorrelationHeaderHTML('Top Deposit Funds Drivers', 'The top events that are the strongest predictors of deposits')}
                            <p style="color: #dc3545;">Error displaying deposit analysis. Please try syncing again.</p>
                        </div>
                    `;
                }
            }

            // Add Top Portfolio Copy Drivers Section
            try {
                const correlationHeaderHTML = this.generateCorrelationHeaderHTML('Top Portfolio Copy Drivers', 'The top events that are the strongest predictors of copies');
                const copiesTable = this.buildCorrelationTable(results.correlationResults.totalCopies, results.regressionResults.copies, 'copies', tippingPoints);

                // Create wrapper for copy drivers section
                const copyDriversWrapper = document.createElement('div');
                copyDriversWrapper.className = 'qda-result-section';
                copyDriversWrapper.style.marginTop = '3rem';
                copyDriversWrapper.innerHTML = correlationHeaderHTML;
                copyDriversWrapper.appendChild(copiesTable);
                copyDriversWrapper.insertAdjacentHTML('beforeend', combinationsHTML + copySequenceHTML);

                portfolioHTML += copyDriversWrapper.outerHTML;
            } catch (e) {
                console.error('Error building portfolio copies table:', e);
                portfolioHTML += `
                    <div class="qda-result-section" style="margin-top: 3rem;">
                        ${this.generateCorrelationHeaderHTML('Top Portfolio Copy Drivers', 'The top events that are the strongest predictors of copies')}
                        <p style="color: #dc3545;">Error displaying portfolio copy analysis. Please try syncing again.</p>
                    </div>
                `;
            }

            // Insert complete HTML once
            portfolioContentSection.innerHTML = portfolioHTML;
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

            // Build price distribution chart from loaded subscription distribution data
            let priceDistributionHTML = '';
            if (subscriptionDistribution && subscriptionDistribution.length > 0) {
                // Generate unique ID for chart container
                const chartId = `subscription-price-chart-${Date.now()}`;

                priceDistributionHTML = `
                    <div style="margin-top: 3rem;">
                        <h2 style="margin-top: 0; margin-bottom: 0.25rem;">Subscription Price Distribution</h2>
                        <div id="${chartId}" style="width: 100%; height: 400px; margin-top: 1rem;"></div>
                    </div>
                `;

                // Render chart after DOM is ready
                setTimeout(() => {
                    this.renderSubscriptionPriceChart(chartId, subscriptionDistribution);
                }, 100);
            } else {
                priceDistributionHTML = `
                    <div style="margin-top: 3rem;">
                        <h2 style="margin-top: 0; margin-bottom: 0.25rem;">Subscription Price Distribution</h2>
                        <p style="color: #6c757d; font-style: italic;">No subscription price data available. Please run "Sync Creator Data" to fetch this data.</p>
                    </div>
                `;
            }

            const subCorrelationHeaderHTML = this.generateCorrelationHeaderHTML('Top Subscription Drivers', 'The top events that are the strongest predictors of subscriptions');
            const subCombinationsHTML = this.generateSubscriptionCombinationsHTML(topSubscriptionCombos);
            const subSequenceHTML = subscriptionSequenceAnalysis ?
                this.generateConversionPathHTML(subscriptionSequenceAnalysis, 'Subscriptions') : '';

            try {
                const subscriptionsTable = this.buildCorrelationTable(results.correlationResults.totalSubscriptions, results.regressionResults.subscriptions, 'subscriptions', tippingPoints);

                // Create complete section wrapper
                const subWrapper = document.createElement('div');
                subWrapper.className = 'qda-result-section';
                subWrapper.innerHTML = `
                    <h1 style="margin-bottom: 0.25rem;">Subscription Analysis</h1>
                    ${subMetricsHTML}
                    ${priceDistributionHTML}
                    ${subCorrelationHeaderHTML}
                `;
                subWrapper.appendChild(subscriptionsTable);
                subWrapper.insertAdjacentHTML('beforeend', subCombinationsHTML + subSequenceHTML);

                // Insert complete HTML once
                subscriptionSection.innerHTML = subWrapper.outerHTML;
            } catch (e) {
                console.error('Error building subscriptions table:', e);
                subscriptionSection.innerHTML = `
                    <div class="qda-result-section">
                        <h1 style="margin-bottom: 0.25rem;">Subscription Analysis</h1>
                        ${subMetricsHTML}
                        ${priceDistributionHTML}
                        ${subCorrelationHeaderHTML}
                        <p style="color: #dc3545;">Error displaying subscription analysis. Please try syncing again.</p>
                    </div>
                `;
            }
        } else {
            subscriptionSection.innerHTML = `
                <div class="qda-result-section">
                    <h1 style="margin-bottom: 0.25rem;">Subscription Analysis</h1>
                    <p style="color: #6c757d; font-style: italic;">Subscription analysis data will be available after syncing.</p>
                </div>
            `;
        }

        // Add timestamp and data scope to first 3 tabs (creator tab handled separately)
        const timestampStr = new Date().toLocaleString('en-US', {
            month: 'numeric',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
        localStorage.setItem('qdaLastUpdated', timestampStr);

        // Add timestamp (top right) and data scope (top left) to each container
        const tabConfigs = [
            { container: summaryContainer, scopeText: 'All Freemium users that have been KYC approved' },
            { container: portfolioContainer, scopeText: 'Data for KYC approved users from the last 30 days' },
            { container: subscriptionContainer, scopeText: 'Data for KYC approved users from the last 30 days' }
        ];

        tabConfigs.forEach(({ container, scopeText }) => {
            const resultsDiv = container.querySelector('.qda-analysis-results');
            if (resultsDiv) {
                // Add timestamp (top right)
                const timestamp = document.createElement('div');
                timestamp.className = 'qda-timestamp';
                timestamp.textContent = `Last updated: ${timestampStr}`;
                resultsDiv.insertBefore(timestamp, resultsDiv.firstChild);

                // Add data scope text (top left)
                const dataScope = document.createElement('div');
                dataScope.className = 'qda-data-scope';
                dataScope.textContent = scopeText;
                resultsDiv.insertBefore(dataScope, resultsDiv.firstChild);
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
            '<div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 0.5rem; margin-top: 1.5rem;">'
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
        parts.push('<p style="font-size: 0.75rem; color: #6c757d; margin-top: 0.5rem; margin-bottom: 2rem; font-style: italic;">Compares users who subscribed vs. haven\'t subscribed</p>');
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

        const tooltipHTML = `<span class="info-tooltip" style="vertical-align: middle;">
            <span class="info-icon">i</span>
            <span class="tooltip-text">
                <strong>High-Impact Creator Combinations</strong>
                Identifies 2-creator pairs that drive subscriptions:
                <ul>
                    <li><strong>Method:</strong> Logistic regression with Newton-Raphson optimization</li>
                    <li><strong>Filters:</strong> Min 1 user exposed per combination, max 200 creators analyzed</li>
                    <li><strong>Ranking:</strong> By Expected Value (Lift × Total Conversions) - balances impact and volume</li>
                    <li><strong>Metrics:</strong> Lift (impact multiplier), odds ratio, precision, recall</li>
                </ul>
                Shows top 10 combinations sorted by Expected Value. Users must view BOTH creators to be counted as "exposed."
            </span>
        </span>`;

        const parts = [
            '<div class="qda-result-section" style="margin-top: 2rem;">',
            this.generateCombinationsTableHTML(
                `High-Impact Creator Combinations${tooltipHTML}`,
                'Users who viewed both of these creators were significantly more likely to subscribe',
                topCombinations,
                (combo) => {
                    const creator1 = combo.username_1 || combo.value_1;
                    const creator2 = combo.username_2 || combo.value_2;
                    return `${creator1}, ${creator2}`;
                },
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

        const tooltipHTML = `<span class="info-tooltip" style="vertical-align: middle;">
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
            '<div class="qda-result-section" style="margin-top: 3rem;">',
            `<h2 style="margin-top: 0; margin-bottom: 0.5rem;">Hidden Gems${tooltipHTML}</h2>`,
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
            '<div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 0.5rem; margin-top: 1.5rem;">'
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
        parts.push('<p style="font-size: 0.75rem; color: #6c757d; margin-top: 0.5rem; margin-bottom: 2rem; font-style: italic;">Compares users who copied vs. haven\'t copied</p>');
        return parts.join('');
    }

    /**
     * Generate Correlation Header HTML (h3 + subtitle for correlation table)
     * Uses array.join() for optimal string building performance
     */
    generateCorrelationHeaderHTML(title, subtitle) {
        const parts = [
            `<h2 style="margin-top: 1.5rem; margin-bottom: 0.5rem;">${title}</h2>`,
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

        const tooltipHTML = `<span class="info-tooltip" style="vertical-align: middle;">
            <span class="info-icon">i</span>
            <span class="tooltip-text">
                <strong>High-Impact Portfolio Combinations</strong>
                Identifies 2-portfolio pairs that drive copies:
                <ul>
                    <li><strong>Method:</strong> Logistic regression with Newton-Raphson optimization</li>
                    <li><strong>Filters:</strong> Min 1 user exposed per combination, max 200 portfolios analyzed</li>
                    <li><strong>Ranking:</strong> By Expected Value (Lift × Total Conversions) - balances impact and volume</li>
                    <li><strong>Metrics:</strong> Lift (impact multiplier), odds ratio, precision, recall</li>
                </ul>
                Shows top 10 combinations sorted by Expected Value. Users must view BOTH portfolios to be counted as "exposed."
            </span>
        </span>`;

        const parts = [
            '<div class="qda-result-section" style="margin-top: 2rem;">',
            this.generateCombinationsTableHTML(
                `High-Impact Portfolio Combinations${tooltipHTML}`,
                'Users who viewed both of these portfolios were significantly more likely to copy',
                topCombinations,
                (combo) => `${combo.value_1}, ${combo.value_2}`,
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

        const tooltipHTML = `<span class="info-tooltip" style="vertical-align: middle;">
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

        const impactTooltipHTML = `<span class="info-tooltip" style="vertical-align: middle;">
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
            '<div class="qda-result-section" style="margin-top: 3rem;">',
            `<h3 style="margin-top: 1.5rem; margin-bottom: 0.5rem;">Portfolio Sequence Analysis${tooltipHTML}</h3>`,
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
            // Handle both 2-way and 3-way combinations (for backwards compatibility)
            const displayValue = seq.value_3
                ? `${seq.value_1} → ${seq.value_2} → ${seq.value_3}`
                : `${seq.value_1} → ${seq.value_2}`;
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
     * Generate Conversion Path Analysis HTML
     * Displays Claude AI-powered event sequence analysis
     */
    generateConversionPathHTML(analysisData, outcomeType) {
        if (!analysisData || !analysisData.predictive_sequences) {
            return '';
        }

        const tooltipHTML = `<span class="info-tooltip" style="vertical-align: middle;">
            <span class="info-icon">i</span>
            <span class="tooltip-text">
                <strong>Conversion Path Analysis</strong>
                AI-powered event sequence analysis to identify predictive patterns:
                <ul>
                    <li><strong>Data Source:</strong> User event sequences from Mixpanel (up to 1000 converters + 1000 non-converters, 100 events per user)</li>
                    <li><strong>Processing:</strong> Batch processing with prompt caching analyzes users in groups of 200 for efficiency</li>
                    <li><strong>AI Method:</strong> Claude Sonnet 4 analyzes temporal patterns, frequency thresholds, and key differentiators</li>
                    <li><strong>Analysis:</strong> Identifies sequences where order matters, minimum event counts for conversion, and critical moments before conversion</li>
                    <li><strong>Sorting:</strong> Patterns sorted by impact score (lift × prevalence in converters) to prioritize patterns with both high predictive power and broad user reach</li>
                    <li><strong>Output:</strong> High-impact sequences, critical triggers, and anti-patterns with actionable insights</li>
                </ul>
            </span>
        </span>`;

        const parts = [
            '<div class="qda-result-section" style="margin-top: 2rem;">',
            `<h2 style="margin-top: 1.5rem; margin-bottom: 0.5rem;">Conversion Path Analysis: ${outcomeType}${tooltipHTML}</h2>`,
            `<div style="
                background: #f8f9fa;
                border-radius: 8px;
                padding: 1rem 1.25rem;
                margin: 1rem 0 1.5rem 0;
                display: flex;
                align-items: start;
                gap: 0.75rem;
            ">`,
                '<div style="font-size: 1.5rem; flex-shrink: 0;">💡</div>',
                `<div style="color: #495057; font-size: 0.95rem; line-height: 1.5;">${analysisData.summary}</div>`,
            '</div>',

            // Predictive Sequences Section
            '<div class="path-analysis-section">',
            '<h3 style="margin-top: 1rem; margin-bottom: 0.5rem;">High-Impact Event Sequences</h3>',
            '<p style="color: #6c757d; font-size: 0.9rem;">Patterns sorted by impact (lift × prevalence), showing sequences that drive conversion for the most users</p>'
        ];

        // Add each predictive sequence
        analysisData.predictive_sequences.slice(0, 5).forEach((seq, idx) => {
            parts.push(
                `<div class="sequence-card" style="
                    border: 1px solid #dee2e6;
                    border-radius: 8px;
                    padding: 1rem;
                    margin-bottom: 1rem;
                    background: #f8f9fa;
                ">`,
                    '<div style="display: flex; justify-content: space-between; align-items: start;">',
                        '<div style="flex: 1;">',
                            `<h4 style="margin: 0 0 0.5rem 0;">Pattern ${idx + 1}</h4>`,
                            '<div class="sequence-flow" style="display: flex; align-items: center; gap: 0.5rem; margin: 0.5rem 0; flex-wrap: wrap;">'
            );

            // Add event nodes with arrows
            seq.sequence.forEach((event, eventIdx) => {
                parts.push(
                    `<span style="
                        background: #007bff;
                        color: white;
                        padding: 0.25rem 0.75rem;
                        border-radius: 4px;
                        font-size: 0.85rem;
                    ">${event}</span>`
                );
                if (eventIdx < seq.sequence.length - 1) {
                    parts.push('<span style="color: #6c757d; font-weight: bold;">→</span>');
                }
            });

            parts.push(
                            '</div>',
                        '</div>',
                        `<div style="
                            background: white;
                            border-radius: 4px;
                            padding: 0.5rem 1rem;
                            text-align: center;
                            min-width: 80px;
                        ">`,
                            `<div style="font-size: 1.5rem; font-weight: bold; color: #28a745;">
                                ${seq.lift.toFixed(1)}x
                            </div>`,
                            '<div style="font-size: 0.75rem; color: #6c757d;">Lift</div>',
                        '</div>',
                    '</div>',

                    `<div style="
                        display: grid;
                        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                        gap: 1rem;
                        margin-top: 1rem;
                        padding-top: 1rem;
                        border-top: 1px solid #dee2e6;
                    ">`,
                        `<div>
                            <strong>Volume:</strong> ${(seq.prevalence_in_converters * 100).toFixed(1)}%
                            <span class="info-tooltip" style="margin-left: 0.25rem; vertical-align: middle;">
                                <span class="info-icon">i</span>
                                <span class="tooltip-text">Percentage of converters who exhibited this sequence</span>
                            </span>
                        </div>`,
                        `<div><strong>Avg Time to Convert:</strong> ${Math.round(seq.avg_time_to_conversion_minutes)} min</div>`,
                        `<div>
                            <strong>Avg Events Before:</strong> ${seq.avg_events_before_conversion}
                            <span class="info-tooltip" style="margin-left: 0.25rem; vertical-align: middle;">
                                <span class="info-icon">i</span>
                                <span class="tooltip-text">Average number of events users performed before conversion</span>
                            </span>
                        </div>`,
                    '</div>',

                    `<div style="
                        margin-top: 1rem;
                        padding: 0.75rem;
                        background: white;
                        border-radius: 4px;
                    ">`,
                        `<strong>Insight:</strong> ${seq.insight}`,
                    '</div>',
                '</div>'
            );
        });

        parts.push('</div>'); // Close predictive sequences section

        // Critical Triggers Section
        if (analysisData.critical_triggers && analysisData.critical_triggers.length > 0) {
            const triggerTooltip = `<span class="info-tooltip" style="margin-left: 0.5rem; vertical-align: middle;">
                <span class="info-icon">i</span>
                <span class="tooltip-text">Events that immediately precede conversion, showing which actions are most likely to trigger the final conversion step</span>
            </span>`;

            parts.push(
                '<div class="path-analysis-section" style="margin-top: 2rem;">',
                `<h3>Critical Conversion Triggers${triggerTooltip}</h3>`
            );

            analysisData.critical_triggers.forEach(trigger => {
                parts.push(
                    `<div style="
                        padding: 1rem;
                        margin-bottom: 1rem;
                        background: #f8f9fa;
                        border-radius: 4px;
                        display: flex;
                        justify-content: space-between;
                        align-items: start;
                    ">`,
                        '<div style="flex: 1;">',
                            `<h4 style="margin: 0 0 0.5rem 0;">${trigger.event}</h4>`,
                            `<p style="margin: 0.5rem 0;"><strong>Follows:</strong> ${trigger.follows_sequence.join(' → ')}</p>`,
                            `<p style="margin: 0.5rem 0; font-style: italic;">${trigger.insight}</p>`,
                        '</div>',
                        `<div style="
                            background: white;
                            border-radius: 4px;
                            padding: 0.5rem 1rem;
                            text-align: center;
                            min-width: 80px;
                            margin-left: 1rem;
                        ">`,
                            `<div style="font-size: 1.5rem; font-weight: bold; color: #28a745;">
                                ${(trigger.conversion_rate_after_trigger * 100).toFixed(1)}%
                            </div>`,
                            '<div style="font-size: 0.75rem; color: #6c757d;">Conv. Rate</div>',
                        '</div>',
                    '</div>'
                );
            });

            parts.push('</div>');
        }

        parts.push('</div>'); // Close main section

        return parts.join('');
    }

    /**
     * Generate Combinations Table HTML (DRY helper)
     * Uses array.join() for optimal string building performance
     */
    generateCombinationsTableHTML(title, subtitle, data, valueFormatter, columnLabel, conversionLabel) {
        const impactTooltipHTML = `<span class="info-tooltip" style="vertical-align: middle;">
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
            '<div style="margin-top: 3rem;">',
            `<h2 style="margin-top: 1.5rem; margin-bottom: 0.5rem;">${title}</h2>`,
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
     * Render subscription price distribution as Highcharts bar chart
     */
    renderSubscriptionPriceChart(chartId, subscriptionDistribution) {
        // Aggregate data by monthly price with creator details
        // Now each row is one creator with their price, so we need to aggregate by price
        const priceDataMap = {};
        subscriptionDistribution.forEach(row => {
            const price = parseFloat(row.monthly_price || row.subscription_price);
            if (!priceDataMap[price]) {
                priceDataMap[price] = {
                    totalSubscriptions: 0,
                    totalPaywallViews: 0,
                    creators: []
                };
            }

            // Each row represents one creator at their price point
            const totalSubs = row.total_subscriptions || 0;
            const totalPaywallViews = row.total_paywall_views || 0;

            // Aggregate totals for this price point
            priceDataMap[price].totalSubscriptions += totalSubs;
            priceDataMap[price].totalPaywallViews += totalPaywallViews;

            // Store creator username
            const username = row.creator_username || (Array.isArray(row.creator_usernames) ? row.creator_usernames[0] : null);
            if (username && username !== 'undefined') {
                priceDataMap[price].creators.push(username);
            }
        });

        // Sort by price and prepare chart data with tooltip info
        const sortedData = Object.entries(priceDataMap)
            .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))
            .map(([price, data]) => {
                // Calculate overall conversion rate for this price point
                const overallConversionRate = data.totalPaywallViews > 0
                    ? (data.totalSubscriptions / data.totalPaywallViews)
                    : 0;

                // Take top 5 creators (just names)
                const topCreators = data.creators.slice(0, 5);

                return {
                    name: `$${parseFloat(price).toFixed(2)}`,
                    y: data.totalSubscriptions,
                    conversionRate: overallConversionRate,
                    creators: topCreators
                };
            });

        // Render Highcharts bar chart
        Highcharts.chart(chartId, {
            chart: {
                type: 'column',
                backgroundColor: 'transparent'
            },
            title: {
                text: null
            },
            xAxis: {
                type: 'category',
                title: {
                    text: 'Monthly Price'
                },
                labels: {
                    rotation: -45,
                    style: {
                        fontSize: '11px'
                    }
                }
            },
            yAxis: {
                min: 0,
                title: {
                    text: 'Total Subscriptions'
                }
            },
            legend: {
                enabled: false
            },
            tooltip: {
                useHTML: true,
                formatter: function() {
                    let tooltipHTML = `<b>${this.point.name}</b><br/>`;
                    tooltipHTML += `<b>${this.point.y}</b> total subscriptions<br/>`;

                    // Show overall conversion rate for this price point
                    const conversionRate = (this.point.conversionRate * 100).toFixed(1);
                    tooltipHTML += `<b>${conversionRate}%</b> conversion rate<br/><br/>`;

                    // Show top creators at this price point
                    if (this.point.creators && this.point.creators.length > 0) {
                        tooltipHTML += '<b>Top Creators:</b><br/>';
                        this.point.creators.forEach(creator => {
                            tooltipHTML += `${creator}<br/>`;
                        });
                    }

                    return tooltipHTML;
                }
            },
            series: [{
                name: 'Subscriptions',
                data: sortedData,
                color: '#2563eb',
                dataLabels: {
                    enabled: true,
                    format: '{point.y}',
                    inside: false,
                    y: -5
                }
            }],
            credits: {
                enabled: false
            }
        });
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
