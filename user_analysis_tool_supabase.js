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
    createUI(container, outputContainer) {
        // Check if Supabase is already initialized globally
        if (window.supabaseIntegration) {
            this.supabaseIntegration = window.supabaseIntegration;
        }

        // Call parent to create base UI
        super.createUI(container, outputContainer);
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
                if (this.outputContainer && data.html && data.timestamp) {
                    this.outputContainer.innerHTML = data.html;
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

        // Step 3: Cache complete rendered HTML
        try {
            localStorage.setItem('dubAnalysisResults', JSON.stringify({
                html: this.outputContainer.innerHTML,
                timestamp: new Date().toISOString()
            }));
            console.log('✅ Cached complete analysis');
        } catch (error) {
            console.warn('Failed to cache:', error);
        }
    }

    /**
     * Build complete HTML including all analysis sections
     */
    async buildCompleteHTML(results) {
        // Load all engagement data in parallel with base analysis
        const [
            engagementSummary,
            topSubscriptionCombos,
            hiddenGems,
            hiddenGemsSummary,
            copyEngagementSummary,
            topCopyCombos,
            topSequences
        ] = await Promise.all([
            this.supabaseIntegration.loadEngagementSummary().catch(e => { console.warn('Failed to load engagement summary:', e); return null; }),
            this.supabaseIntegration.loadTopSubscriptionCombinations('lift', 10, 0).catch(e => { console.warn('Failed to load subscription combos:', e); return []; }),
            this.supabaseIntegration.loadHiddenGems().catch(e => { console.warn('Failed to load hidden gems:', e); return []; }),
            this.supabaseIntegration.loadHiddenGemsSummary().catch(e => { console.warn('Failed to load hidden gems summary:', e); return null; }),
            this.supabaseIntegration.loadCopyEngagementSummary().catch(e => { console.warn('Failed to load copy engagement summary:', e); return null; }),
            this.supabaseIntegration.loadTopCopyCombinations('lift', 10, 0).catch(e => { console.warn('Failed to load copy combos:', e); return []; }),
            this.supabaseIntegration.loadTopPortfolioSequenceCombinations('lift', 10, 0).catch(e => { console.warn('Failed to load sequences:', e); return []; })
        ]);

        // Clear output container and create results div
        this.outputContainer.innerHTML = '';

        const resultsDiv = document.createElement('div');
        resultsDiv.id = 'qdaAnalysisResultsInline';
        resultsDiv.className = 'qda-analysis-results';
        this.outputContainer.appendChild(resultsDiv);

        // Create sub-tab navigation and content structure
        resultsDiv.innerHTML = `
            <!-- Sub-tab Navigation -->
            <div class="sub-tab-navigation">
                <button class="sub-tab-btn active" data-subtab="summary">Summary Stats</button>
                <button class="sub-tab-btn" data-subtab="portfolio">Portfolio Analysis</button>
                <button class="sub-tab-btn" data-subtab="subscription">Subscription Analysis</button>
                <button class="sub-tab-btn" data-subtab="creator">Creator Analysis</button>
            </div>

            <!-- Summary Stats Tab -->
            <div id="summary-subtab" class="sub-tab-pane active">
                <div id="qdaSummaryStatsInline"></div>
                <div id="qdaDemographicBreakdownInline"></div>
                <div id="qdaPersonaBreakdownInline"></div>
            </div>

            <!-- Portfolio Analysis Tab -->
            <div id="portfolio-subtab" class="sub-tab-pane">
                <div id="qdaDepositFundsInline"></div>
                <div id="qdaPortfolioCopiesInline"></div>
            </div>

            <!-- Subscription Analysis Tab -->
            <div id="subscription-subtab" class="sub-tab-pane">
                <div id="qdaSubscriptionsInline"></div>
                <div id="qdaSubscriptionPriceInline"></div>
            </div>

            <!-- Creator Analysis Tab -->
            <div id="creator-subtab" class="sub-tab-pane">
                <!-- This will be rendered by parent class -->
            </div>
        `;

        // Initialize sub-tab switching
        this.initializeSubTabs();

        // Display Summary Stats sections
        displaySummaryStatsInline(results.summaryStats);
        displayDemographicBreakdownInline(results.summaryStats);
        displayPersonaBreakdownInline(results.summaryStats);

        // Load tipping points and prepare correlation/regression data
        const analysisData = JSON.parse(localStorage.getItem('qdaAnalysisResults') || 'null');
        const tippingPoints = analysisData?.tippingPoints || JSON.parse(localStorage.getItem('qdaTippingPoints') || 'null');

        // Render Portfolio Analysis content
        this.renderPortfolioAnalysis(results.correlationResults, results.regressionResults, tippingPoints, copyEngagementSummary, hiddenGems, hiddenGemsSummary, topCopyCombos, topSequences);

        // Render Subscription Analysis content (includes subscription price distribution)
        this.renderSubscriptionAnalysis(results.correlationResults, results.regressionResults, tippingPoints, engagementSummary, topSubscriptionCombos, results.summaryStats);

        // Add timestamp after all rendering is complete
        const timestampStr = new Date().toLocaleString('en-US', {
            month: 'numeric',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
        localStorage.setItem('qdaLastUpdated', timestampStr);

        const timestamp = document.createElement('div');
        timestamp.className = 'qda-timestamp';
        timestamp.textContent = `Last updated: ${timestampStr}`;
        resultsDiv.insertBefore(timestamp, resultsDiv.firstChild);

        return resultsDiv.outerHTML;
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
                    <li><strong>Filters:</strong> Min 3 users per creator, max 200 creators analyzed, ≥1 user viewed all 3, ≥1 subscription occurred</li>
                    <li><strong>Ranking:</strong> By AIC (Akaike Information Criterion) - lower = better fit</li>
                    <li><strong>Metrics:</strong> Lift (impact multiplier), odds ratio, precision, recall</li>
                </ul>
                Shows top 10 combinations sorted by AIC. Users must view ALL 3 creators to be counted as "exposed."
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
            `<h3 style="margin-top: 1.5rem; margin-bottom: 0.25rem;">Hidden Gems${tooltipHTML}</h3>`,
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
            `<h3 style="margin-top: 1.5rem; margin-bottom: 0.25rem;">${title}</h3>`,
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
                    <li><strong>Filters:</strong> Min 3 users per portfolio, max 200 portfolios analyzed, ≥1 user viewed all 3, ≥1 copy occurred</li>
                    <li><strong>Ranking:</strong> By AIC (Akaike Information Criterion) - lower = better fit</li>
                    <li><strong>Metrics:</strong> Lift (impact multiplier), odds ratio, precision, recall</li>
                </ul>
                Shows top 10 combinations sorted by AIC. Users must view ALL 3 portfolios to be counted as "exposed."
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
                    <li><strong>Filters:</strong> Min 3 users per portfolio, ≥1 user with exact sequence</li>
                    <li><strong>Order Matters:</strong> [A, B, C] is different from [B, A, C]</li>
                    <li><strong>Ranking:</strong> By AIC - identifies most predictive sequences</li>
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
     * Initialize sub-tab switching functionality
     */
    initializeSubTabs() {
        const subTabButtons = document.querySelectorAll('.sub-tab-btn');
        const subTabPanes = document.querySelectorAll('.sub-tab-pane');

        subTabButtons.forEach(button => {
            button.addEventListener('click', () => {
                const targetSubTab = button.getAttribute('data-subtab');

                // Remove active class from all buttons and panes
                subTabButtons.forEach(btn => btn.classList.remove('active'));
                subTabPanes.forEach(pane => pane.classList.remove('active'));

                // Add active class to clicked button
                button.classList.add('active');

                // Show corresponding sub-tab pane
                const targetPane = document.getElementById(`${targetSubTab}-subtab`);
                if (targetPane) {
                    targetPane.classList.add('active');
                }
            });
        });
    }

    /**
     * Render Portfolio Analysis tab content
     */
    renderPortfolioAnalysis(correlationResults, regressionResults, tippingPoints, copyEngagementSummary, hiddenGems, hiddenGemsSummary, topCopyCombos, topSequences) {
        const portfolioContainer = document.getElementById('qdaPortfolioCopiesInline');
        const depositContainer = document.getElementById('qdaDepositFundsInline');

        if (!portfolioContainer || !depositContainer) return;

        // Filter correlation/regression data for Portfolio Copies and Deposit Funds
        const portfolioCopiesCorr = correlationResults.find(r => r.outcome === 'totalCopies');
        const depositFundsCorr = correlationResults.find(r => r.outcome === 'totalDeposits');

        // Render Deposit Funds section
        if (depositFundsCorr) {
            const depositSection = document.createElement('div');
            depositSection.className = 'qda-result-section';
            depositSection.innerHTML = '<h2>Deposit Funds</h2>';
            depositContainer.appendChild(depositSection);

            // Use parent class method to render regression table
            displayRegressionTableInline(depositSection, [depositFundsCorr], tippingPoints);
        }

        // Render Portfolio Copies section
        if (portfolioCopiesCorr) {
            const portfolioSection = document.createElement('div');
            portfolioSection.className = 'qda-result-section';
            portfolioSection.innerHTML = '<h2>Portfolio Copies</h2>';
            portfolioContainer.appendChild(portfolioSection);

            // Add metrics, hidden gems, and correlation header
            const metricsHTML = this.generateCopyMetricsHTML(copyEngagementSummary);
            const hiddenGemsHTML = this.generateHiddenGemsHTML(hiddenGemsSummary, hiddenGems);
            const correlationHeaderHTML = this.generateCorrelationHeaderHTML('Top Portfolio Copy Drivers', 'The top events that are the strongest predictors of copies');
            portfolioSection.insertAdjacentHTML('beforeend', metricsHTML + hiddenGemsHTML + correlationHeaderHTML);

            // Use parent class method to render regression table
            displayRegressionTableInline(portfolioSection, [portfolioCopiesCorr], tippingPoints);

            // Add combinations and sequences after table
            const combinationsHTML = this.generateCopyCombinationsHTML(topCopyCombos);
            const portfolioSequencesHTML = this.generatePortfolioSequencesHTML(topSequences);
            portfolioSection.insertAdjacentHTML('beforeend', combinationsHTML + portfolioSequencesHTML);
        }
    }

    /**
     * Render Subscription Analysis tab content
     */
    renderSubscriptionAnalysis(correlationResults, regressionResults, tippingPoints, engagementSummary, topSubscriptionCombos, summaryStats) {
        const subscriptionContainer = document.getElementById('qdaSubscriptionsInline');
        const priceContainer = document.getElementById('qdaSubscriptionPriceInline');

        if (!subscriptionContainer) return;

        // Filter correlation data for Subscriptions
        const subscriptionsCorr = correlationResults.find(r => r.outcome === 'totalSubscriptions');

        if (subscriptionsCorr) {
            const subscriptionSection = document.createElement('div');
            subscriptionSection.className = 'qda-result-section';
            subscriptionSection.innerHTML = '<h2>Subscriptions</h2>';
            subscriptionContainer.appendChild(subscriptionSection);

            // Add metrics and correlation header
            const metricsHTML = this.generateSubscriptionMetricsHTML(engagementSummary);
            const correlationHeaderHTML = this.generateCorrelationHeaderHTML('Top Subscription Drivers', 'The top events that are the strongest predictors of subscriptions');
            subscriptionSection.insertAdjacentHTML('beforeend', metricsHTML + correlationHeaderHTML);

            // Use parent class method to render regression table
            displayRegressionTableInline(subscriptionSection, [subscriptionsCorr], tippingPoints);

            // Add combinations after table
            const combinationsHTML = this.generateSubscriptionCombinationsHTML(topSubscriptionCombos);
            subscriptionSection.insertAdjacentHTML('beforeend', combinationsHTML);
        }

        // Add subscription price distribution
        if (priceContainer && summaryStats) {
            const priceSection = document.createElement('div');
            priceSection.className = 'qda-result-section';
            priceSection.innerHTML = '<h2>Subscription Price Distribution</h2>';
            priceContainer.appendChild(priceSection);

            // Extract subscription price data from summaryStats if available
            if (summaryStats.subscriptionPrices && Object.keys(summaryStats.subscriptionPrices).length > 0) {
                const priceTable = this.createSubscriptionPriceTable(summaryStats.subscriptionPrices);
                priceSection.appendChild(priceTable);
            } else {
                priceSection.innerHTML += '<p style="color: #6c757d; font-style: italic;">Subscription price data will be available in a future update.</p>';
            }
        }
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

}

// Export to window
window.UserAnalysisToolSupabase = UserAnalysisToolSupabase;

console.log('✅ User Analysis Tool (Supabase) loaded successfully!');
