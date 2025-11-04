// Creator Analysis Tool - Supabase Version
// Extends CreatorAnalysisTool to use Supabase instead of direct API calls

'use strict';

/**
 * Supabase-powered version of CreatorAnalysisTool
 * Overrides specific methods to use Supabase Edge Functions and database
 */
class CreatorAnalysisToolSupabase extends CreatorAnalysisTool {
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

        // Restore from unified cache (same pattern as user tabs)
        this.restoreFromUnifiedCache();

        // Always hide the upload form container (it's inside creatorContent)
        // The data source buttons should always be visible
        if (container) {
            container.style.display = 'none';
        }

        // Remove borders and padding from wrapper since data source buttons are in separate component
        const wrapper = container.querySelector('.qda-inline-widget');
        if (wrapper) {
            wrapper.style.border = 'none';
            wrapper.style.padding = '0';
            wrapper.style.background = 'transparent';
        }

        // Also remove padding from content div to avoid empty space
        const content = container.querySelector('.qda-content');
        if (content) {
            content.style.padding = '0';
        }
    }

    /**
     * Override: Create mode section - Only create upload section (buttons are in unified component)
     */
    createModeSection() {
        const section = document.createElement('div');
        section.id = 'creatorModeSection';
        section.style.display = 'none'; // Hide entire section by default

        // File upload section (hidden by default) - Now supports 3 files
        const uploadSection = document.createElement('div');
        uploadSection.id = 'creatorUploadSection';
        uploadSection.style.cssText = 'border: 2px dashed #17a2b8; border-radius: 8px; padding: 20px; background: #f8f9fa; margin-top: 15px;';
        uploadSection.innerHTML = `
            <div style="text-align: left;">
                <div style="font-weight: bold; color: #333; margin-bottom: 15px; text-align: center;">
                    Upload 3 CSV Files for Merging
                </div>
                <div style="font-size: 12px; color: #6c757d; margin-bottom: 20px; text-align: center;">
                    Files will be merged using two-stage matching: Deals→Creator List (by name), then merge with Public Creators (by email)
                </div>

                <label style="font-weight: bold; color: #333; display: block; margin-bottom: 5px;">
                    1. Creator List CSV
                </label>
                <div style="font-size: 11px; color: #6c757d; margin-bottom: 5px;">
                    Contains: Name, Registered dub Account Email, Premium: Name of Fund
                </div>
                <input type="file" id="creatorListFileInput" accept=".csv" style="padding: 8px; border: 1px solid #ddd; border-radius: 4px; width: 100%; margin-bottom: 15px;">

                <label style="font-weight: bold; color: #333; display: block; margin-bottom: 5px;">
                    2. Deals CSV
                </label>
                <div style="font-size: 11px; color: #6c757d; margin-bottom: 5px;">
                    Contains: Deal-Title, Deal-Organization, Deal-Contact Person
                </div>
                <input type="file" id="dealsFileInput" accept=".csv" style="padding: 8px; border: 1px solid #ddd; border-radius: 4px; width: 100%; margin-bottom: 15px;">

                <label style="font-weight: bold; color: #333; display: block; margin-bottom: 5px;">
                    3. Public Creators CSV
                </label>
                <div style="font-size: 11px; color: #6c757d; margin-bottom: 5px;">
                    Contains: email, firstname, lastname, displayname, handle, description
                </div>
                <input type="file" id="publicCreatorsFileInput" accept=".csv" style="padding: 8px; border: 1px solid #ddd; border-radius: 4px; width: 100%; margin-bottom: 15px;">

                <button id="creatorProcessButton" class="qda-btn" style="display: block; width: 100%; margin-top: 10px;">
                    Process Files
                </button>
            </div>
        `;
        section.appendChild(uploadSection);

        return section;
    }

    /**
     * Override: Display results - Only show summary and affinity (hide behavioral analysis)
     * EXACT same pattern as Portfolio/Subscription tabs - uses unified cache
     */
    async displayResults(results, timestampStr = null) {
        // Clear output container
        this.outputContainer.innerHTML = '';

        // Create results div
        const resultsDiv = document.createElement('div');
        resultsDiv.id = 'creatorAnalysisResultsInline';
        resultsDiv.className = 'qda-analysis-results';
        this.outputContainer.appendChild(resultsDiv);

        // Create containers - SKIP behavioral analysis
        const summaryContainer = document.createElement('div');
        summaryContainer.id = 'creatorSummaryStatsInline';
        resultsDiv.appendChild(summaryContainer);

        const breakdownContainer = document.createElement('div');
        breakdownContainer.id = 'premiumCreatorBreakdownInline';
        resultsDiv.appendChild(breakdownContainer);

        const affinityContainer = document.createElement('div');
        affinityContainer.id = 'premiumCreatorAffinityInline';
        resultsDiv.appendChild(affinityContainer);

        // Display results - SKIP behavioral analysis
        this.displayCreatorSummaryStats(results.summaryStats);

        // Load and display premium creator breakdown
        await this.loadAndDisplayPremiumCreatorBreakdown();

        // Load and display premium creator copy affinity
        await this.loadAndDisplayPremiumCreatorAffinity();

        // Add data scope text (top left) and timestamp (top right) - EXACT same pattern as other tabs
        // If timestampStr is provided, use it (from fresh sync), otherwise get from unified cache
        if (!timestampStr) {
            const cached = localStorage.getItem('dubAnalysisResults');
            if (cached) {
                const data = JSON.parse(cached);
                timestampStr = data.timestamp;
            }
        }

        if (timestampStr) {
            // Format timestamp to match other tabs
            const formattedTimestamp = new Date(timestampStr).toLocaleString('en-US', {
                month: 'numeric',
                day: 'numeric',
                year: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            });

            // Add timestamp first (will be inserted at position 0)
            const timestamp = document.createElement('div');
            timestamp.className = 'qda-timestamp';
            timestamp.textContent = `Last updated: ${formattedTimestamp}`;
            resultsDiv.insertBefore(timestamp, resultsDiv.firstChild);

            // Add data scope text second (will be inserted at position 0, pushing timestamp to position 1)
            const dataScope = document.createElement('div');
            dataScope.className = 'qda-data-scope';
            dataScope.textContent = 'Data for KYC approved users from the last 30 days';
            resultsDiv.insertBefore(dataScope, resultsDiv.firstChild);
        }

        resultsDiv.style.display = 'block';

        // Save HTML to unified cache (same as other tabs)
        this.saveToUnifiedCache();
    }

    /**
     * Save creator analysis HTML to unified cache
     */
    saveToUnifiedCache() {
        try {
            const cached = localStorage.getItem('dubAnalysisResults');
            const data = cached ? JSON.parse(cached) : {};

            // Add creator tab HTML to unified cache
            data.creator = this.outputContainer.innerHTML;

            localStorage.setItem('dubAnalysisResults', JSON.stringify(data));
            console.log('✅ Saved creator analysis to unified cache');
        } catch (e) {
            console.warn('Failed to save creator analysis to unified cache:', e);
        }
    }

    /**
     * Restore creator analysis from unified cache
     */
    restoreFromUnifiedCache() {
        try {
            const cached = localStorage.getItem('dubAnalysisResults');
            if (cached) {
                const data = JSON.parse(cached);
                if (data.creator && this.outputContainer) {
                    this.outputContainer.innerHTML = data.creator;
                    const cacheAge = data.timestamp ? Math.floor((Date.now() - new Date(data.timestamp).getTime()) / 60000) : null;
                    console.log(`✅ Restored creator analysis from unified cache${cacheAge ? ` (${cacheAge} min ago)` : ''}`);
                }
            }
        } catch (e) {
            console.warn('Failed to restore creator analysis from unified cache:', e);
        }
    }

    /**
     * Override: Display creator summary statistics - Show 4 averaged metric cards
     */
    async displayCreatorSummaryStats(stats) {
        const container = document.getElementById('creatorSummaryStatsInline');
        if (!container) {
            console.error('❌ Container creatorSummaryStatsInline not found!');
            return;
        }
        container.innerHTML = '';

        const section = document.createElement('div');
        section.className = 'qda-result-section';

        // Add H1 title with tooltip - matching exact style from Portfolio Analysis
        const creatorH1Tooltip = `<span class="info-tooltip" style="vertical-align: middle; margin-left: 8px;">
            <span class="info-icon">i</span>
            <span class="tooltip-text">
                <strong>Premium Creator Analysis</strong>
                Average engagement metrics per premium creator portfolio.
                <ul>
                    <li><strong>Data Sources:</strong>
                        <a href="https://mixpanel.com/project/2599235/view/3138115/app/boards#id=10576025&editor-card-id=%22report-85725073%22" target="_blank" style="color: #17a2b8;">Chart 85725073</a> (Premium Creators),
                        <a href="https://mixpanel.com/project/2599235/view/3138115/app/boards#id=10576025&editor-card-id=%22report-85810770%22" target="_blank" style="color: #17a2b8;">Chart 85810770</a> (Portfolio Metrics)
                    </li>
                    <li><strong>Metrics:</strong> Averaged across all premium creator portfolios</li>
                </ul>
            </span>
        </span>`;

        section.innerHTML = `<h1 style="margin-bottom: 0.25rem; display: inline;">Premium Creator Analysis</h1>${creatorH1Tooltip}`;
        container.appendChild(section);

        // Fetch averaged metrics from Supabase
        const metrics = await this.fetchPremiumCreatorMetrics();

        if (metrics) {
            const metricSummary = document.createElement('div');
            metricSummary.className = 'qda-metric-summary';
            // Override grid to use 4 columns instead of default 5
            metricSummary.style.gridTemplateColumns = 'repeat(4, 1fr)';

            // Create 4 metric cards with conversion rates and tooltips
            const cards = [
                ['Avg Copy CVR', metrics.avg_copy_cvr ? metrics.avg_copy_cvr.toLocaleString(undefined, {maximumFractionDigits: 2}) + '%' : '0%', 'Viewed PDP → Copied Portfolio'],
                ['Avg Subscription CVR', metrics.avg_subscription_cvr ? metrics.avg_subscription_cvr.toLocaleString(undefined, {maximumFractionDigits: 2}) + '%' : '0%', 'Viewed Paywall → Subscribed to Creator'],
                ['Avg Liquidation Rate', metrics.avg_liquidation_rate ? metrics.avg_liquidation_rate.toLocaleString(undefined, {maximumFractionDigits: 2}) + '%' : '0%', 'Copied Portfolio → Liquidate Portfolio'],
                ['Avg Cancellation Rate', metrics.avg_cancellation_rate ? metrics.avg_cancellation_rate.toLocaleString(undefined, {maximumFractionDigits: 2}) + '%' : '0%', 'Subscribed to Creator → Cancelled Subscription']
            ];

            cards.forEach(([title, content, tooltip]) => {
                const card = document.createElement('div');
                card.className = 'qda-metric-card';
                card.innerHTML = `
                    <div style="font-size: 0.875rem; color: #2563eb; font-weight: 600; margin-bottom: 0.5rem; display: flex; align-items: center; gap: 4px;">
                        ${title}
                        <span class="info-tooltip" style="display: inline-flex; align-items: center;">
                            <span class="info-icon">i</span>
                            <span class="tooltip-text">${tooltip}</span>
                        </span>
                    </div>
                    <div style="font-size: 1.5rem; font-weight: bold; color: #000;">${content}</div>
                `;
                metricSummary.appendChild(card);
            });

            section.appendChild(metricSummary);
        }
    }

    /**
     * Fetch premium creator portfolio metrics (averaged)
     */
    async fetchPremiumCreatorMetrics() {
        try {
            if (!this.supabaseIntegration) {
                console.error('Supabase not configured');
                return null;
            }

            const { data, error } = await this.supabaseIntegration.supabase
                .from('portfolio_creator_engagement_metrics')
                .select(`
                    total_pdp_views,
                    total_profile_views,
                    total_copies,
                    total_subscriptions,
                    total_paywall_views,
                    total_liquidations,
                    total_cancellations,
                    creator_id
                `)
                .in('creator_id',
                    await this.supabaseIntegration.supabase
                        .from('premium_creators')
                        .select('creator_id')
                        .then(({ data }) => data.map(row => row.creator_id))
                );

            if (error) {
                console.error('Error fetching premium creator metrics:', error);
                return null;
            }

            if (!data || data.length === 0) {
                console.log('No premium creator metrics found');
                return {
                    avg_copy_cvr: 0,
                    avg_subscription_cvr: 0,
                    avg_liquidation_rate: 0,
                    avg_cancellation_rate: 0
                };
            }

            // Calculate conversion rates client-side, then average them
            const conversionRates = data.map(row => ({
                copy_cvr: (row.total_pdp_views > 0) ? (row.total_copies / row.total_pdp_views * 100) : 0,
                subscription_cvr: (row.total_paywall_views > 0) ? (row.total_subscriptions / row.total_paywall_views * 100) : 0,
                liquidation_rate: (row.total_copies > 0) ? (row.total_liquidations / row.total_copies * 100) : 0,
                cancellation_rate: (row.total_subscriptions > 0) ? (row.total_cancellations / row.total_subscriptions * 100) : 0
            }));

            const count = conversionRates.length;
            const totals = conversionRates.reduce((acc, rates) => ({
                copy_cvr: acc.copy_cvr + rates.copy_cvr,
                subscription_cvr: acc.subscription_cvr + rates.subscription_cvr,
                liquidation_rate: acc.liquidation_rate + rates.liquidation_rate,
                cancellation_rate: acc.cancellation_rate + rates.cancellation_rate
            }), { copy_cvr: 0, subscription_cvr: 0, liquidation_rate: 0, cancellation_rate: 0 });

            return {
                avg_copy_cvr: totals.copy_cvr / count,
                avg_subscription_cvr: totals.subscription_cvr / count,
                avg_liquidation_rate: totals.liquidation_rate / count,
                avg_cancellation_rate: totals.cancellation_rate / count,
                total_portfolios: count
            };

        } catch (error) {
            console.error('Error in fetchPremiumCreatorMetrics:', error);
            return null;
        }
    }

    /**
     * Update timestamp and data scope after sync (matching user tool pattern)
     */
    updateTimestampAndDataScope() {
        const resultsDiv = document.getElementById('creatorAnalysisResultsInline');
        if (!resultsDiv) return;

        // Remove existing timestamp and data scope
        const existingTimestamp = resultsDiv.querySelector('.qda-timestamp');
        const existingDataScope = resultsDiv.querySelector('.qda-data-scope');
        if (existingTimestamp) existingTimestamp.remove();
        if (existingDataScope) existingDataScope.remove();

        // Get timestamp from unified cache (set by user tool during sync)
        const cached = localStorage.getItem('dubAnalysisResults');
        let timestampStr = null;
        if (cached) {
            const data = JSON.parse(cached);
            timestampStr = data.timestamp;
        }

        if (timestampStr) {
            // Format timestamp to match other tabs
            const formattedTimestamp = new Date(timestampStr).toLocaleString('en-US', {
                month: 'numeric',
                day: 'numeric',
                year: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            });

            // Add timestamp first (will be inserted at position 0)
            const timestamp = document.createElement('div');
            timestamp.className = 'qda-timestamp';
            timestamp.textContent = `Last updated: ${formattedTimestamp}`;
            resultsDiv.insertBefore(timestamp, resultsDiv.firstChild);

            // Add data scope text second (will be inserted at position 0, pushing timestamp to position 1)
            const dataScope = document.createElement('div');
            dataScope.className = 'qda-data-scope';
            dataScope.textContent = 'Data for KYC approved users from the last 30 days';
            resultsDiv.insertBefore(dataScope, resultsDiv.firstChild);
        }
    }

    /**
     * Load and display premium creator breakdown table
     */
    async loadAndDisplayPremiumCreatorBreakdown() {
        try {
            if (!this.supabaseIntegration) {
                console.error('Supabase not configured');
                return;
            }

            console.log('Loading premium creator breakdown...');

            // Get premium creator list
            const { data: premiumCreators, error: pcError } = await this.supabaseIntegration.supabase
                .from('premium_creators')
                .select('creator_id, creator_username');

            if (pcError || !premiumCreators) {
                console.error('Error loading premium creators:', pcError);
                return;
            }

            const creatorIds = premiumCreators.map(pc => pc.creator_id);

            // Get portfolio-level engagement metrics (same source as metric cards)
            // This aggregates from user-level data in user_portfolio_creator_engagement
            const { data: portfolioEngagement, error: peError } = await this.supabaseIntegration.supabase
                .from('portfolio_creator_engagement_metrics')
                .select('*')
                .in('creator_id', creatorIds);

            if (peError) {
                console.error('Error loading portfolio engagement metrics:', peError);
                return;
            }

            // Get subscription metrics from premium_creator_metrics (creator-level)
            const { data: creatorMetrics, error: cmError } = await this.supabaseIntegration.supabase
                .from('premium_creator_metrics')
                .select('*')
                .in('creator_id', creatorIds);

            if (cmError) {
                console.error('Error loading creator metrics:', cmError);
                return;
            }

            // Aggregate metrics by creator (sum across all portfolios)
            const breakdownByCreator = premiumCreators.map(pc => {
                const creatorPortfolios = portfolioEngagement?.filter(pe => pe.creator_id === pc.creator_id) || [];
                const creatorMetric = creatorMetrics?.find(cm => cm.creator_id === pc.creator_id);

                // Sum portfolio-level metrics (same as metric cards calculation)
                const totalCopies = creatorPortfolios.reduce((sum, p) => sum + (p.total_copies || 0), 0);
                const totalPdpViews = creatorPortfolios.reduce((sum, p) => sum + (p.total_pdp_views || 0), 0);
                const totalLiquidations = creatorPortfolios.reduce((sum, p) => sum + (p.total_liquidations || 0), 0);

                // Get subscription metrics from creator-level table
                const totalSubscriptions = creatorMetric?.total_subscriptions || 0;
                const totalPaywallViews = creatorMetric?.total_paywall_views || 0;
                const totalCancellations = creatorMetric?.total_cancellations || 0;

                return {
                    creator_username: pc.creator_username,
                    total_copies: totalCopies,
                    total_pdp_views: totalPdpViews,
                    total_liquidations: totalLiquidations,
                    total_subscriptions: totalSubscriptions,
                    total_paywall_views: totalPaywallViews,
                    total_cancellations: totalCancellations
                };
            });

            // Merge @dubadvisors rows by username (group by creator_username)
            const usernameMap = new Map();
            breakdownByCreator.forEach(row => {
                const username = row.creator_username;
                if (!usernameMap.has(username)) {
                    usernameMap.set(username, {
                        creator_username: username,
                        total_copies: 0,
                        total_pdp_views: 0,
                        total_liquidations: 0,
                        total_subscriptions: 0,
                        total_paywall_views: 0,
                        total_cancellations: 0
                    });
                }
                const existing = usernameMap.get(username);
                existing.total_copies += row.total_copies;
                existing.total_pdp_views += row.total_pdp_views;
                existing.total_liquidations += row.total_liquidations;
                existing.total_subscriptions += row.total_subscriptions;
                existing.total_paywall_views += row.total_paywall_views;
                existing.total_cancellations += row.total_cancellations;
            });

            // Calculate conversion rates after merging
            const breakdownData = Array.from(usernameMap.values()).map(row => {
                const copyCvr = row.total_pdp_views > 0 ? (row.total_copies / row.total_pdp_views) * 100 : 0;
                const subscriptionCvr = row.total_paywall_views > 0 ? (row.total_subscriptions / row.total_paywall_views) * 100 : 0;
                const liquidationRate = row.total_copies > 0 ? (row.total_liquidations / row.total_copies) * 100 : 0;
                const cancellationRate = row.total_subscriptions > 0 ? (row.total_cancellations / row.total_subscriptions) * 100 : 0;

                return {
                    creator_username: row.creator_username,
                    total_copies: row.total_copies,
                    copy_cvr: copyCvr,
                    total_subscriptions: row.total_subscriptions,
                    subscription_cvr: subscriptionCvr,
                    total_liquidations: row.total_liquidations,
                    liquidation_rate: liquidationRate,
                    cancellation_rate: cancellationRate
                };
            });

            console.log(`✅ Loaded ${breakdownData.length} premium creators for breakdown`);
            this.displayPremiumCreatorBreakdown(breakdownData);
        } catch (error) {
            console.error('Error in loadAndDisplayPremiumCreatorBreakdown:', error);
        }
    }

    /**
     * Display premium creator breakdown table
     */
    displayPremiumCreatorBreakdown(breakdownData) {
        const container = document.getElementById('premiumCreatorBreakdownInline');
        if (!container) {
            console.error('❌ Container premiumCreatorBreakdownInline not found!');
            return;
        }

        if (!breakdownData || breakdownData.length === 0) {
            container.innerHTML = '';
            return;
        }

        const section = document.createElement('div');
        section.className = 'qda-result-section';
        section.style.marginTop = '3rem';

        const title = document.createElement('h2');
        title.style.cssText = 'margin-top: 0; margin-bottom: 0.5rem; display: inline;';
        title.textContent = 'Premium Creator Breakdown';
        section.appendChild(title);

        const description = document.createElement('p');
        description.style.cssText = 'font-size: 0.875rem; color: #6c757d; margin-top: 0.5rem; margin-bottom: 1rem;';
        description.textContent = 'Conversion metrics breakdown for each premium creator';
        section.appendChild(description);

        // Create table
        const tableWrapper = document.createElement('div');
        tableWrapper.className = 'table-wrapper';

        const table = document.createElement('table');
        table.className = 'qda-regression-table';

        // Table header
        const thead = document.createElement('thead');
        thead.innerHTML = `
            <tr>
                <th style="text-align: left;">Premium Creator</th>
                <th style="text-align: right;">Total Copies</th>
                <th style="text-align: right;">Copy CVR</th>
                <th style="text-align: right;">Total Subscriptions</th>
                <th style="text-align: right;">Subscription CVR</th>
                <th style="text-align: right;">Total Liquidations</th>
                <th style="text-align: right;">Liquidation Rate</th>
                <th style="text-align: right;">Cancellation Rate</th>
            </tr>
        `;
        table.appendChild(thead);

        // Table body - sort by total_copies descending
        const tbody = document.createElement('tbody');
        const sortedData = [...breakdownData].sort((a, b) =>
            (b.total_copies || 0) - (a.total_copies || 0)
        );

        sortedData.forEach(row => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="font-weight: 600;">${row.creator_username || 'N/A'}</td>
                <td style="text-align: right;">${(row.total_copies || 0).toLocaleString()}</td>
                <td style="text-align: right;">${(row.copy_cvr || 0).toFixed(2)}%</td>
                <td style="text-align: right;">${(row.total_subscriptions || 0).toLocaleString()}</td>
                <td style="text-align: right;">${(row.subscription_cvr || 0).toFixed(2)}%</td>
                <td style="text-align: right;">${(row.total_liquidations || 0).toLocaleString()}</td>
                <td style="text-align: right;">${(row.liquidation_rate || 0).toFixed(2)}%</td>
                <td style="text-align: right;">${(row.cancellation_rate || 0).toFixed(2)}%</td>
            `;
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);

        tableWrapper.appendChild(table);
        section.appendChild(tableWrapper);
        container.appendChild(section);
    }

    /**
     * Load and display premium creator copy affinity section
     */
    async loadAndDisplayPremiumCreatorAffinity() {
        try {
            const affinityData = await this.supabaseIntegration.loadPremiumCreatorCopyAffinity();
            this.displayPremiumCreatorAffinity(affinityData);
        } catch (error) {
            console.error('Error loading premium creator affinity:', error);
            const container = document.getElementById('premiumCreatorAffinityInline');
            if (container) {
                container.innerHTML = '<p style="color: #dc3545;">Failed to load premium creator copy affinity data.</p>';
            }
        }
    }

    /**
     * Format a top N cell with line breaks between Regular and Premium
     */
    formatTopCell(cellValue) {
        if (!cellValue || cellValue === '-') {
            return '-';
        }

        // Split by the separator " | " to get Regular and Premium parts
        const parts = cellValue.split(' | ').filter(p => p && p.trim());

        if (parts.length === 0) {
            return '-';
        }

        // Join with line breaks for display
        return parts.join('<br>');
    }

    /**
     * Display premium creator copy affinity table
     */
    displayPremiumCreatorAffinity(affinityData) {
        const container = document.getElementById('premiumCreatorAffinityInline');
        if (!container) {
            console.error('❌ Container premiumCreatorAffinityInline not found!');
            return;
        }

        if (!affinityData || affinityData.length === 0) {
            container.innerHTML = '';
            return;
        }

        const section = document.createElement('div');
        section.className = 'qda-result-section';
        section.style.marginTop = '3rem';

        const title = document.createElement('h2');
        title.style.cssText = 'margin-top: 0; margin-bottom: 0.5rem; display: inline;';
        title.textContent = 'Premium Creator Copy Affinity';
        section.appendChild(title);

        // Add tooltip
        const tooltipHTML = `<span class="info-tooltip" style="vertical-align: middle; margin-left: 8px;">
            <span class="info-icon">i</span>
            <span class="tooltip-text">
                <strong>Premium Creator Copy Affinity</strong>
                Shows which other creators are most frequently copied by users who copied each Premium creator.
                <ul>
                    <li><strong>Data Sources:</strong>
                        <a href="https://mixpanel.com/project/2599235/view/3138115/app/boards#id=10576025&editor-card-id=%22report-85165580%22" target="_blank" style="color: #17a2b8;">Chart 85165580</a> (PDP Views, Copies, Liquidations),
                        <a href="https://mixpanel.com/project/2599235/view/3138115/app/boards#id=10576025&editor-card-id=%22report-85130412%22" target="_blank" style="color: #17a2b8;">Chart 85130412</a> (Creator User Profiles)
                    </li>
                    <li><strong>Analysis:</strong> Identifies co-copying patterns among Premium creator audiences</li>
                    <li><strong>Format:</strong> Shows both Premium and Regular creators copied by each Premium creator's audience</li>
                    <li><strong>Use Case:</strong> Understand creator affinity networks and cross-promotion opportunities</li>
                </ul>
            </span>
        </span>`;

        const tooltipSpan = document.createElement('span');
        tooltipSpan.innerHTML = tooltipHTML;
        section.appendChild(tooltipSpan);

        const description = document.createElement('p');
        description.style.cssText = 'font-size: 0.875rem; color: #6c757d; margin-top: 0.5rem; margin-bottom: 1rem;';
        description.textContent = 'For each Premium creator, view the top 5 creators most frequently copied by their audience';
        section.appendChild(description);

        // Create table
        const tableWrapper = document.createElement('div');
        tableWrapper.className = 'table-wrapper';

        const table = document.createElement('table');
        table.className = 'qda-regression-table';

        // Table header
        const thead = document.createElement('thead');
        thead.innerHTML = `
            <tr>
                <th style="text-align: left;">Premium Creator</th>
                <th style="text-align: right;">Total Copies</th>
                <th style="text-align: right;">Total Liquidations</th>
                <th style="text-align: left;">Top 1</th>
                <th style="text-align: left;">Top 2</th>
                <th style="text-align: left;">Top 3</th>
                <th style="text-align: left;">Top 4</th>
                <th style="text-align: left;">Top 5</th>
            </tr>
        `;
        table.appendChild(thead);

        // Table body - sort by Total Copies descending
        const tbody = document.createElement('tbody');
        const sortedData = [...affinityData].sort((a, b) =>
            (b.premium_creator_total_copies || 0) - (a.premium_creator_total_copies || 0)
        );

        sortedData.forEach(row => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="font-weight: 600;">${row.premium_creator || 'N/A'}</td>
                <td style="text-align: right;">${(row.premium_creator_total_copies || 0).toLocaleString()}</td>
                <td style="text-align: right;">${(row.premium_creator_total_liquidations || 0).toLocaleString()}</td>
                <td style="vertical-align: top; line-height: 1.6;">${this.formatTopCell(row.top_1)}</td>
                <td style="vertical-align: top; line-height: 1.6;">${this.formatTopCell(row.top_2)}</td>
                <td style="vertical-align: top; line-height: 1.6;">${this.formatTopCell(row.top_3)}</td>
                <td style="vertical-align: top; line-height: 1.6;">${this.formatTopCell(row.top_4)}</td>
                <td style="vertical-align: top; line-height: 1.6;">${this.formatTopCell(row.top_5)}</td>
            `;
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);

        tableWrapper.appendChild(table);
        section.appendChild(tableWrapper);
        container.appendChild(section);
    }

    /**
     * Process and analyze creator data directly from database (no CSV conversion)
     */
    async processAndAnalyzeDirect(creatorData) {
        try {
            console.log('=== Processing Creator Data Directly ===');
            console.log(`Raw data from database: ${creatorData.length} rows`);

            // Clean and transform data
            this.updateProgress(60, 'Cleaning data...');
            const cleanData = this.cleanCreatorDataDirect(creatorData);
            console.log(`Cleaned data: ${cleanData.length} rows`);

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
                month: 'numeric',
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

            // Display results with timestamp
            await this.displayResults(results, timestamp);

            this.updateProgress(100, 'Complete!');

            // Hide progress bar after completion
            setTimeout(() => {
                const progressSection = document.getElementById('creatorProgressSection');
                if (progressSection) {
                    progressSection.style.display = 'none';
                }
            }, 2000);
        } catch (error) {
            console.error('Error in processAndAnalyzeDirect:', error);
            throw error;
        }
    }

    /**
     * Clean creator data directly from database objects (no CSV parsing needed)
     */
    cleanCreatorDataDirect(data) {
        console.log(`=== Cleaning Creator Data (Direct) ===`);
        console.log(`Input rows: ${data.length}`);

        const cleanedRows = data.map(row => {
            // Parse raw_data JSONB
            const rawData = row.raw_data || {};

            const cleanRow = {
                // Identifiers
                email: row.email || '',
                creatorUsername: row.creator_username || '',

                // Type from top-level column in view
                type: row.type || 'Regular',

                // Dependent variable: total_copies from top-level column
                totalCopies: this.cleanNumeric(row.total_copies),

                // Additional outcome variable
                totalSubscriptions: this.cleanNumeric(row.total_subscriptions)
            };

            // Add ALL numeric fields from raw_data JSONB as independent variables
            // This includes all 12 Mixpanel metrics plus any uploaded CSV fields
            Object.keys(rawData).forEach(key => {
                // Skip fields we've already handled
                if (key === 'type' || key === 'email') return;

                const value = rawData[key];

                // Try to parse as numeric
                const numericValue = this.cleanNumeric(value);

                // Include numeric fields (even if 0/null for correlation analysis)
                if (typeof value === 'number' || !isNaN(parseFloat(value)) || value === null || value === undefined || value === '') {
                    cleanRow[key] = numericValue;
                }
                // Include string fields
                else if (typeof value === 'string') {
                    cleanRow[key] = value;
                }
            });

            console.log('Sample cleaned row keys:', Object.keys(cleanRow).slice(0, 20));

            return cleanRow;
        });

        const filteredRows = cleanedRows.filter(row => row.email || row.creatorUsername);
        console.log(`After filtering (must have email or username): ${filteredRows.length}`);

        // Log sample of first row to verify all metrics are present
        if (filteredRows.length > 0) {
            console.log('First row sample keys:', Object.keys(filteredRows[0]));
            console.log('First row sample values:', {
                totalCopies: filteredRows[0].totalCopies,
                total_deposits: filteredRows[0].total_deposits,
                total_rebalances: filteredRows[0].total_rebalances,
                total_sessions: filteredRows[0].total_sessions,
                total_leaderboard_views: filteredRows[0].total_leaderboard_views
            });
        }

        return filteredRows;
    }

    /**
     * Override: Process and analyze data (skip parent's progress hiding)
     * LEGACY: Still used if CSV path is taken
     */
    async processAndAnalyze(csvContent) {
        try {
            // Parse CSV
            this.updateProgress(50, 'Parsing data...');
            console.log('Parsing CSV content, length:', csvContent?.length);
            const parsedData = this.parseCSV(csvContent);
            console.log('Parsed data rows:', parsedData?.data?.length);
            console.log('CSV headers:', parsedData?.headers);
            console.log('First 2 rows:', parsedData?.data?.slice(0, 2));

            // Clean and transform data
            this.updateProgress(60, 'Cleaning data...');
            const cleanData = this.cleanCreatorData(parsedData);
            console.log('Cleaned data rows:', cleanData?.length);

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
                month: 'numeric',
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

            // Display results with timestamp
            await this.displayResults(results, timestamp);

            this.updateProgress(100, 'Complete!');

            // Hide progress bar after completion (with safety check)
            setTimeout(() => {
                const progressSection = document.getElementById('creatorProgressSection');
                if (progressSection) {
                    progressSection.style.display = 'none';
                }
            }, 2000);
        } catch (error) {
            console.error('Error in processAndAnalyze:', error);
            throw error;
        }
    }

    /**
     * Override: runWorkflow to handle progress bar properly for upload mode
     */
    async runWorkflow(mode) {
        if (mode === 'upload') {
            // For upload mode, don't show progress bar or clear status yet
            this.showUploadSection();
        } else {
            // For sync mode, use default behavior
            await super.runWorkflow(mode);
        }
    }

    /**
     * Override: Show the upload section with 3 file inputs
     */
    showUploadSection() {
        // Hide progress bar (shouldn't be visible yet)
        const progressSection = document.getElementById('creatorProgressSection');
        if (progressSection) {
            progressSection.style.display = 'none';
        }

        // Show the creator content container (which was hidden in createUI)
        const creatorContent = document.getElementById('creatorContent');
        if (creatorContent) {
            creatorContent.style.display = 'block';
        }

        // Show the entire mode section first
        const modeSection = document.getElementById('creatorModeSection');
        if (modeSection) {
            modeSection.style.display = 'block';
        }

        // Upload section should already be visible as child of mode section
        const uploadSection = document.getElementById('creatorUploadSection');
        if (uploadSection) {
            console.log('✅ Upload section displayed');
        } else {
            console.error('❌ Upload section not found! Element ID: creatorUploadSection');
        }

        // Re-initialize Process Files button handler (in case it wasn't available during initial load)
        if (typeof window.initializeProcessFilesButton === 'function') {
            window.initializeProcessFilesButton(this);
        }
    }

    /**
     * Override: Run the upload workflow using Supabase with 3 files
     */
    async runUploadWorkflow() {
        if (!this.supabaseIntegration) {
            throw new Error('Supabase not configured. Please check your configuration.');
        }

        try {
            // Hide the upload form (mode section and creator content container)
            const modeSection = document.getElementById('creatorModeSection');
            if (modeSection) {
                modeSection.style.display = 'none';
            }

            const creatorContent = document.getElementById('creatorContent');
            if (creatorContent) {
                creatorContent.style.display = 'none';
            }

            // Keep data source visible, show progress bar
            this.clearStatus();
            this.showProgress(0);

            // Get the 3 file inputs
            const creatorListInput = document.getElementById('creatorListFileInput');
            const dealsInput = document.getElementById('dealsFileInput');
            const publicCreatorsInput = document.getElementById('publicCreatorsFileInput');

            if (!creatorListInput.files[0] || !dealsInput.files[0] || !publicCreatorsInput.files[0]) {
                throw new Error('Please select all 3 CSV files before processing');
            }

            this.updateProgress(20, 'Reading files...');

            // Read all 3 files
            const creatorListCsv = await this.readFileAsText(creatorListInput.files[0]);
            const dealsCsv = await this.readFileAsText(dealsInput.files[0]);
            const publicCreatorsCsv = await this.readFileAsText(publicCreatorsInput.files[0]);

            this.updateProgress(40, 'Merging and processing files...');

            // Upload and merge through Supabase Edge Function
            const result = await this.supabaseIntegration.uploadAndMergeCreatorFiles(
                creatorListCsv,
                dealsCsv,
                publicCreatorsCsv
            );

            if (!result || !result.success) {
                throw new Error(result?.error || 'Failed to upload and merge creator files');
            }

            console.log('✅ Creator files merged:', result.stats);
            this.updateProgress(50, 'Upload complete! Starting sync...');

            // Proceed immediately to sync (no delay)
            await this.runSyncAndAnalyzeWorkflow();
        } catch (error) {
            console.error('Upload workflow error:', error);
            // Keep progress bar visible to show error
            const progressBar = document.getElementById('creatorProgressBar');
            if (progressBar) {
                const textDiv = progressBar.querySelector('div');
                if (textDiv) {
                    textDiv.textContent = `❌ Error: ${error.message}`;
                }
                progressBar.style.background = '#dc3545'; // Red for error
            }

            // Also show error in status section
            this.addStatusMessage(`❌ Error during upload: ${error.message}`, 'error');

            throw error;
        }
    }

    /**
     * Parse and clean creator CSV data
     * Renames columns, cleans headers, stores all data in raw_data JSONB
     */
    parseAndCleanCreatorCSV(csvContent) {
        // Use the shared CSV parser which handles quoted fields properly
        const parsedCSV = window.CSVUtils.parseCSV(csvContent);

        if (!parsedCSV || !parsedCSV.data || parsedCSV.data.length === 0) {
            throw new Error('CSV file is empty or invalid');
        }

        const rawHeaders = parsedCSV.headers;
        const cleanedHeaders = rawHeaders.map(header =>
            header
                .trim()
                .toLowerCase()
                .replace(/^report\d+:\s*/i, '') // Remove "report#:" prefix
                .replace(/[^a-z0-9_]/g, '_') // Replace non-alphanumeric with underscore
                .replace(/_+/g, '_') // Replace multiple underscores with single
                .replace(/^_|_$/g, '') // Remove leading/trailing underscores
        );

        console.log('Original headers:', rawHeaders);
        console.log('Cleaned headers:', cleanedHeaders);

        // Columns to drop
        const columnsTosDrop = ['email', 'phone', 'createdby', 'cancelledat', 'sketchinvestigationresultid'];

        // Find important column indices
        const handleIndex = cleanedHeaders.findIndex(h => h === 'handle');
        const useruuidIndex = cleanedHeaders.findIndex(h => h === 'useruuid');
        const descriptionIndex = cleanedHeaders.findIndex(h => h === 'description');
        const birthdateIndex = cleanedHeaders.findIndex(h => h === 'birthdate');

        if (handleIndex === -1) {
            throw new Error('CSV must contain "handle" column');
        }
        if (useruuidIndex === -1) {
            throw new Error('CSV must contain "useruuid" column');
        }

        // Process each data row
        const cleanedData = [];
        parsedCSV.data.forEach((row, index) => {
            // Build raw_data object with all CSV columns (except dropped ones)
            const rawData = {};
            cleanedHeaders.forEach((header, colIndex) => {
                const originalHeader = rawHeaders[colIndex];
                // Skip columns that should be dropped
                if (!columnsTosDrop.includes(header)) {
                    const value = row[originalHeader];
                    rawData[header] = value ? String(value).trim() : null;
                }
            });

            // Calculate description_length
            if (descriptionIndex !== -1) {
                const description = row[rawHeaders[descriptionIndex]] || '';
                rawData.description_length = String(description).length;
            }

            // Calculate age from birthdate
            if (birthdateIndex !== -1) {
                const birthdate = row[rawHeaders[birthdateIndex]];
                if (birthdate) {
                    try {
                        const birthDate = new Date(birthdate);
                        const today = new Date();
                        let age = today.getFullYear() - birthDate.getFullYear();
                        const monthDiff = today.getMonth() - birthDate.getMonth();
                        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
                            age--;
                        }
                        rawData.age = age;
                    } catch (error) {
                        console.warn(`Invalid birthdate format on row ${index + 2}: ${birthdate}`);
                        rawData.age = null;
                    }
                } else {
                    rawData.age = null;
                }
            }

            // Extract creator_username and creator_id
            let creatorUsername = row[rawHeaders[handleIndex]]?.trim();
            const creatorId = row[rawHeaders[useruuidIndex]]?.trim();

            if (!creatorUsername || !creatorId) {
                console.warn(`Skipping row ${index + 2}: missing handle or useruuid`);
                return;
            }

            // Normalize username: ensure it starts with @ to match creators_insights format
            if (!creatorUsername.startsWith('@')) {
                creatorUsername = '@' + creatorUsername;
            }

            cleanedData.push({
                creator_id: creatorId,
                creator_username: creatorUsername,
                raw_data: rawData
            });
        });

        // Deduplicate by creator_username (keep last occurrence)
        const deduped = {};
        const duplicates = {};
        cleanedData.forEach(row => {
            if (deduped[row.creator_username]) {
                duplicates[row.creator_username] = (duplicates[row.creator_username] || 0) + 1;
            }
            deduped[row.creator_username] = row;
        });
        const dedupedArray = Object.values(deduped);

        console.log(`Original rows: ${cleanedData.length}, After deduplication: ${dedupedArray.length}`);
        if (Object.keys(duplicates).length > 0) {
            console.log(`Found ${Object.keys(duplicates).length} usernames with duplicates:`, Object.keys(duplicates).slice(0, 10));
        }

        return dedupedArray;
    }

    /**
     * Parse a CSV line handling quoted fields
     */
    parseCSVLine(line) {
        const values = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];

            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                values.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        values.push(current); // Add the last value

        return values.map(v => v.replace(/^"|"$/g, '')); // Remove quotes
    }

    /**
     * New workflow: Sync Mixpanel data + Run analysis + Display results
     * This is called after manual upload to complete the enrichment and analysis
     */
    async runSyncAndAnalyzeWorkflow() {
        if (!this.supabaseIntegration) {
            throw new Error('Supabase not configured. Please check your configuration.');
        }

        // Keep container hidden, progress bar should already be showing
        if (this.container) {
            this.container.style.display = 'none';
        }

        try {
            // Step 1: Sync Mixpanel data (continue from 50% if coming from upload)
            this.updateProgress(60, 'Syncing Mixpanel data...');

            console.log('Triggering Supabase creator enrichment sync...');
            const syncResult = await this.supabaseIntegration.triggerCreatorSync();

            if (!syncResult || !syncResult.creatorData || !syncResult.creatorData.success) {
                throw new Error('Failed to sync creator data');
            }

            console.log('✅ Creator enrichment sync completed:', syncResult.creatorData.stats);
            this.updateProgress(75, 'Loading enriched data...');

            // Step 2: Load merged data from creator_analysis view (as objects, not CSV)
            const creatorData = await this.supabaseIntegration.loadCreatorDataFromSupabase();

            if (!creatorData || creatorData.length === 0) {
                throw new Error('No data returned from database');
            }

            console.log(`✅ Loaded ${creatorData.length} creators from creator_analysis view`);
            this.updateProgress(85, 'Analyzing data...');

            // Step 3: Process and analyze (directly, no CSV conversion)
            await this.processAndAnalyzeDirect(creatorData);

            this.updateProgress(100, 'Complete!');

            // Hide progress bar after completion
            setTimeout(() => {
                const progressSection = document.getElementById('creatorProgressSection');
                if (progressSection) {
                    progressSection.style.display = 'none';
                }
            }, 2000);
        } catch (error) {
            console.error('Sync and analyze workflow error:', error);

            // Keep progress bar visible to show error
            const progressBar = document.getElementById('creatorProgressBar');
            if (progressBar) {
                const textDiv = progressBar.querySelector('div');
                if (textDiv) {
                    textDiv.textContent = `❌ Error: ${error.message}`;
                }
                progressBar.style.background = '#dc3545'; // Red for error
            }

            this.addStatusMessage(`❌ Error: ${error.message}`, 'error');
            throw error;
        }
    }

    /**
     * Override: Run the sync workflow using Supabase
     * Syncs both user engagement data (for affinity) and creator insights data
     */
    async runSyncWorkflow() {
        if (!this.supabaseIntegration) {
            throw new Error('Supabase not configured. Please check your configuration.');
        }

        this.clearStatus();
        this.showProgress(0);

        // Track start time to ensure minimum progress bar display time
        const workflowStartTime = Date.now();

        try {
            // Note: User tool sync has already completed (runs sequentially before this)
            // This workflow just needs to reload and redisplay the Premium Creator Copy Affinity
            this.updateProgress(50, 'Loading Premium Creator Copy Affinity...');

            // Invalidate affinity cache to ensure fresh display
            console.log('Invalidating affinity cache...');
            this.supabaseIntegration.invalidateCache('premium_creator_affinity_display');

            // Clear the output container completely
            this.outputContainer.innerHTML = '';

            // Re-render the entire creator analysis display
            console.log('Re-rendering creator analysis with fresh data...');
            await this.displayResults({ summaryStats: {} }); // Pass minimal stats since we only show H1

            // Update timestamp and data scope with current time (matching user tool pattern)
            this.updateTimestampAndDataScope();

            // Save updated HTML to unified cache
            this.saveToUnifiedCache();

            this.updateProgress(100, 'Complete!');
            this.addStatusMessage('✅ Premium Creator Copy Affinity refreshed', 'success');
            console.log('✅ Premium Creator Copy Affinity table refreshed with latest data');

            // Ensure progress bar is visible for at least 1.5 seconds
            const elapsedTime = Date.now() - workflowStartTime;
            const minDisplayTime = 1500; // 1.5 seconds
            const remainingTime = Math.max(0, minDisplayTime - elapsedTime);

            // Hide progress bar after minimum display time + 1 second
            setTimeout(() => {
                const progressSection = document.getElementById('creatorProgressSection');
                if (progressSection) {
                    progressSection.style.display = 'none';
                }
            }, remainingTime + 1000);
        } catch (error) {
            console.error('Sync workflow error:', error);
            this.addStatusMessage(`❌ Sync failed: ${error.message}`, 'error');
            throw error;
        }
    }

}

// Export to window
window.CreatorAnalysisToolSupabase = CreatorAnalysisToolSupabase;

console.log('✅ Creator Analysis Tool (Supabase) loaded successfully!');
