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
            this.supabaseIntegration.loadTopSubscriptionCombinations('lift', 10).catch(e => { console.warn('Failed to load subscription combos:', e); return []; }),
            this.supabaseIntegration.loadHiddenGems().catch(e => { console.warn('Failed to load hidden gems:', e); return []; }),
            this.supabaseIntegration.loadHiddenGemsSummary().catch(e => { console.warn('Failed to load hidden gems summary:', e); return null; }),
            this.supabaseIntegration.loadCopyEngagementSummary().catch(e => { console.warn('Failed to load copy engagement summary:', e); return null; }),
            this.supabaseIntegration.loadTopCopyCombinations('lift', 10).catch(e => { console.warn('Failed to load copy combos:', e); return []; }),
            this.supabaseIntegration.loadTopPortfolioSequenceCombinations('lift', 10).catch(e => { console.warn('Failed to load sequences:', e); return []; })
        ]);

        // Clear output container and create results div
        this.outputContainer.innerHTML = '';

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

        // Create containers for base analysis (parent functions need these in DOM)
        resultsDiv.innerHTML += `
            <div id="qdaSummaryStatsInline"></div>
            <div id="qdaDemographicBreakdownInline"></div>
            <div id="qdaPersonaBreakdownInline"></div>
            <div id="qdaCombinedResultsInline"></div>
        `;

        // Update last updated timestamp
        const timestampStr = new Date().toLocaleString('en-US', {
            month: 'numeric',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
        localStorage.setItem('qdaLastUpdated', timestampStr);

        // Display base results using parent's functions (now elements are in DOM)
        displaySummaryStatsInline(results.summaryStats);
        displayDemographicBreakdownInline(results.summaryStats);
        displayPersonaBreakdownInline(results.summaryStats);

        // Load tipping points
        const analysisData = JSON.parse(localStorage.getItem('qdaAnalysisResults') || 'null');
        const tippingPoints = analysisData?.tippingPoints || JSON.parse(localStorage.getItem('qdaTippingPoints') || 'null');
        displayCombinedAnalysisInline(results.correlationResults, results.regressionResults, null, tippingPoints);

        // Inject Hidden Gems into Persona Breakdown section
        const personaSection = document.getElementById('qdaPersonaBreakdownInline');
        if (personaSection) {
            personaSection.insertAdjacentHTML('beforeend', this.generateHiddenGemsHTML(hiddenGemsSummary, hiddenGems));
        }

        // Inject Copy Engagement and Portfolio Sequences into Portfolio Copies section in Behavioral Analysis
        const behavioralSection = document.getElementById('qdaCombinedResultsInline');
        if (behavioralSection) {
            // Find the Portfolio Copies h2 and insert after its table
            const portfolioCopiesH2 = Array.from(behavioralSection.querySelectorAll('h2')).find(h => h.textContent === 'Portfolio Copies');
            if (portfolioCopiesH2) {
                const table = portfolioCopiesH2.nextElementSibling;
                if (table) {
                    const copyEngagementHTML = this.generateCopyEngagementHTML(copyEngagementSummary, topCopyCombos);
                    const portfolioSequencesHTML = this.generatePortfolioSequencesHTML(topSequences);
                    table.insertAdjacentHTML('afterend', copyEngagementHTML + portfolioSequencesHTML);
                }
            }
        }

        // Inject Subscription Engagement into Subscriptions section in Behavioral Analysis
        if (behavioralSection) {
            const subscriptionsH2 = Array.from(behavioralSection.querySelectorAll('h2')).find(h => h.textContent === 'Subscriptions');
            if (subscriptionsH2) {
                const table = subscriptionsH2.nextElementSibling;
                if (table) {
                    table.insertAdjacentHTML('afterend', this.generateSubscriptionEngagementHTML(engagementSummary, topSubscriptionCombos));
                }
            }
        }

        return resultsDiv.outerHTML;
    }

    /**
     * Generate Subscription Engagement HTML
     */
    generateSubscriptionEngagementHTML(summaryData, topCombinations) {
        if (!summaryData && (!topCombinations || topCombinations.length === 0)) {
            return '';
        }

        let html = '<div class="qda-result-section" style="margin-top: 2rem;">';

        // Summary Stats
        if (summaryData && summaryData.length === 2) {
            const subscribersData = summaryData.find(d => d.did_subscribe === true) || {};
            const nonSubscribersData = summaryData.find(d => d.did_subscribe === false) || {};

            const metrics = [
                { label: 'Avg Profile Views', primaryValue: subscribersData.avg_profile_views || 0, secondaryValue: nonSubscribersData.avg_profile_views || 0 },
                { label: 'Avg PDP Views', primaryValue: subscribersData.avg_pdp_views || 0, secondaryValue: nonSubscribersData.avg_pdp_views || 0 },
                { label: 'Unique Creators', primaryValue: subscribersData.avg_unique_creators || 0, secondaryValue: nonSubscribersData.avg_unique_creators || 0 },
                { label: 'Unique Portfolios', primaryValue: subscribersData.avg_unique_portfolios || 0, secondaryValue: nonSubscribersData.avg_unique_portfolios || 0 }
            ];

            html += '<h3 style="margin-top: 1.5rem;">Subscription Engagement</h3>';
            html += '<div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 2rem;">';

            metrics.forEach(metric => {
                html += `
                    <div style="background-color: #f8f9fa; padding: 1rem; border-radius: 8px;">
                        <div style="font-size: 0.875rem; color: #2563eb; font-weight: 600; margin-bottom: 0.5rem;">${metric.label}</div>
                        <div style="font-size: 1.5rem; font-weight: bold;">
                            ${parseFloat(metric.primaryValue).toFixed(1)}
                            <span style="font-size: 0.9rem; color: #6c757d; font-weight: normal;">vs ${parseFloat(metric.secondaryValue).toFixed(1)}</span>
                        </div>
                    </div>
                `;
            });

            html += '</div>';
        }

        // High-Impact Creator Combinations
        if (topCombinations && topCombinations.length > 0) {
            html += this.generateCombinationsTableHTML(
                'High-Impact Creator Combinations',
                'Users who viewed these creator combinations were significantly more likely to subscribe',
                topCombinations,
                (combo) => `${combo.username_1 || combo.value_1}, ${combo.username_2 || combo.value_2}, ${combo.username_3 || combo.value_3}`,
                'Creators Viewed',
                'Total Subs'
            );
        }

        html += '</div>';
        return html;
    }

    /**
     * Generate Hidden Gems HTML
     */
    generateHiddenGemsHTML(summaryData, hiddenGems) {
        if (!summaryData && (!hiddenGems || hiddenGems.length === 0)) {
            return '';
        }

        let html = '<div class="qda-result-section" style="margin-top: 2rem;">';
        html += '<h3 style="margin-top: 1.5rem; margin-bottom: 0.25rem;">Hidden Gems</h3>';
        html += '<p style="font-size: 0.875rem; color: #6c757d; margin-top: 0; margin-bottom: 1rem;">Portfolios with high engagement but low conversion (PDP views to copies ratio ≥ 7:1)</p>';

        // Summary Stats
        if (summaryData) {
            html += '<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-bottom: 2rem;">';

            const metrics = [
                { label: 'Total Hidden Gems', value: summaryData.total_hidden_gems || 0, format: 'number' },
                { label: 'Avg PDP Views', value: summaryData.avg_pdp_views || 0, format: 'decimal' },
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

                html += `
                    <div style="background-color: #f8f9fa; padding: 1rem; border-radius: 8px;">
                        <div style="font-size: 0.875rem; color: #2563eb; font-weight: 600; margin-bottom: 0.5rem;">${metric.label}</div>
                        <div style="font-size: 1.5rem; font-weight: bold;">${displayValue}</div>
                    </div>
                `;
            });

            html += '</div>';
        }

        // Hidden Gems Table
        const topHiddenGems = hiddenGems && hiddenGems.length > 0 ? hiddenGems.slice(0, 10) : [];

        if (topHiddenGems.length > 0) {
            html += '<table style="width: 100%; border-collapse: collapse; margin-top: 1rem; font-size: 0.85rem; font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;">';
            html += `
                <thead>
                    <tr style="background-color: #f8f9fa; border-bottom: 2px solid #dee2e6;">
                        <th style="padding: 0.75rem; text-align: left;">Portfolio</th>
                        <th style="padding: 0.75rem; text-align: left;">Creator</th>
                        <th style="padding: 0.75rem; text-align: right;">PDP Views</th>
                        <th style="padding: 0.75rem; text-align: right;">Unique Views</th>
                        <th style="padding: 0.75rem; text-align: right;">Copies</th>
                        <th style="padding: 0.75rem; text-align: right;">Conv Rate</th>
                    </tr>
                </thead>
                <tbody>
            `;

            topHiddenGems.forEach((gem, index) => {
                const rowBg = index % 2 === 0 ? '#ffffff' : '#f8f9fa';
                html += `
                    <tr style="border-bottom: 1px solid #dee2e6; background-color: ${rowBg};">
                        <td style="padding: 0.75rem;">${gem.portfolio_ticker || 'N/A'}</td>
                        <td style="padding: 0.75rem;">${gem.creator_username || 'N/A'}</td>
                        <td style="padding: 0.75rem; text-align: right;">${parseInt(gem.total_pdp_views).toLocaleString()}</td>
                        <td style="padding: 0.75rem; text-align: right;">${parseInt(gem.unique_views).toLocaleString()}</td>
                        <td style="padding: 0.75rem; text-align: right;">${parseInt(gem.total_copies).toLocaleString()}</td>
                        <td style="padding: 0.75rem; text-align: right;">${parseFloat(gem.conversion_rate_pct).toFixed(1)}%</td>
                    </tr>
                `;
            });

            html += '</tbody></table>';
        }

        html += '</div>';
        return html;
    }

    /**
     * Generate Copy Engagement HTML
     */
    generateCopyEngagementHTML(summaryData, topCombinations) {
        if (!summaryData && (!topCombinations || topCombinations.length === 0)) {
            return '';
        }

        let html = '<div class="qda-result-section" style="margin-top: 2rem;">';

        // Summary Stats
        if (summaryData && summaryData.length === 2) {
            const copiersData = summaryData.find(d => d.did_copy === true) || {};
            const nonCopiersData = summaryData.find(d => d.did_copy === false) || {};

            const metrics = [
                { label: 'Avg Profile Views', primaryValue: copiersData.avg_profile_views || 0, secondaryValue: nonCopiersData.avg_profile_views || 0 },
                { label: 'Avg PDP Views', primaryValue: copiersData.avg_pdp_views || 0, secondaryValue: nonCopiersData.avg_pdp_views || 0 },
                { label: 'Unique Creators', primaryValue: copiersData.avg_unique_creators || 0, secondaryValue: nonCopiersData.avg_unique_creators || 0 },
                { label: 'Unique Portfolios', primaryValue: copiersData.avg_unique_portfolios || 0, secondaryValue: nonCopiersData.avg_unique_portfolios || 0 }
            ];

            html += '<h3 style="margin-top: 1.5rem;">Copy Engagement</h3>';
            html += '<div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 2rem;">';

            metrics.forEach(metric => {
                html += `
                    <div style="background-color: #f8f9fa; padding: 1rem; border-radius: 8px;">
                        <div style="font-size: 0.875rem; color: #2563eb; font-weight: 600; margin-bottom: 0.5rem;">${metric.label}</div>
                        <div style="font-size: 1.5rem; font-weight: bold;">
                            ${parseFloat(metric.primaryValue).toFixed(1)}
                            <span style="font-size: 0.9rem; color: #6c757d; font-weight: normal;">vs ${parseFloat(metric.secondaryValue).toFixed(1)}</span>
                        </div>
                    </div>
                `;
            });

            html += '</div>';
        }

        // High-Impact Portfolio Combinations
        if (topCombinations && topCombinations.length > 0) {
            html += this.generateCombinationsTableHTML(
                'High-Impact Portfolio Combinations',
                'Users who viewed these portfolio combinations were significantly more likely to copy',
                topCombinations,
                (combo) => `${combo.value_1}, ${combo.value_2}, ${combo.value_3}`,
                'Portfolios Viewed',
                'Total Copies'
            );
        }

        html += '</div>';
        return html;
    }

    /**
     * Generate Portfolio Sequences HTML
     */
    generatePortfolioSequencesHTML(topSequences) {
        if (!topSequences || topSequences.length === 0) {
            return '';
        }

        let html = '<div class="qda-result-section" style="margin-top: 2rem;">';
        html += '<h3 style="margin-top: 1.5rem;">Portfolio Sequences</h3>';

        html += this.generateCombinationsTableHTML(
            'High-Impact Portfolio View Sequences',
            'Users who viewed portfolios in these specific sequences (1st → 2nd → 3rd) were significantly more likely to copy',
            topSequences,
            (seq) => `${seq.value_1} → ${seq.value_2} → ${seq.value_3}`,
            'Portfolio Sequence',
            'Total Copies'
        );

        html += '</div>';
        return html;
    }

    /**
     * Generate Combinations Table HTML (DRY helper)
     */
    generateCombinationsTableHTML(title, subtitle, data, valueFormatter, columnLabel, conversionLabel) {
        let html = '<div style="margin-top: 2rem;">';
        html += `<h5 style="font-size: 0.95rem; font-weight: 600; margin-bottom: 0.25rem;">${title}</h5>`;
        html += `<p style="font-size: 0.875rem; color: #6c757d; margin-top: 0; margin-bottom: 1rem;">${subtitle}</p>`;

        html += '<table style="width: 100%; border-collapse: collapse; margin-top: 1rem; font-size: 0.85rem; font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;">';
        html += `
            <thead>
                <tr style="background-color: #f8f9fa; border-bottom: 2px solid #dee2e6;">
                    <th style="padding: 0.75rem; text-align: left;">Rank</th>
                    <th style="padding: 0.75rem; text-align: left;">${columnLabel}</th>
                    <th style="padding: 0.75rem; text-align: right;">Impact</th>
                    <th style="padding: 0.75rem; text-align: right;">Users</th>
                    <th style="padding: 0.75rem; text-align: right;">${conversionLabel}</th>
                    <th style="padding: 0.75rem; text-align: right;">Conv Rate</th>
                </tr>
            </thead>
            <tbody>
        `;

        data.forEach((combo, index) => {
            const displayValue = valueFormatter(combo);
            const rowBg = index % 2 === 0 ? '#ffffff' : '#f8f9fa';
            html += `
                <tr style="border-bottom: 1px solid #dee2e6; background-color: ${rowBg};">
                    <td style="padding: 0.75rem; font-weight: 600;">${index + 1}</td>
                    <td style="padding: 0.75rem;">${displayValue}</td>
                    <td style="padding: 0.75rem; text-align: right; font-weight: 600; color: #2563eb;">${parseFloat(combo.lift).toFixed(2)}x lift</td>
                    <td style="padding: 0.75rem; text-align: right;">${parseInt(combo.users_with_exposure).toLocaleString()}</td>
                    <td style="padding: 0.75rem; text-align: right;">${parseInt(combo.total_conversions || 0).toLocaleString()}</td>
                    <td style="padding: 0.75rem; text-align: right;">${(parseFloat(combo.conversion_rate_in_group) * 100).toFixed(1)}%</td>
                </tr>
            `;
        });

        html += '</tbody></table></div>';
        return html;
    }

}

// Export to window
window.UserAnalysisToolSupabase = UserAnalysisToolSupabase;

console.log('✅ User Analysis Tool (Supabase) loaded successfully!');
