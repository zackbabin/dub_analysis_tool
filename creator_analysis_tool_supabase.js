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
     * Override: Use unified progress bar instead of creator-specific one
     */
    showProgress(percent) {
        const progressSection = document.getElementById('unifiedProgressSection');
        if (progressSection) {
            progressSection.style.display = 'block';
        }
        this.updateProgress(percent);
    }

    /**
     * Override: Use unified progress bar for updates
     */
    updateProgress(percent, message = null) {
        const progressBar = document.getElementById('unifiedProgressBar');
        if (progressBar) {
            progressBar.style.width = `${percent}%`;
            const label = progressBar.querySelector('div');
            if (label) {
                label.textContent = message || `${percent}%`;
            }
        }
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

        // Note: Cache restoration and stale flag handling is now managed centrally in index.html
        // This ensures all tabs (including creator tab) restore consistently and refresh together when needed
        // Cache restoration is called explicitly from index.html after tool initialization

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

        const portfolioAssetsContainer = document.createElement('div');
        portfolioAssetsContainer.id = 'portfolioAssetsBreakdownInline';
        resultsDiv.appendChild(portfolioAssetsContainer);

        const portfolioBreakdownContainer = document.createElement('div');
        portfolioBreakdownContainer.id = 'premiumPortfolioBreakdownInline';
        resultsDiv.appendChild(portfolioBreakdownContainer);

        const retentionContainer = document.createElement('div');
        retentionContainer.id = 'premiumCreatorRetentionInline';
        resultsDiv.appendChild(retentionContainer);

        const affinityContainer = document.createElement('div');
        affinityContainer.id = 'premiumCreatorAffinityInline';
        resultsDiv.appendChild(affinityContainer);

        // Display results - SKIP behavioral analysis
        this.displayCreatorSummaryStats(results.summaryStats, results.engagementSummary, results.subscriptionDistribution);

        // Load and display premium creator breakdown
        await this.loadAndDisplayPremiumCreatorBreakdown();

        // Load and display portfolio assets breakdown (top stocks)
        await this.loadAndDisplayPortfolioAssetsBreakdown();

        // Load and display premium portfolio breakdown
        await this.loadAndDisplayPremiumPortfolioBreakdown();

        // Load and display premium creator retention
        await this.loadAndDisplayPremiumCreatorRetention();

        // Load and display premium creator copy affinity
        await this.loadAndDisplayPremiumCreatorAffinity();

        // Add data scope text (top left) and timestamp (top right)
        // Get the actual Mixpanel data refresh time from sync_logs (same as user analysis tabs)
        const mixpanelSyncTime = await this.supabaseIntegration.getMostRecentMixpanelSyncTime();
        const displayTime = mixpanelSyncTime || new Date(); // Fallback to current time if no sync found

        const formattedTimestamp = displayTime.toLocaleString('en-US', {
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
        timestamp.textContent = `Data as of: ${formattedTimestamp}`;
        resultsDiv.insertBefore(timestamp, resultsDiv.firstChild);

        // Add data scope text second (will be inserted at position 0, pushing timestamp to position 1)
        const dataScope = document.createElement('div');
        dataScope.className = 'qda-data-scope';
        dataScope.textContent = 'Data from users in the last 6 months and portfolios created after 9/30/2024';
        resultsDiv.insertBefore(dataScope, resultsDiv.firstChild);

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

                    // Reattach event listeners after cache restoration
                    this.reattachEventListeners();
                }
            }
        } catch (e) {
            console.warn('Failed to restore creator analysis from unified cache:', e);
        }
    }

    /**
     * Reattach event listeners after cache restoration
     */
    reattachEventListeners() {
        // Reattach portfolio filter button click handler
        const filterButton = document.getElementById('portfolioFilterButton');
        if (filterButton) {
            // Get unique creators from the table
            const table = document.querySelector('#premiumPortfolioBreakdownInline table');
            if (table) {
                const rows = table.querySelectorAll('tbody tr');
                const creators = [...new Set(Array.from(rows).map(row => {
                    const cells = row.querySelectorAll('td');
                    return cells[0]?.textContent.trim();
                }).filter(Boolean))];

                // Initialize selected creators if not already set
                if (!this.selectedPortfolioCreators || this.selectedPortfolioCreators.size === 0) {
                    this.selectedPortfolioCreators = new Set(creators);
                }

                filterButton.addEventListener('click', () => {
                    this.showPortfolioFilterModal(creators);
                });
            }
        }

        // Reattach Clear All button click handler
        const clearAllButtons = document.querySelectorAll('button');
        clearAllButtons.forEach(btn => {
            if (btn.textContent === 'Clear All' && btn.parentElement?.id !== 'portfolioFilterButton') {
                const filterButton = document.getElementById('portfolioFilterButton');
                if (filterButton) {
                    const table = document.querySelector('#premiumPortfolioBreakdownInline table');
                    if (table) {
                        const rows = table.querySelectorAll('tbody tr');
                        const creators = [...new Set(Array.from(rows).map(row => {
                            const cells = row.querySelectorAll('td');
                            return cells[0]?.textContent.trim();
                        }).filter(Boolean))];

                        btn.addEventListener('click', () => {
                            this.selectedPortfolioCreators = new Set(creators);
                            // Would need to reload data here, but for cached view we just update the UI
                            const badge = document.getElementById('filterCountBadge');
                            if (badge) {
                                badge.textContent = `${this.selectedPortfolioCreators.size} selected`;
                            }
                            this.updatePortfolioFilterChips();
                        });
                    }
                }
            }
        });

        // Reattach chip remove buttons
        const chips = document.querySelectorAll('#portfolioFilterChips > div');
        chips.forEach(chip => {
            const removeBtn = chip.querySelector('button');
            if (removeBtn && removeBtn.innerHTML === '×') {
                const creator = chip.querySelector('span')?.textContent;
                if (creator) {
                    removeBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.selectedPortfolioCreators.delete(creator);
                        this.updatePortfolioFilterChips();
                        const badge = document.getElementById('filterCountBadge');
                        if (badge) {
                            badge.textContent = `${this.selectedPortfolioCreators.size} selected`;
                        }
                    });
                }
            }
        });

        // Reattach retention table event listeners
        this.reattachRetentionEventListeners();
    }

    /**
     * Override: Display creator summary statistics - Show 4 averaged metric cards
     */
    async displayCreatorSummaryStats(stats, engagementSummary, subscriptionDistribution) {
        const container = document.getElementById('creatorSummaryStatsInline');
        if (!container) {
            console.error('❌ Container creatorSummaryStatsInline not found!');
            return;
        }
        container.innerHTML = '';

        const section = document.createElement('div');
        section.className = 'qda-result-section';

        // Add H1 title with tooltip - updated to include subscription analysis
        const creatorH1Tooltip = `<span class="info-tooltip" style="vertical-align: middle; margin-left: 8px;">
            <span class="info-icon">i</span>
            <span class="tooltip-text">
                <strong>Premium Creator Analysis</strong>
                Comprehensive analysis of premium creator engagement and subscription patterns.
                <ul>
                    <li><strong>Data Sources:</strong>
                        <a href="https://mixpanel.com/project/2599235/view/3138115/app/boards#id=10576025&editor-card-id=%22report-85725073%22" target="_blank" style="color: #17a2b8;">Chart 85725073</a> (Premium Creators),
                        <a href="https://mixpanel.com/project/2599235/view/3138115/app/boards#id=10576025&editor-card-id=%22report-85821646%22" target="_blank" style="color: #17a2b8;">Chart 85821646</a> (Subscription Metrics),
                        <a href="https://mixpanel.com/project/2599235/view/3138115/app/boards#id=10576025&editor-card-id=%22report-85154450%22" target="_blank" style="color: #17a2b8;">Chart 85154450</a> (Subscription Pricing),
                        <a href="https://mixpanel.com/project/2599235/view/3138115/app/boards#id=10576025&editor-card-id=%22report-85165590%22" target="_blank" style="color: #17a2b8;">Chart 85165590</a> (Subscriptions),
                        Manual CSV Upload (Portfolio Returns & Capital)
                    </li>
                    <li><strong>Metrics:</strong> Subscription patterns, engagement metrics, price distribution</li>
                </ul>
            </span>
        </span>`;

        section.innerHTML = `<h1 style="margin-bottom: 0.25rem; display: inline;">Premium Creator Analysis</h1>${creatorH1Tooltip}`;
        container.appendChild(section);

        if (engagementSummary && engagementSummary.length === 2) {
            const subscribersData = engagementSummary.find(d => d.did_subscribe === 1 || d.did_subscribe === true) || {};
            const nonSubscribersData = engagementSummary.find(d => d.did_subscribe === 0 || d.did_subscribe === false) || {};

            const metricSummary = document.createElement('div');
            metricSummary.className = 'qda-metric-summary';
            metricSummary.style.gridTemplateColumns = 'repeat(4, 1fr)';
            metricSummary.style.marginTop = '1.5rem';
            metricSummary.style.marginBottom = '0.5rem';

            const metrics = [
                { label: 'Avg Profile Views', primaryValue: subscribersData.avg_profile_views || 0, secondaryValue: nonSubscribersData.avg_profile_views || 0 },
                { label: 'Avg PDP Views', primaryValue: subscribersData.avg_pdp_views || 0, secondaryValue: nonSubscribersData.avg_pdp_views || 0 },
                { label: 'Unique Creators', primaryValue: subscribersData.avg_unique_creators || 0, secondaryValue: nonSubscribersData.avg_unique_creators || 0 },
                { label: 'Unique Portfolios', primaryValue: subscribersData.avg_unique_portfolios || 0, secondaryValue: nonSubscribersData.avg_unique_portfolios || 0 }
            ];

            metrics.forEach(metric => {
                const card = document.createElement('div');
                card.className = 'qda-metric-card';
                card.innerHTML = `
                    <div style="font-size: 0.875rem; color: #2563eb; font-weight: 600; margin-bottom: 0.5rem;">${metric.label}</div>
                    <div style="font-size: 1.5rem; font-weight: bold;">
                        ${parseFloat(metric.primaryValue).toFixed(1)}
                        <span style="font-size: 0.9rem; color: #6c757d; font-weight: normal;">vs ${parseFloat(metric.secondaryValue).toFixed(1)}</span>
                    </div>
                `;
                metricSummary.appendChild(card);
            });

            section.appendChild(metricSummary);

            // Add comparison note
            const note = document.createElement('p');
            note.style.cssText = 'font-size: 0.75rem; color: #6c757d; margin-top: 0.5rem; margin-bottom: 2rem; font-style: italic;';
            note.textContent = "Compares users who subscribed vs. haven't subscribed";
            section.appendChild(note);
        }

        // Display subscription price distribution (data passed as parameter)
        if (subscriptionDistribution && subscriptionDistribution.length > 0) {
            const chartId = `subscription-price-chart-${Date.now()}`;

            const priceTooltipHTML = `<span class="info-tooltip" style="vertical-align: middle; margin-left: 8px;">
                <span class="info-icon">i</span>
                <span class="tooltip-text">
                    <strong>Subscription Price Distribution</strong>
                    Distribution of subscription prices across all creator subscriptions.
                    <ul>
                        <li><strong>Data Source:</strong> <a href="https://mixpanel.com/project/2599235/view/3138115/app/boards#id=10576025&editor-card-id=%22report-85154450%22" target="_blank" style="color: #17a2b8;">Chart 85154450</a> (Subscription Pricing)</li>
                        <li><strong>Metrics:</strong> Price tiers, subscription counts, revenue distribution</li>
                    </ul>
                </span>
            </span>`;

            const chartSection = document.createElement('div');
            chartSection.style.marginTop = '3rem';
            chartSection.innerHTML = `
                <h2 style="margin-top: 0; margin-bottom: 0.25rem; display: inline;">Subscription Price Distribution</h2>${priceTooltipHTML}
                <div id="${chartId}" style="width: 100%; height: 400px; margin-top: 1rem;"></div>
            `;
            section.appendChild(chartSection);

            // Render chart after DOM is ready
            setTimeout(() => {
                this.renderSubscriptionPriceChart(chartId, subscriptionDistribution);
            }, 100);
        }

        // Display Top Subscription Drivers section (loaded from database)
        await this.displayTopSubscriptionDrivers(section);
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

            // Query premium_creator_summary_stats view - all aggregation done in database
            const { data, error } = await this.supabaseIntegration.supabase
                .from('premium_creator_summary_stats')
                .select('*')
                .single();

            if (error) {
                console.error('Error fetching premium creator metrics:', error);
                return null;
            }

            if (!data) {
                console.log('No premium creator metrics found');
                return {
                    avg_subscription_cvr: 0,
                    median_all_time_performance: null,
                    median_copy_capital: null
                };
            }

            // Return the pre-calculated metrics from the view
            return {
                avg_subscription_cvr: data.avg_subscription_cvr || 0,
                median_all_time_performance: data.median_all_time_performance || null,
                median_copy_capital: data.median_copy_capital || null,
                total_creators: data.total_creators || 0
            };

        } catch (error) {
            console.error('Error in fetchPremiumCreatorMetrics:', error);
            return null;
        }
    }

    /**
     * Update timestamp and data scope after sync
     */
    async updateTimestampAndDataScope() {
        const resultsDiv = document.getElementById('creatorAnalysisResultsInline');
        if (!resultsDiv) return;

        // Remove existing timestamp and data scope
        const existingTimestamp = resultsDiv.querySelector('.qda-timestamp');
        const existingDataScope = resultsDiv.querySelector('.qda-data-scope');
        if (existingTimestamp) existingTimestamp.remove();
        if (existingDataScope) existingDataScope.remove();

        // Get the actual Mixpanel data refresh time from sync_logs
        const mixpanelSyncTime = await this.supabaseIntegration.getMostRecentMixpanelSyncTime();
        const displayTime = mixpanelSyncTime || new Date(); // Fallback to current time if no sync found

        const formattedTimestamp = displayTime.toLocaleString('en-US', {
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
        timestamp.textContent = `Data as of: ${formattedTimestamp}`;
        resultsDiv.insertBefore(timestamp, resultsDiv.firstChild);

        // Add data scope text second (will be inserted at position 0, pushing timestamp to position 1)
        const dataScope = document.createElement('div');
        dataScope.className = 'qda-data-scope';
        dataScope.textContent = 'Data from users in the last 6 months and portfolios created after 9/30/2024';
        resultsDiv.insertBefore(dataScope, resultsDiv.firstChild);
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

            console.log('Loading premium creator breakdown from materialized view...');

            // Query the materialized view - all aggregation done in database
            const { data: breakdownData, error } = await this.supabaseIntegration.supabase
                .from('premium_creator_breakdown')
                .select('*')
                .order('total_copies', { ascending: false });

            if (error) {
                console.error('Error loading premium creator breakdown:', error);
                return;
            }

            console.log(`✅ Loaded ${breakdownData.length} premium creators for breakdown`);
            this.displayPremiumCreatorBreakdown(breakdownData);
        } catch (error) {
            console.error('Error in loadAndDisplayPremiumCreatorBreakdown:', error);
        }
    }

    /**
     * Display premium creator breakdown table
     */
    async displayPremiumCreatorBreakdown(breakdownData) {
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

        // Add tooltip
        const tooltipHTML = `<span class="info-tooltip" style="vertical-align: middle; margin-left: 8px;">
            <span class="info-icon">i</span>
            <span class="tooltip-text">
                <strong>Premium Creator Breakdown</strong>
                Conversion metrics for each premium creator, aggregated across all their portfolios.
                <ul>
                    <li><strong>Data Sources:</strong>
                        <a href="https://mixpanel.com/project/2599235/view/3138115/app/boards#id=10576025&editor-card-id=%22report-85725073%22" target="_blank" style="color: #17a2b8;">Chart 85725073</a> (Premium Creators),
                        <a href="https://mixpanel.com/project/2599235/view/3138115/app/boards#id=10576025&editor-card-id=%22report-86055000%22" target="_blank" style="color: #17a2b8;">Chart 86055000</a> (Copies & Liquidations Aggregates),
                        <a href="https://mixpanel.com/project/2599235/view/3138115/app/boards#id=10576025&editor-card-id=%22report-85165580%22" target="_blank" style="color: #17a2b8;">Chart 85165580</a> (User-Level Engagement),
                        <a href="https://mixpanel.com/project/2599235/view/3138115/app/boards#id=10576025&editor-card-id=%22report-85821646%22" target="_blank" style="color: #17a2b8;">Chart 85821646</a> (Subscription Metrics),
                        Manual CSV Upload (Portfolio Returns & Capital)
                    </li>
                    <li><strong>Metrics:</strong> Copies, Liquidations, Liquidation Rate, Subscriptions, Subscription CVR, Cancellation Rate, All-Time Returns, Copy Capital</li>
                </ul>
            </span>
        </span>`;

        const title = document.createElement('h2');
        title.style.cssText = 'margin-top: 0; margin-bottom: 0.5rem; display: inline;';
        title.innerHTML = `Premium Creator Breakdown${tooltipHTML}`;
        section.appendChild(title);

        const description = document.createElement('p');
        description.style.cssText = 'font-size: 0.875rem; color: #6c757d; margin-top: 0.5rem; margin-bottom: 1.5rem;';
        description.textContent = 'Conversion metrics breakdown for each premium creator';
        section.appendChild(description);

        // Fetch premium creator metrics for the 3 metric cards
        const metrics = await this.fetchPremiumCreatorMetrics();

        if (metrics) {
            const metricSummary = document.createElement('div');
            metricSummary.className = 'qda-metric-summary';
            // Override grid to use 3 columns
            metricSummary.style.gridTemplateColumns = 'repeat(3, 1fr)';
            metricSummary.style.marginTop = '1.5rem';
            metricSummary.style.marginBottom = '1.5rem';

            // Create 3 metric cards
            const medianPerformanceDisplay = metrics.median_all_time_performance !== null && metrics.median_all_time_performance !== undefined
                ? `${metrics.median_all_time_performance >= 0 ? '+' : ''}${metrics.median_all_time_performance.toLocaleString(undefined, {maximumFractionDigits: 2})}%`
                : '—';
            const medianCopyCapitalDisplay = metrics.median_copy_capital !== null && metrics.median_copy_capital !== undefined
                ? `$${metrics.median_copy_capital.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`
                : '—';

            const cards = [
                ['Avg Subscription CVR', metrics.avg_subscription_cvr ? metrics.avg_subscription_cvr.toLocaleString(undefined, {maximumFractionDigits: 2}) + '%' : '0%', 'Viewed Paywall → Subscribed to Creator'],
                ['Median All-Time Returns', medianPerformanceDisplay, 'Median portfolio returns across all Premium Creators'],
                ['Median Copy Capital', medianCopyCapitalDisplay, 'Median capital deployed to copy portfolios across all Premium Creators']
            ];

            cards.forEach(([cardTitle, content, tooltip]) => {
                const card = document.createElement('div');
                card.className = 'qda-metric-card';
                card.innerHTML = `
                    <div style="font-size: 0.875rem; color: #2563eb; font-weight: 600; margin-bottom: 0.5rem; display: flex; align-items: center; gap: 4px;">
                        ${cardTitle}
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

        // Create table
        const tableWrapper = document.createElement('div');
        tableWrapper.className = 'table-wrapper';

        // Create scrollable container for table
        const tableContainer = document.createElement('div');
        tableContainer.style.overflowX = 'auto';
        tableContainer.style.marginBottom = '20px';

        const table = document.createElement('table');
        table.className = 'qda-regression-table';
        // Remove fixed minWidth - let it size naturally

        // Table header with fixed column widths and sticky first column
        const thead = document.createElement('thead');
        thead.innerHTML = `
            <tr>
                <th style="text-align: left; min-width: 180px; position: sticky; left: 0; background: white; z-index: 10; box-shadow: 2px 0 4px rgba(0,0,0,0.1);">Premium Creator</th>
                <th style="text-align: right; min-width: 100px;">Copies</th>
                <th style="text-align: right; min-width: 120px;">Liquidations</th>
                <th style="text-align: right; min-width: 140px;">Liquidation Rate</th>
                <th style="text-align: right; min-width: 130px;">Subscriptions</th>
                <th style="text-align: right; min-width: 150px;">Subscription CVR</th>
                <th style="text-align: right; min-width: 160px;">Cancellation Rate</th>
                <th style="text-align: right; min-width: 160px;">
                    All-Time Returns
                    <span class="info-tooltip" style="display: inline-flex; align-items: center; margin-left: 4px;">
                        <span class="info-icon">i</span>
                        <span class="tooltip-text">Average all-time returns across all portfolios created after 9/30/2024</span>
                    </span>
                </th>
                <th style="text-align: right; min-width: 130px;">Copy Capital</th>
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

            // Format all-time returns as percentage with color
            let returnsDisplay = '—';
            let returnsStyle = 'text-align: right;';
            if (row.avg_all_time_returns !== null && row.avg_all_time_returns !== undefined) {
                const returns = row.avg_all_time_returns * 100; // Convert from decimal to percentage
                const color = returns >= 0 ? '#28a745' : '#dc3545';
                returnsDisplay = `${returns >= 0 ? '+' : ''}${returns.toFixed(2)}%`;
                returnsStyle = `text-align: right; color: ${color}; font-weight: 600;`;
            }

            // Format copy capital with currency
            let capitalDisplay = '—';
            if (row.total_copy_capital !== null && row.total_copy_capital !== undefined) {
                capitalDisplay = `$${row.total_copy_capital.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            }

            tr.innerHTML = `
                <td style="font-weight: 600; position: sticky; left: 0; background: white; z-index: 5; box-shadow: 2px 0 4px rgba(0,0,0,0.05);">${row.creator_username || 'N/A'}</td>
                <td style="text-align: right;">${(row.total_copies || 0).toLocaleString()}</td>
                <td style="text-align: right;">${(row.total_liquidations || 0).toLocaleString()}</td>
                <td style="text-align: right;">${(row.liquidation_rate || 0).toFixed(2)}%</td>
                <td style="text-align: right;">${(row.total_subscriptions || 0).toLocaleString()}</td>
                <td style="text-align: right;">${(row.subscription_cvr || 0).toFixed(2)}%</td>
                <td style="text-align: right;">${(row.cancellation_rate || 0).toFixed(2)}%</td>
                <td style="${returnsStyle}">${returnsDisplay}</td>
                <td style="text-align: right;">${capitalDisplay}</td>
            `;
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);

        tableContainer.appendChild(table);
        tableWrapper.appendChild(tableContainer);
        section.appendChild(tableWrapper);
        container.appendChild(section);
    }

    /**
     * Load and display portfolio assets breakdown
     * Shows top 5 stocks across all premium creators (metric cards)
     * and top 5 stocks per creator (table)
     */
    async loadAndDisplayPortfolioAssetsBreakdown() {
        try {
            if (!this.supabaseIntegration) {
                console.error('Supabase not configured');
                return;
            }

            console.log('Loading portfolio assets breakdown...');

            // Load overall top 5 stocks
            const { data: topStocksData, error: topError } = await this.supabaseIntegration.supabase
                .from('top_stocks_all_premium_creators')
                .select('*')
                .order('rank', { ascending: true })
                .limit(5);

            if (topError) {
                console.error('Error loading top stocks:', topError);
            }

            // Load per-creator top 5 stocks, sorted by total copies
            const { data: creatorStocksData, error: creatorError } = await this.supabaseIntegration.supabase
                .from('premium_creator_top_5_stocks')
                .select('*')
                .order('total_copies', { ascending: false });

            if (creatorError) {
                console.error('Error loading creator stocks:', creatorError);
            }

            console.log(`✅ Loaded ${topStocksData?.length || 0} top stocks and ${creatorStocksData?.length || 0} creator breakdowns`);

            // Display both in the Portfolio Assets Breakdown section
            this.displayPortfolioAssetsBreakdown(topStocksData, creatorStocksData);
        } catch (error) {
            console.error('Error in loadAndDisplayPortfolioAssetsBreakdown:', error);
        }
    }

    /**
     * Display portfolio assets breakdown
     * Shows metric cards for overall top 5 stocks and table for per-creator breakdown
     */
    displayPortfolioAssetsBreakdown(topStocks, creatorStocks) {
        const container = document.getElementById('portfolioAssetsBreakdownInline');
        if (!container) {
            console.warn('⚠️ Container portfolioAssetsBreakdownInline not found, skipping display');
            return;
        }

        container.innerHTML = '';

        if ((!topStocks || topStocks.length === 0) && (!creatorStocks || creatorStocks.length === 0)) {
            return;
        }

        const section = document.createElement('div');
        section.className = 'qda-result-section';
        section.style.marginTop = '3rem';

        // Section title with global tooltip component
        const titleContainer = document.createElement('h2');
        titleContainer.style.cssText = 'margin-top: 0; margin-bottom: 0.5rem;';

        const portfolioTooltip = `<span class="info-tooltip" style="vertical-align: middle; margin-left: 8px;">
            <span class="info-icon">i</span>
            <span class="tooltip-text">
                <strong>Portfolio Assets Breakdown</strong>
                <ul>
                    <li><strong>Data Source:</strong> portfolio_breakdown_with_metrics view</li>
                    <li><strong>Top Stocks:</strong> Aggregated by total shares across all premium creator portfolios</li>
                    <li><strong>Per-Creator:</strong> Top 5 stocks for each premium creator sorted by total copies</li>
                </ul>
                Shows stock holdings from uploaded portfolio CSV files.
            </span>
        </span>`;

        titleContainer.innerHTML = `Portfolio Assets Breakdown${portfolioTooltip}`;
        section.appendChild(titleContainer);

        const description = document.createElement('p');
        description.style.cssText = 'font-size: 0.875rem; color: #6c757d; margin-top: 0.5rem; margin-bottom: 1.5rem;';
        description.textContent = 'Top stocks traded by premium creators across their portfolios';
        section.appendChild(description);

        // Metric cards for overall top 5 stocks
        if (topStocks && topStocks.length > 0) {
            const metricsTitle = document.createElement('h3');
            metricsTitle.style.cssText = 'margin: 0 0 1rem 0; font-size: 1rem; color: #333;';
            metricsTitle.textContent = 'Top 5 Stocks by Total Shares';
            section.appendChild(metricsTitle);

            const metricSummary = document.createElement('div');
            metricSummary.className = 'qda-metric-summary';

            topStocks.forEach(stock => {
                const card = document.createElement('div');
                card.className = 'qda-metric-card';
                card.innerHTML = `
                    <div style="font-size: 1rem; color: #2563eb; font-weight: 600; margin-bottom: 0.5rem;">
                        #${stock.rank} ${stock.stock_ticker}
                    </div>
                    <div style="font-size: 1.5rem; font-weight: bold; color: #000;">
                        ${stock.total_quantity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div style="font-size: 0.75rem; color: #6c757d; margin-top: 0.25rem;">
                        ${stock.creator_count} creator${stock.creator_count !== 1 ? 's' : ''} · ${stock.portfolio_count} portfolio${stock.portfolio_count !== 1 ? 's' : ''}
                    </div>
                `;
                metricSummary.appendChild(card);
            });

            section.appendChild(metricSummary);
        }

        // Table for per-creator breakdown
        if (creatorStocks && creatorStocks.length > 0) {
            const tableTitle = document.createElement('h3');
            tableTitle.style.cssText = 'margin: 2rem 0 1rem 0; font-size: 1rem; color: #333;';
            tableTitle.textContent = 'Top 5 Stocks by Premium Creator';
            section.appendChild(tableTitle);

            const tableWrapper = document.createElement('div');
            tableWrapper.className = 'qda-table-wrapper';
            tableWrapper.style.cssText = 'overflow-x: auto; margin-top: 1rem;';

            const tableContainer = document.createElement('div');
            tableContainer.style.minWidth = '600px';

            const table = document.createElement('table');
            table.className = 'qda-regression-table';

            const thead = document.createElement('thead');
            thead.innerHTML = `
                <tr>
                    <th style="text-align: left; min-width: 180px;">Premium Creator</th>
                    <th style="text-align: left; min-width: 300px;">Top 5 Stocks</th>
                </tr>
            `;
            table.appendChild(thead);

            const tbody = document.createElement('tbody');
            creatorStocks.forEach(row => {
                const tr = document.createElement('tr');
                // Handle new structure: top_5_stocks is array of {ticker, quantity} objects
                const stocksDisplay = row.top_5_stocks?.map(s => s.ticker).join(', ') || '—';

                tr.innerHTML = `
                    <td style="font-weight: 600;">${row.creator_username || 'N/A'}</td>
                    <td style="font-size: 0.875rem; color: #495057;">${stocksDisplay}</td>
                `;
                tbody.appendChild(tr);
            });
            table.appendChild(tbody);

            tableContainer.appendChild(table);
            tableWrapper.appendChild(tableContainer);
            section.appendChild(tableWrapper);
        }

        container.appendChild(section);
    }

    /**
     * Load and display premium portfolio breakdown (portfolio-level metrics)
     * Uses materialized view for optimized performance
     */
    async loadAndDisplayPremiumPortfolioBreakdown() {
        try {
            if (!this.supabaseIntegration) {
                console.error('Supabase not configured');
                return;
            }

            console.log('Loading premium portfolio breakdown from materialized view...');

            // Query the materialized view - single query with all data pre-joined
            const { data: portfolioData, error } = await this.supabaseIntegration.supabase
                .from('portfolio_breakdown_with_metrics')
                .select('*')
                .order('total_copies', { ascending: false });

            if (error) {
                console.error('Error loading portfolio breakdown:', error);
                return;
            }

            // Transform to match expected format
            const formattedData = portfolioData?.map(p => ({
                creator_username: p.creator_username || 'Unknown',
                portfolio_ticker: p.portfolio_ticker,
                inception_date: p.inception_date || null,
                total_copies: p.total_copies || 0,
                total_liquidations: p.total_liquidations || 0,
                liquidation_rate: p.liquidation_rate || 0,
                all_time_returns: p.total_returns_percentage || null,
                total_copy_capital: p.total_position || null
            })) || [];

            console.log(`✅ Loaded ${formattedData.length} portfolio records from materialized view`);

            // Store data for filtering
            this.portfolioBreakdownData = formattedData;

            // Fetch all premium creators for the filter dropdown
            const { data: allCreators, error: creatorsError } = await this.supabaseIntegration.supabase
                .from('premium_creators')
                .select('creator_username')
                .order('creator_username', { ascending: true });

            if (creatorsError) {
                console.error('Error loading premium creators:', creatorsError);
                // Fall back to creators from portfolio data
                this.allPremiumCreators = [...new Set(formattedData.map(p => p.creator_username))].sort();
            } else {
                // Get unique creator usernames
                this.allPremiumCreators = [...new Set(allCreators.map(c => c.creator_username))].sort();
                console.log(`✅ Loaded ${this.allPremiumCreators.length} premium creators for filter`);
            }

            this.displayPremiumPortfolioBreakdown(formattedData);
        } catch (error) {
            console.error('Error in loadAndDisplayPremiumPortfolioBreakdown:', error);
        }
    }

    /**
     * Display premium portfolio breakdown table with creator filter
     */
    displayPremiumPortfolioBreakdown(portfolioData) {
        const container = document.getElementById('premiumPortfolioBreakdownInline');
        if (!container) {
            console.error('❌ Container premiumPortfolioBreakdownInline not found!');
            return;
        }

        if (!portfolioData || portfolioData.length === 0) {
            container.innerHTML = '';
            return;
        }

        // Store full data for filtering
        this.portfolioBreakdownData = portfolioData;

        const section = document.createElement('div');
        section.className = 'qda-result-section';
        section.style.marginTop = '3rem';

        const title = document.createElement('h2');
        title.style.cssText = 'margin-top: 0; margin-bottom: 0.5rem; display: inline;';
        title.textContent = 'Premium Portfolio Breakdown';
        section.appendChild(title);

        // Add tooltip
        const tooltipHTML = `<span class="info-tooltip" style="vertical-align: middle; margin-left: 8px;">
            <span class="info-icon">i</span>
            <span class="tooltip-text">
                <strong>Premium Portfolio Breakdown</strong>
                Portfolio-level conversion metrics for each premium creator's individual portfolios.
                <ul>
                    <li><strong>Data Sources:</strong>
                        <a href="https://mixpanel.com/project/2599235/view/3138115/app/boards#id=10576025&editor-card-id=%22report-86055000%22" target="_blank" style="color: #17a2b8;">Chart 86055000</a> (Copies & Liquidations Aggregates),
                        <a href="https://mixpanel.com/project/2599235/view/3138115/app/boards#id=10576025&editor-card-id=%22report-85877922%22" target="_blank" style="color: #17a2b8;">Chart 85877922</a> (Portfolio-Creator Mapping),
                        Manual CSV Upload (Portfolio Returns & Capital)
                    </li>
                    <li><strong>Metrics:</strong> Copies, Liquidations, Liquidation Rate, All-Time Returns, Total Copy Capital per portfolio</li>
                </ul>
            </span>
        </span>`;

        const tooltipSpan = document.createElement('span');
        tooltipSpan.innerHTML = tooltipHTML;
        section.appendChild(tooltipSpan);

        const description = document.createElement('p');
        description.style.cssText = 'font-size: 0.875rem; color: #6c757d; margin-top: 0.5rem; margin-bottom: 0.5rem;';
        description.textContent = 'Portfolio-level conversion metrics for each premium creator';
        section.appendChild(description);

        // Use all premium creators for filter (including those without portfolio data)
        const uniqueCreators = this.allPremiumCreators || [...new Set(portfolioData.map(p => p.creator_username))].sort();

        // Store selected creators (all selected by default)
        this.selectedPortfolioCreators = new Set(uniqueCreators);

        // Create filter container with button and chips
        const filterContainer = document.createElement('div');
        filterContainer.style.cssText = 'margin-bottom: 1rem;';

        // Top row: Filter label + button
        const filterRow = document.createElement('div');
        filterRow.style.cssText = 'display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;';

        const filterLabel = document.createElement('span');
        filterLabel.style.cssText = 'font-size: 0.875rem; font-weight: 600;';
        filterLabel.textContent = 'Filter';
        filterRow.appendChild(filterLabel);

        const filterButton = document.createElement('button');
        filterButton.id = 'portfolioFilterButton';
        filterButton.style.cssText = 'background: #2563eb; color: white; border: none; border-radius: 4px; padding: 0.5rem 0.75rem; cursor: pointer; font-size: 0.875rem; display: flex; align-items: center; gap: 0.5rem;';
        filterButton.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2 3h12M4 6h8M6 9h4M7 12h2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
            <span id="filterCountBadge">${this.selectedPortfolioCreators.size} selected</span>
        `;
        filterButton.addEventListener('click', () => {
            this.showPortfolioFilterModal(uniqueCreators);
        });
        filterRow.appendChild(filterButton);

        // Clear All button (text button)
        const clearAllButton = document.createElement('button');
        clearAllButton.textContent = 'Clear All';
        clearAllButton.style.cssText = 'background: none; border: none; color: #dc3545; cursor: pointer; font-size: 0.875rem; text-decoration: underline; padding: 0.5rem;';
        clearAllButton.addEventListener('click', () => {
            // Select all creators (reset filter)
            this.selectedPortfolioCreators = new Set(uniqueCreators);
            this.filterPortfolioBreakdownTable();
            this.updatePortfolioFilterChips();
            // Update badge
            const badge = document.getElementById('filterCountBadge');
            if (badge) {
                badge.textContent = `${this.selectedPortfolioCreators.size} selected`;
            }
        });
        filterRow.appendChild(clearAllButton);

        filterContainer.appendChild(filterRow);

        // Chips container (below the button)
        const chipsContainer = document.createElement('div');
        chipsContainer.id = 'portfolioFilterChips';
        chipsContainer.style.cssText = 'display: flex; flex-wrap: wrap; gap: 0.5rem;';
        filterContainer.appendChild(chipsContainer);

        section.appendChild(filterContainer);

        // Create table wrapper and table
        const tableWrapper = document.createElement('div');
        tableWrapper.className = 'table-wrapper';
        tableWrapper.id = 'portfolioBreakdownTableWrapper';

        section.appendChild(tableWrapper);
        container.appendChild(section);

        // Render initial table with all creators selected
        this.renderPortfolioBreakdownTable(portfolioData);
    }

    /**
     * Show portfolio filter modal with checkboxes
     */
    showPortfolioFilterModal(creators) {
        // Create modal overlay
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 9999; display: flex; align-items: center; justify-content: center;';

        // Create modal
        const modal = document.createElement('div');
        modal.style.cssText = 'background: white; border-radius: 8px; padding: 1.5rem; max-width: 400px; width: 90%; max-height: 80vh; display: flex; flex-direction: column;';

        // Modal header
        const header = document.createElement('div');
        header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;';

        const title = document.createElement('h3');
        title.style.cssText = 'margin: 0; font-size: 1.125rem;';
        title.textContent = 'Filter by Creator';
        header.appendChild(title);

        const closeButton = document.createElement('button');
        closeButton.innerHTML = '×';
        closeButton.style.cssText = 'background: none; border: none; font-size: 1.5rem; cursor: pointer; color: #6c757d; padding: 0; line-height: 1;';
        closeButton.addEventListener('click', () => document.body.removeChild(overlay));
        header.appendChild(closeButton);

        modal.appendChild(header);

        // Scrollable creator list
        const listContainer = document.createElement('div');
        listContainer.style.cssText = 'flex: 1; overflow-y: auto; margin-bottom: 1rem; border: 1px solid #ddd; border-radius: 4px; padding: 0.5rem;';

        creators.forEach(creator => {
            const checkboxWrapper = document.createElement('label');
            checkboxWrapper.style.cssText = 'display: flex; align-items: center; padding: 0.5rem; cursor: pointer; border-radius: 4px;';
            checkboxWrapper.addEventListener('mouseenter', () => {
                checkboxWrapper.style.background = '#f8f9fa';
            });
            checkboxWrapper.addEventListener('mouseleave', () => {
                checkboxWrapper.style.background = 'transparent';
            });

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = creator;
            checkbox.checked = this.selectedPortfolioCreators.has(creator);
            checkbox.style.cssText = 'margin-right: 0.5rem; cursor: pointer;';
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    this.selectedPortfolioCreators.add(creator);
                } else {
                    this.selectedPortfolioCreators.delete(creator);
                }
            });
            checkboxWrapper.appendChild(checkbox);

            const label = document.createElement('span');
            label.textContent = creator;
            label.style.cssText = 'font-size: 0.875rem;';
            checkboxWrapper.appendChild(label);

            listContainer.appendChild(checkboxWrapper);
        });

        modal.appendChild(listContainer);

        // Action buttons
        const actions = document.createElement('div');
        actions.style.cssText = 'display: flex; gap: 0.5rem; justify-content: space-between;';

        // Left side: Select All button
        const selectAllButton = document.createElement('button');
        selectAllButton.textContent = 'Select All';
        selectAllButton.style.cssText = 'background: #f3f4f6; color: #374151; border: 1px solid #d1d5db; border-radius: 4px; padding: 0.5rem 1rem; cursor: pointer; font-size: 0.875rem;';
        selectAllButton.addEventListener('click', () => {
            // Check all checkboxes
            const checkboxes = listContainer.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach(cb => {
                cb.checked = true;
                this.selectedPortfolioCreators.add(cb.value);
            });
        });
        actions.appendChild(selectAllButton);

        // Right side: Clear and Apply buttons
        const rightActions = document.createElement('div');
        rightActions.style.cssText = 'display: flex; gap: 0.5rem;';

        const clearButton = document.createElement('button');
        clearButton.textContent = 'Clear';
        clearButton.style.cssText = 'background: #6c757d; color: white; border: none; border-radius: 4px; padding: 0.5rem 1rem; cursor: pointer; font-size: 0.875rem;';
        clearButton.addEventListener('click', () => {
            // Uncheck all checkboxes
            const checkboxes = listContainer.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach(cb => cb.checked = false);
            this.selectedPortfolioCreators.clear();
        });
        rightActions.appendChild(clearButton);

        const applyButton = document.createElement('button');
        applyButton.textContent = 'Apply';
        applyButton.style.cssText = 'background: #2563eb; color: white; border: none; border-radius: 4px; padding: 0.5rem 1rem; cursor: pointer; font-size: 0.875rem;';
        applyButton.addEventListener('click', () => {
            this.filterPortfolioBreakdownTable();
            // Update badge
            const badge = document.getElementById('filterCountBadge');
            if (badge) {
                badge.textContent = `${this.selectedPortfolioCreators.size} selected`;
            }
            // Update chips display
            this.updatePortfolioFilterChips();
            document.body.removeChild(overlay);
        });
        rightActions.appendChild(applyButton);

        actions.appendChild(rightActions);

        modal.appendChild(actions);

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Close on overlay click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                document.body.removeChild(overlay);
            }
        });
    }

    /**
     * Update portfolio filter chips display (show up to 5 selected creators)
     */
    updatePortfolioFilterChips() {
        const chipsContainer = document.getElementById('portfolioFilterChips');
        if (!chipsContainer) return;

        chipsContainer.innerHTML = '';

        // Get total creators available
        const totalCreators = this.portfolioBreakdownData
            ? [...new Set(this.portfolioBreakdownData.map(p => p.creator_username))].length
            : 0;

        // Only show chips if filtering is active (not all creators selected)
        if (this.selectedPortfolioCreators.size === totalCreators) {
            return; // All selected, no need to show chips
        }

        const selectedCreators = Array.from(this.selectedPortfolioCreators).sort();
        const displayCreators = selectedCreators.slice(0, 5);
        const remainingCount = selectedCreators.length - displayCreators.length;

        displayCreators.forEach(creator => {
            const chip = document.createElement('div');
            chip.style.cssText = 'background: #e0e7ff; color: #3730a3; border-radius: 16px; padding: 0.25rem 0.75rem; font-size: 0.75rem; font-weight: 500; display: flex; align-items: center; gap: 0.5rem;';

            const label = document.createElement('span');
            label.textContent = creator;
            chip.appendChild(label);

            const removeBtn = document.createElement('button');
            removeBtn.innerHTML = '×';
            removeBtn.style.cssText = 'background: none; border: none; color: #3730a3; cursor: pointer; font-size: 1rem; line-height: 1; padding: 0; font-weight: bold;';
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.selectedPortfolioCreators.delete(creator);
                this.filterPortfolioBreakdownTable();
                this.updatePortfolioFilterChips();
                // Update badge
                const badge = document.getElementById('filterCountBadge');
                if (badge) {
                    badge.textContent = `${this.selectedPortfolioCreators.size} selected`;
                }
            });
            chip.appendChild(removeBtn);

            chipsContainer.appendChild(chip);
        });

        // Show "+N more" if there are more than 5
        if (remainingCount > 0) {
            const moreChip = document.createElement('div');
            moreChip.style.cssText = 'background: #f3f4f6; color: #6b7280; border-radius: 16px; padding: 0.25rem 0.75rem; font-size: 0.75rem; font-weight: 500;';
            moreChip.textContent = `+${remainingCount} more`;
            chipsContainer.appendChild(moreChip);
        }
    }

    /**
     * Filter portfolio breakdown table based on selected creators
     */
    filterPortfolioBreakdownTable() {
        if (!this.portfolioBreakdownData) return;

        const selectedCreators = Array.from(this.selectedPortfolioCreators);
        const filteredData = this.portfolioBreakdownData.filter(p =>
            selectedCreators.includes(p.creator_username)
        );

        this.renderPortfolioBreakdownTable(filteredData);
    }

    /**
     * Render portfolio breakdown table with given data
     */
    renderPortfolioBreakdownTable(portfolioData) {
        const tableWrapper = document.getElementById('portfolioBreakdownTableWrapper');
        if (!tableWrapper) return;

        tableWrapper.innerHTML = '';

        if (portfolioData.length === 0) {
            tableWrapper.innerHTML = '<p style="color: #6c757d; font-style: italic;">No portfolios match the selected creators.</p>';
            return;
        }

        const table = document.createElement('table');
        table.className = 'qda-regression-table';

        // Table header with new columns
        const thead = document.createElement('thead');
        thead.innerHTML = `
            <tr>
                <th style="text-align: left;">Portfolio</th>
                <th style="text-align: left;">Creation Date</th>
                <th style="text-align: right; min-width: 100px;">Copies</th>
                <th style="text-align: right; min-width: 120px;">Liquidations</th>
                <th style="text-align: right;">Liquidation Rate</th>
                <th style="text-align: right;">
                    All-Time Returns
                    <span class="info-tooltip" style="display: inline-flex; align-items: center; margin-left: 4px;">
                        <span class="info-icon">i</span>
                        <span class="tooltip-text">All-time returns since 9/30/2024</span>
                    </span>
                </th>
                <th style="text-align: right;">Total Copy Capital</th>
            </tr>
        `;
        table.appendChild(thead);

        // Table body
        const tbody = document.createElement('tbody');
        tbody.id = 'portfolio-breakdown-tbody';

        portfolioData.forEach((row, index) => {
            const tr = document.createElement('tr');

            // Add visibility classes (show first 10, hide rest)
            if (index >= 10) {
                tr.className = 'portfolio-breakdown-row-extra';
                tr.style.display = 'none';
            } else {
                tr.className = 'portfolio-breakdown-row-initial';
            }

            // Format all-time returns as percentage with color
            let returnsDisplay = '—';
            let returnsStyle = 'text-align: right;';
            if (row.all_time_returns !== null && row.all_time_returns !== undefined) {
                const returns = row.all_time_returns * 100; // Convert from decimal to percentage
                const color = returns >= 0 ? '#28a745' : '#dc3545';
                returnsDisplay = `${returns >= 0 ? '+' : ''}${returns.toFixed(2)}%`;
                returnsStyle = `text-align: right; color: ${color}; font-weight: 600;`;
            }

            // Format total copy capital with currency
            let capitalDisplay = '—';
            if (row.total_copy_capital !== null && row.total_copy_capital !== undefined) {
                capitalDisplay = `$${row.total_copy_capital.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            }

            // Format inception date as "Jul 14, 2025"
            let inceptionDateDisplay = '—';
            if (row.inception_date) {
                const date = new Date(row.inception_date);
                const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                inceptionDateDisplay = `${monthNames[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
            }

            tr.innerHTML = `
                <td style="font-weight: 600;">${row.portfolio_ticker || 'N/A'}</td>
                <td style="text-align: left;">${inceptionDateDisplay}</td>
                <td style="text-align: right;">${(row.total_copies || 0).toLocaleString()}</td>
                <td style="text-align: right;">${(row.total_liquidations || 0).toLocaleString()}</td>
                <td style="text-align: right;">${(row.liquidation_rate || 0).toFixed(2)}%</td>
                <td style="${returnsStyle}">${returnsDisplay}</td>
                <td style="text-align: right;">${capitalDisplay}</td>
            `;
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);

        tableWrapper.appendChild(table);

        // Add Show More/Show Less button if there are more than 10 items
        if (portfolioData.length > 10) {
            const buttonContainer = document.createElement('div');
            buttonContainer.style.cssText = 'text-align: left; margin-top: 1rem;';

            const button = document.createElement('button');
            button.id = 'portfolio-breakdown-toggle-btn';
            button.className = 'show-more-btn';
            button.textContent = 'Show More';
            button.onclick = () => window.togglePortfolioBreakdown();

            buttonContainer.appendChild(button);
            tableWrapper.appendChild(buttonContainer);
        }
    }

    /**
     * Load and display premium creator retention analysis
     */
    async loadAndDisplayPremiumCreatorRetention() {
        try {
            if (!this.supabaseIntegration) {
                console.error('Supabase not configured');
                return;
            }

            console.log('Loading premium creator retention...');

            // Fetch retention data from Mixpanel via edge function
            const retentionResponse = await this.supabaseIntegration.fetchCreatorRetention();

            if (retentionResponse && retentionResponse.rawData) {
                this.displayPremiumCreatorRetention(retentionResponse);
            } else {
                throw new Error('No retention data returned');
            }
        } catch (error) {
            console.error('Error in loadAndDisplayPremiumCreatorRetention:', error);
            const container = document.getElementById('premiumCreatorRetentionInline');
            if (container) {
                container.innerHTML = '<p style="color: #dc3545;">Failed to load creator retention data.</p>';
            }
        }
    }

    /**
     * Display premium creator retention analysis
     */
    displayPremiumCreatorRetention(retentionData) {
        const container = document.getElementById('premiumCreatorRetentionInline');
        if (!container) {
            console.error('❌ Container premiumCreatorRetentionInline not found!');
            return;
        }

        if (!retentionData || !retentionData.rawData) {
            container.innerHTML = '';
            return;
        }

        const section = document.createElement('div');
        section.className = 'qda-result-section';
        section.style.marginTop = '3rem';

        const title = document.createElement('h1');
        title.style.cssText = 'margin-top: 0; margin-bottom: 0.5rem; font-size: 1.75rem; display: inline;';
        title.textContent = 'Premium Creator Retention';
        section.appendChild(title);

        // Add tooltip
        const tooltipHTML = `<span class="info-tooltip" style="vertical-align: middle; margin-left: 8px;">
            <span class="info-icon">i</span>
            <span class="tooltip-text">
                <strong>Premium Creator Retention</strong>
                Monthly subscription renewal rates tracking user retention from initial subscription through 6 months.
                <ul>
                    <li><strong>Data Source:</strong> <a href="https://mixpanel.com/project/2599235/view/3138115/app/boards#id=10576025&editor-card-id=%22report-85857452%22" target="_blank" style="color: #17a2b8;">Chart 85857452</a> (Subscription and Renewal Events)</li>
                    <li><strong>Metrics:</strong> Initial subscribers per cohort, renewal counts at months 0-6</li>
                    <li><strong>Calculation:</strong> Tracks distinct users from subscription cohort through renewal events</li>
                </ul>
            </span>
        </span>`;

        const tooltipSpan = document.createElement('span');
        tooltipSpan.innerHTML = tooltipHTML;
        section.appendChild(tooltipSpan);

        const description = document.createElement('p');
        description.style.cssText = 'font-size: 0.875rem; color: #6c757d; margin-top: 0.5rem; margin-bottom: 1.5rem;';
        description.textContent = 'Monthly subscription renewal rates by creator cohort (SubscriptionCreated → SubscriptionRenewed)';
        section.appendChild(description);

        // Create retention chart (Mixpanel-style visualization)
        const chartContainer = document.createElement('div');
        chartContainer.style.cssText = 'overflow-x: auto;';

        section.appendChild(chartContainer);
        container.appendChild(section);

        // Render chart after DOM is updated
        setTimeout(() => {
            this.renderRetentionChart(chartContainer, retentionData);
            // Save to cache after rendering
            this.saveToUnifiedCache();
        }, 0);
    }

    /**
     * Re-attach event listeners to retention table after cache restore
     */
    reattachRetentionEventListeners() {
        const tbody = document.querySelector('#premiumCreatorRetentionInline tbody');
        if (!tbody) return;

        // Find all summary rows and re-attach click handlers
        const summaryRows = tbody.querySelectorAll('tr[data-creator-index]');
        summaryRows.forEach(summaryRow => {
            const creatorIndex = summaryRow.dataset.creatorIndex;
            const expandIcon = summaryRow.querySelector('span:first-child');

            // Re-attach hover effects
            summaryRow.addEventListener('mouseenter', () => {
                if (summaryRow.dataset.expanded === 'false') {
                    summaryRow.style.background = '#f8f9fa';
                }
            });
            summaryRow.addEventListener('mouseleave', () => {
                if (summaryRow.dataset.expanded === 'false') {
                    summaryRow.style.background = 'white';
                }
            });

            // Re-attach click handler
            summaryRow.addEventListener('click', () => {
                const isExpanded = summaryRow.dataset.expanded === 'true';
                summaryRow.dataset.expanded = isExpanded ? 'false' : 'true';
                if (expandIcon) {
                    expandIcon.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(90deg)';
                }

                // Toggle cohort rows visibility
                const cohortRows = tbody.querySelectorAll(`tr[data-parent="${creatorIndex}"]`);
                cohortRows.forEach(row => {
                    row.style.display = isExpanded ? 'none' : 'table-row';
                });
            });
        });
    }

    /**
     * Render retention chart as expandable table
     */
    renderRetentionChart(container, retentionData) {
        // Parse raw data to organize by creator
        const creatorData = this.parseRetentionByCreator(retentionData.rawData);

        // Create table wrapper with border
        const tableWrapper = document.createElement('div');
        tableWrapper.style.cssText = 'border: 1px solid #dee2e6; border-radius: 8px; overflow: hidden;';

        // Create table
        const table = document.createElement('table');
        table.style.cssText = 'width: 100%; border-collapse: collapse; font-size: 0.875rem;';

        // Table header
        const thead = document.createElement('thead');
        thead.innerHTML = `
            <tr style="background: #f8f9fa; border-bottom: 2px solid #dee2e6;">
                <th style="text-align: left; padding: 0.75rem; font-weight: 600; min-width: 250px; width: 250px; white-space: nowrap;">Creator Username</th>
                <th style="text-align: right; padding: 0.75rem; font-weight: 600; width: 80px;">Count</th>
                <th style="text-align: center; padding: 0.75rem; font-weight: 600; width: 100px;">&lt; 1 Month</th>
                <th style="text-align: center; padding: 0.75rem; font-weight: 600; width: 100px;">Month 1</th>
                <th style="text-align: center; padding: 0.75rem; font-weight: 600; width: 100px;">Month 2</th>
                <th style="text-align: center; padding: 0.75rem; font-weight: 600; width: 100px;">Month 3</th>
                <th style="text-align: center; padding: 0.75rem; font-weight: 600; width: 100px;">Month 4</th>
                <th style="text-align: center; padding: 0.75rem; font-weight: 600; width: 100px;">Month 5</th>
                <th style="text-align: center; padding: 0.75rem; font-weight: 600; width: 100px;">Month 6</th>
            </tr>
        `;
        table.appendChild(thead);

        // Table body
        const tbody = document.createElement('tbody');

        creatorData.forEach((creator, creatorIndex) => {
            // Creator summary row (collapsible)
            const summaryRow = document.createElement('tr');
            summaryRow.style.cssText = 'border-bottom: 1px solid #dee2e6; cursor: pointer; background: white; transition: background 0.2s;';
            summaryRow.dataset.expanded = 'false';
            summaryRow.dataset.creatorIndex = creatorIndex;

            // Add hover effect
            summaryRow.addEventListener('mouseenter', () => {
                if (summaryRow.dataset.expanded === 'false') {
                    summaryRow.style.background = '#f8f9fa';
                }
            });
            summaryRow.addEventListener('mouseleave', () => {
                if (summaryRow.dataset.expanded === 'false') {
                    summaryRow.style.background = 'white';
                }
            });

            const expandIcon = document.createElement('span');
            expandIcon.textContent = '▶';
            expandIcon.style.cssText = 'display: inline-block; margin-right: 0.5rem; transition: transform 0.2s;';

            const creatorCell = document.createElement('td');
            creatorCell.style.cssText = 'padding: 0.75rem; font-weight: 600; white-space: nowrap;';
            creatorCell.appendChild(expandIcon);
            creatorCell.appendChild(document.createTextNode(creator.username));
            summaryRow.appendChild(creatorCell);

            // Total count
            const countCell = document.createElement('td');
            countCell.style.cssText = 'text-align: right; padding: 0.75rem;';
            countCell.textContent = creator.totalCount.toLocaleString();
            summaryRow.appendChild(countCell);

            // Retention rate columns (aggregated)
            for (let month = 0; month <= 6; month++) {
                const cell = document.createElement('td');
                cell.style.cssText = 'text-align: center; padding: 0.75rem;';
                const rate = creator.aggregatedRetention[month];
                if (rate !== null) {
                    cell.textContent = rate.toFixed(1) + '%';
                    cell.style.background = this.getRetentionColor(rate);
                } else {
                    cell.textContent = '-';
                }
                summaryRow.appendChild(cell);
            }

            // Click handler to expand/collapse
            summaryRow.addEventListener('click', () => {
                const isExpanded = summaryRow.dataset.expanded === 'true';
                summaryRow.dataset.expanded = isExpanded ? 'false' : 'true';
                expandIcon.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(90deg)';

                // Toggle cohort rows visibility
                const cohortRows = tbody.querySelectorAll(`tr[data-parent="${creatorIndex}"]`);
                cohortRows.forEach(row => {
                    row.style.display = isExpanded ? 'none' : 'table-row';
                });
            });

            tbody.appendChild(summaryRow);

            // Cohort detail rows (initially hidden)
            creator.cohorts.forEach(cohort => {
                const cohortRow = document.createElement('tr');
                cohortRow.style.cssText = 'border-bottom: 1px solid #f1f3f5; display: none; background: #f8f9fa;';
                cohortRow.dataset.parent = creatorIndex;

                // Cohort date (formatted)
                const dateCell = document.createElement('td');
                dateCell.style.cssText = 'padding: 0.5rem 0.75rem 0.5rem 3rem; color: #6c757d;';
                dateCell.textContent = this.formatCohortDate(cohort.cohortDate);
                cohortRow.appendChild(dateCell);

                // Cohort count
                const cohortCountCell = document.createElement('td');
                cohortCountCell.style.cssText = 'text-align: right; padding: 0.5rem 0.75rem; color: #6c757d;';
                cohortCountCell.textContent = cohort.first.toLocaleString();
                cohortRow.appendChild(cohortCountCell);

                // Retention rates by month
                for (let month = 0; month <= 6; month++) {
                    const cell = document.createElement('td');
                    cell.style.cssText = 'text-align: center; padding: 0.5rem 0.75rem;';

                    if (month === 0) {
                        // < 1 Month column - show first renewal rate if available
                        if (cohort.counts.length > 0) {
                            const rate = (cohort.counts[0] / cohort.first) * 100;
                            cell.textContent = rate.toFixed(1) + '%';
                            cell.style.background = this.getRetentionColor(rate);
                        } else {
                            cell.textContent = '-';
                        }
                    } else {
                        // Month 1-6
                        const countIndex = month - 1;
                        if (cohort.counts.length > countIndex && cohort.counts[countIndex] !== undefined) {
                            const rate = (cohort.counts[countIndex] / cohort.first) * 100;
                            cell.textContent = rate.toFixed(1) + '%';
                            cell.style.background = this.getRetentionColor(rate);
                        } else {
                            cell.textContent = '-';
                        }
                    }

                    cohortRow.appendChild(cell);
                }

                tbody.appendChild(cohortRow);
            });
        });

        table.appendChild(tbody);
        tableWrapper.appendChild(table);
        container.appendChild(tableWrapper);
    }

    /**
     * Parse retention data by creator
     */
    parseRetentionByCreator(rawData) {
        const creatorMap = new Map();

        // Iterate through cohort dates
        for (const [cohortDate, cohortData] of Object.entries(rawData)) {
            // Iterate through creators in this cohort
            for (const [username, data] of Object.entries(cohortData)) {
                // Skip $overall and undefined
                if (username === '$overall' || username === 'undefined') continue;

                if (!creatorMap.has(username)) {
                    creatorMap.set(username, {
                        username: username,
                        cohorts: [],
                        totalCount: 0,
                        aggregatedRetention: {}
                    });
                }

                const creator = creatorMap.get(username);
                creator.cohorts.push({
                    cohortDate: cohortDate,
                    first: data.first,
                    counts: data.counts
                });
                creator.totalCount += data.first;
            }
        }

        // Sort cohorts within each creator from oldest to newest
        creatorMap.forEach(creator => {
            creator.cohorts.sort((a, b) => new Date(a.cohortDate) - new Date(b.cohortDate));
        });

        // Calculate aggregated retention rates for each creator
        creatorMap.forEach(creator => {
            const maxMonths = 7; // < 1 Month + Month 1-6

            for (let month = 0; month < maxMonths; month++) {
                let totalFirst = 0;
                let totalRetained = 0;

                creator.cohorts.forEach(cohort => {
                    if (month === 0) {
                        // < 1 Month
                        if (cohort.counts.length > 0) {
                            totalFirst += cohort.first;
                            totalRetained += cohort.counts[0];
                        }
                    } else {
                        // Month 1-6
                        const countIndex = month - 1;
                        if (cohort.counts.length > countIndex) {
                            totalFirst += cohort.first;
                            totalRetained += cohort.counts[countIndex];
                        }
                    }
                });

                creator.aggregatedRetention[month] = totalFirst > 0
                    ? (totalRetained / totalFirst) * 100
                    : null;
            }
        });

        // Sort by total count descending
        return Array.from(creatorMap.values()).sort((a, b) => b.totalCount - a.totalCount);
    }

    /**
     * Format cohort date to readable format (always shows 1st of month)
     */
    formatCohortDate(dateStr) {
        const date = new Date(dateStr);
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                           'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return `${monthNames[date.getMonth()]} 1, ${date.getFullYear()}`;
    }

    /**
     * Get background color for retention rate
     */
    getRetentionColor(rate) {
        if (rate >= 80) return '#d4edda'; // Green - excellent retention
        if (rate >= 60) return '#d1ecf1'; // Blue - good retention
        if (rate >= 40) return '#fff3cd'; // Yellow - moderate retention
        if (rate >= 20) return '#f8d7da'; // Light red - poor retention
        if (rate > 0) return '#f5c6cb';   // Red - very poor retention
        return '#ffffff';                  // White - no data
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
                        <a href="https://mixpanel.com/project/2599235/view/3138115/app/boards#id=10576025&editor-card-id=%22report-85165580%22" target="_blank" style="color: #17a2b8;">Chart 85165580</a> (User-Level Engagement),
                        <a href="https://mixpanel.com/project/2599235/view/3138115/app/boards#id=10576025&editor-card-id=%22report-85130412%22" target="_blank" style="color: #17a2b8;">Chart 85130412</a> (Creator User Profiles)
                    </li>
                    <li><strong>Analysis:</strong> User-level co-copying patterns showing which creators are copied together by the same users</li>
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
        // Enable horizontal scroll for this specific table
        tableWrapper.style.cssText = 'overflow-x: auto;';

        const table = document.createElement('table');
        table.className = 'qda-regression-table';

        // Table header with wider Top 1-5 columns and sticky first column
        const thead = document.createElement('thead');
        thead.innerHTML = `
            <tr>
                <th style="text-align: left; position: sticky; left: 0; background: white; z-index: 10; box-shadow: 2px 0 4px rgba(0,0,0,0.1);">Premium Creator</th>
                <th style="text-align: right; min-width: 100px;">Copies</th>
                <th style="text-align: right; min-width: 120px;">Liquidations</th>
                <th style="text-align: left; min-width: 200px;">Top 1</th>
                <th style="text-align: left; min-width: 200px;">Top 2</th>
                <th style="text-align: left; min-width: 200px;">Top 3</th>
                <th style="text-align: left; min-width: 200px;">Top 4</th>
                <th style="text-align: left; min-width: 200px;">Top 5</th>
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
                <td style="font-weight: 600; position: sticky; left: 0; background: white; z-index: 5; box-shadow: 2px 0 4px rgba(0,0,0,0.05);">${row.premium_creator || 'N/A'}</td>
                <td style="text-align: right;">${(row.premium_creator_total_copies || 0).toLocaleString()}</td>
                <td style="text-align: right;">${(row.premium_creator_total_liquidations || 0).toLocaleString()}</td>
                <td style="vertical-align: top; line-height: 1.6; min-width: 200px;">${this.formatTopCell(row.top_1)}</td>
                <td style="vertical-align: top; line-height: 1.6; min-width: 200px;">${this.formatTopCell(row.top_2)}</td>
                <td style="vertical-align: top; line-height: 1.6; min-width: 200px;">${this.formatTopCell(row.top_3)}</td>
                <td style="vertical-align: top; line-height: 1.6; min-width: 200px;">${this.formatTopCell(row.top_4)}</td>
                <td style="vertical-align: top; line-height: 1.6; min-width: 200px;">${this.formatTopCell(row.top_5)}</td>
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

            // Get the actual Mixpanel data refresh time from sync_logs
            const mixpanelSyncTime = await this.supabaseIntegration.getMostRecentMixpanelSyncTime();
            const displayTime = mixpanelSyncTime || new Date(); // Fallback to current time if no sync found

            const timestamp = displayTime.toLocaleString('en-US', {
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

            // Get the actual Mixpanel data refresh time from sync_logs
            const mixpanelSyncTime = await this.supabaseIntegration.getMostRecentMixpanelSyncTime();
            const displayTime = mixpanelSyncTime || new Date(); // Fallback to current time if no sync found

            const timestamp = displayTime.toLocaleString('en-US', {
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
            // This workflow reloads creator displays

            // Reload and redisplay the Premium Creator Copy Affinity
            this.updateProgress(50, 'Loading Premium Creator Copy Affinity...');

            // Invalidate affinity cache to ensure fresh display
            console.log('Invalidating affinity cache...');
            this.supabaseIntegration.invalidateCache('premium_creator_affinity_display');

            // Clear the output container completely
            this.outputContainer.innerHTML = '';

            // Fetch summary stats for metric cards
            console.log('Fetching summary stats for metric cards...');
            const summaryStats = await this.fetchPremiumCreatorMetrics() || {};

            // Load subscription analysis data
            console.log('Loading subscription analysis data...');
            const [engagementSummary, subscriptionDistribution] = await Promise.all([
                this.supabaseIntegration.loadEngagementSummary().catch(e => { console.warn('Failed to load engagement summary:', e); return null; }),
                this.supabaseIntegration.loadSubscriptionDistribution().catch(e => { console.warn('Failed to load subscription distribution:', e); return []; })
            ]);

            // Re-render the entire creator analysis display
            console.log('Re-rendering creator analysis with fresh data...');
            await this.displayResults({ summaryStats, engagementSummary, subscriptionDistribution });

            // Update timestamp and data scope with current time (matching user tool pattern)
            this.updateTimestampAndDataScope();

            // Save updated HTML to unified cache
            this.saveToUnifiedCache();

            this.updateProgress(100, 'Complete!');
            this.addStatusMessage('✅ Creator data refreshed', 'success');
            console.log('✅ Creator analysis refreshed with latest data');

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

    /**
     * Upload portfolio metrics CSV file
     * Called when user uploads CSV on Premium Creator Analysis tab
     */
    async uploadPortfolioMetricsCSV(file) {
        if (!this.supabaseIntegration) {
            throw new Error('Supabase not configured. Please check your configuration.');
        }

        this.clearStatus();

        // Show the unified progress bar
        const progressSection = document.getElementById('unifiedProgressSection');
        if (progressSection) {
            progressSection.style.display = 'block';
        }

        this.showProgress(0);

        try {
            this.updateProgress(10, `Uploading ${file.name}...`);
            console.log(`📁 Reading portfolio metrics CSV file: ${file.name}`);

            // Read file as text
            const csvContent = await file.text();
            console.log(`✅ Read ${csvContent.length} characters from CSV`);

            // Add small delay to ensure progress bar is visible
            await new Promise(resolve => setTimeout(resolve, 400));
            this.updateProgress(30, 'Uploading to database...');
            console.log('📤 Uploading portfolio metrics to database...');

            // Call edge function to process and store CSV with dataType=performance (default)
            const supabaseUrl = this.supabaseIntegration.supabase.supabaseUrl;
            const supabaseKey = this.supabaseIntegration.supabase.supabaseKey;

            const response = await fetch(`${supabaseUrl}/functions/v1/upload-portfolio-metrics?dataType=performance`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${supabaseKey}`,
                    'Content-Type': 'text/csv'
                },
                body: csvContent
            });

            const uploadResponse = await response.json();

            // Add delay to show progress
            await new Promise(resolve => setTimeout(resolve, 300));
            this.updateProgress(50, 'Processing records...');

            if (!response.ok || !uploadResponse) {
                // Function timed out, but data might still be in DB
                console.warn('Upload function timed out, but data may have been partially saved');
                this.addStatusMessage('⚠️ Upload timed out - checking for saved data...', 'warning');

                // Continue to refresh display to show whatever data was saved
                this.updateProgress(70, 'Refreshing Portfolio Breakdown table...');

                // Only refresh the Portfolio Breakdown table to show saved data
                await this.loadAndDisplayPremiumPortfolioBreakdown();
                this.saveToUnifiedCache();

                this.updateProgress(100, 'Complete!');
                this.addStatusMessage('⚠️ Upload timed out, but saved data has been loaded. You may need to re-upload to complete.', 'warning');

                setTimeout(() => {
                    const progressSection = document.getElementById('unifiedProgressSection');
                    if (progressSection) {
                        progressSection.style.display = 'none';
                    }
                }, 3000);

                return; // Exit early
            }

            if (!uploadResponse.success) {
                throw new Error(uploadResponse.error || 'Failed to upload portfolio metrics');
            }

            console.log(`✅ Uploaded ${uploadResponse.stats.recordsUploaded} portfolio metrics records`);

            // Show appropriate message based on upload status
            if (uploadResponse.stats.partialUpload) {
                this.addStatusMessage(`⚠️ Partial upload: ${uploadResponse.stats.recordsUploaded} of ${uploadResponse.stats.totalRecords} records saved (${uploadResponse.stats.errors} batches failed)`, 'warning');
            } else {
                this.addStatusMessage(`✅ Uploaded ${file.name} (${uploadResponse.stats.recordsUploaded} portfolios from ${uploadResponse.stats.rawRecords} records)`, 'success');
            }

            // Add delay before final step
            await new Promise(resolve => setTimeout(resolve, 300));
            this.updateProgress(70, 'Refreshing table...');

            // Only refresh the Portfolio Breakdown table, not all sections
            await this.loadAndDisplayPremiumPortfolioBreakdown();

            // Save updated HTML to cache
            this.saveToUnifiedCache();

            // Final delay to show completion
            await new Promise(resolve => setTimeout(resolve, 300));
            this.updateProgress(100, 'Complete!');

            // Show success message with details
            const duplicatesMsg = uploadResponse.stats.duplicatesRemoved > 0
                ? ` (${uploadResponse.stats.duplicatesRemoved} duplicates removed)`
                : '';
            this.addStatusMessage(`✅ Portfolio metrics refreshed with latest data${duplicatesMsg}`, 'success');

            // Hide progress bar after 1.5 seconds
            setTimeout(() => {
                const progressSection = document.getElementById('unifiedProgressSection');
                if (progressSection) {
                    progressSection.style.display = 'none';
                }
            }, 1500);
        } catch (error) {
            console.error('Portfolio metrics upload error:', error);
            this.addStatusMessage(`❌ Upload failed: ${error.message}`, 'error');
            this.updateProgress(0, '');

            // Hide progress bar after error
            setTimeout(() => {
                const progressSection = document.getElementById('unifiedProgressSection');
                if (progressSection) {
                    progressSection.style.display = 'none';
                }
            }, 3000);

            throw error;
        }
    }

    /**
     * Upload stock holdings CSV file
     * Called when user uploads holdings CSV on Premium Creator Analysis tab
     */
    async uploadStockHoldingsCSV(file) {
        if (!this.supabaseIntegration) {
            throw new Error('Supabase not configured. Please check your configuration.');
        }

        this.clearStatus();

        // Show the unified progress bar
        const progressSection = document.getElementById('unifiedProgressSection');
        if (progressSection) {
            progressSection.style.display = 'block';
        }

        this.showProgress(0);

        try {
            this.updateProgress(10, `Uploading ${file.name}...`);
            console.log(`📁 Reading stock holdings CSV file: ${file.name}`);

            // Read file as text
            const csvContent = await file.text();
            console.log(`✅ Read ${csvContent.length} characters from CSV`);

            // Add small delay to ensure progress bar is visible
            await new Promise(resolve => setTimeout(resolve, 400));
            this.updateProgress(30, 'Uploading to database...');
            console.log('📤 Uploading stock holdings to database...');

            // Call edge function with dataType=holdings parameter
            const { data: uploadResponse, error: uploadError } = await this.supabaseIntegration.supabase.functions.invoke('upload-portfolio-metrics', {
                body: csvContent,
                headers: {
                    'Content-Type': 'text/csv'
                }
            });

            // Note: We need to pass the dataType as a query parameter
            // Let's use a different approach with fetch
            const supabaseUrl = this.supabaseIntegration.supabase.supabaseUrl;
            const supabaseKey = this.supabaseIntegration.supabase.supabaseKey;

            const response = await fetch(`${supabaseUrl}/functions/v1/upload-portfolio-metrics?dataType=holdings`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${supabaseKey}`,
                    'Content-Type': 'text/csv'
                },
                body: csvContent
            });

            // Add delay to show progress
            await new Promise(resolve => setTimeout(resolve, 300));
            this.updateProgress(50, 'Processing records...');

            let result;
            try {
                result = await response.json();
            } catch (jsonError) {
                console.error('Failed to parse response:', jsonError);
                throw new Error(`Upload failed: Invalid response from server (status ${response.status})`);
            }

            if (!response.ok) {
                const errorMsg = result?.error || `Server error (status ${response.status})`;
                throw new Error(`Upload failed: ${errorMsg}`);
            }

            if (!result.success) {
                const errorMsg = result.error || 'Failed to upload stock holdings';
                throw new Error(`Upload failed: ${errorMsg}`);
            }

            console.log(`✅ Uploaded ${result.stats.recordsUploaded} stock holdings records`);

            // Show appropriate message based on upload status
            if (result.stats.partialUpload) {
                this.addStatusMessage(`⚠️ Partial upload: ${result.stats.recordsUploaded} of ${result.stats.totalRecords} records saved (${result.stats.errors} batches failed)`, 'warning');
            } else {
                this.addStatusMessage(`✅ Uploaded ${file.name} (${result.stats.recordsUploaded} stock holdings)`, 'success');
            }

            // Add delay before final step
            await new Promise(resolve => setTimeout(resolve, 300));
            this.updateProgress(70, 'Refreshing displays...');

            // Refresh portfolio assets breakdown (only if container exists)
            const portfolioAssetsContainer = document.getElementById('portfolioAssetsBreakdownInline');

            if (portfolioAssetsContainer) {
                await this.loadAndDisplayPortfolioAssetsBreakdown();
            } else {
                console.warn('⚠️ Skipping portfolio assets refresh - container not found (likely loaded from cache)');
            }

            // Save updated HTML to cache
            this.saveToUnifiedCache();

            // Final delay to show completion
            await new Promise(resolve => setTimeout(resolve, 300));
            this.updateProgress(100, 'Complete!');

            // Show success message
            this.addStatusMessage(`✅ Stock holdings data refreshed successfully`, 'success');

            // Hide progress bar after 1.5 seconds
            setTimeout(() => {
                const progressSection = document.getElementById('unifiedProgressSection');
                if (progressSection) {
                    progressSection.style.display = 'none';
                }
            }, 1500);
        } catch (error) {
            console.error('Stock holdings upload error:', error);
            this.addStatusMessage(`❌ Upload failed: ${error.message}`, 'error');
            this.updateProgress(0, '');

            // Hide progress bar after error
            setTimeout(() => {
                const progressSection = document.getElementById('unifiedProgressSection');
                if (progressSection) {
                    progressSection.style.display = 'none';
                }
            }, 3000);

            throw error;
        }
    }

}

// Export to window
window.CreatorAnalysisToolSupabase = CreatorAnalysisToolSupabase;

// Global toggle function for Portfolio Breakdown
window.togglePortfolioBreakdown = function() {
    const extraRows = document.querySelectorAll('.portfolio-breakdown-row-extra');
    const button = document.getElementById('portfolio-breakdown-toggle-btn');

    if (!extraRows.length || !button) return;

    // Check if any rows are currently hidden
    const anyHidden = Array.from(extraRows).some(row => row.style.display === 'none');

    if (anyHidden) {
        // Show next 10 hidden rows
        let shown = 0;
        extraRows.forEach((row) => {
            if (row.style.display === 'none' && shown < 10) {
                row.style.display = '';
                shown++;
            }
        });

        // Check if there are still hidden rows
        const stillHidden = Array.from(extraRows).some(row => row.style.display === 'none');
        button.textContent = stillHidden ? 'Show More' : 'Show Less';
    } else {
        // Hide all extra rows
        extraRows.forEach((row) => {
            row.style.display = 'none';
        });
        button.textContent = 'Show More';
    }
};

/**
 * Render subscription price chart using Highcharts
 */
CreatorAnalysisToolSupabase.prototype.renderSubscriptionPriceChart = function(chartId, subscriptionDistribution) {
        if (!subscriptionDistribution || subscriptionDistribution.length === 0) {
            return;
        }

        // Use monthly_price and total_subscriptions from latest_subscription_distribution view
        const prices = subscriptionDistribution.map(d => parseFloat(d.monthly_price));
        const counts = subscriptionDistribution.map(d => parseInt(d.total_subscriptions));

        Highcharts.chart(chartId, {
            chart: {
                type: 'column',
                backgroundColor: '#ffffff',
                style: {
                    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial'
                }
            },
            title: {
                text: null
            },
            xAxis: {
                categories: prices.map(p => `$${p.toFixed(2)}`),
                title: {
                    text: 'Subscription Price'
                }
            },
            yAxis: {
                title: {
                    text: 'Number of Subscriptions'
                },
                allowDecimals: false
            },
            legend: {
                enabled: false
            },
            tooltip: {
                formatter: function() {
                    return `<b>Price:</b> ${this.x}<br/><b>Subscriptions:</b> ${this.y}`;
                }
            },
            plotOptions: {
                column: {
                    color: '#17a2b8',
                    borderRadius: 4,
                    dataLabels: {
                        enabled: true,
                        format: '{y}'
                    }
                }
            },
            series: [{
                name: 'Subscriptions',
                data: counts
            }],
            credits: {
                enabled: false
            }
        });
};

/**
 * Display Top Subscription Drivers section
 * Loads data from subscription_drivers table (populated by user analysis tool)
 */
CreatorAnalysisToolSupabase.prototype.displayTopSubscriptionDrivers = async function(parentSection) {
    try {
        if (!this.supabaseIntegration) {
            console.error('Supabase not configured');
            return;
        }

        // Fetch subscription drivers from database table
        const { data: driversData, error: driversError } = await this.supabaseIntegration.supabase
            .from('subscription_drivers')
            .select('*')
            .order('correlation_coefficient', { ascending: false })
            .limit(20);

        if (driversError) {
            console.error('Error fetching subscription drivers:', driversError);
            return;
        }

        if (!driversData || driversData.length === 0) {
            console.warn('No subscription drivers data available. Run user analysis sync first.');
            return;
        }

        const driversTooltipHTML = `<span class="info-tooltip" style="vertical-align: middle; margin-left: 8px;">
            <span class="info-icon">i</span>
            <span class="tooltip-text">
                <strong>Top Subscription Drivers</strong>
                Behavioral patterns and events that predict subscription conversions.
                <ul>
                    <li><strong>Data Sources:</strong>
                        <a href="https://mixpanel.com/project/2599235/view/3138115/app/boards#id=10576025&editor-card-id=%22report-85165590%22" target="_blank" style="color: #17a2b8;">Chart 85165590</a> (Subscriptions),
                        <a href="https://mixpanel.com/project/2599235/view/3138115/app/boards#id=10576025&editor-card-id=%22report-85165851%22" target="_blank" style="color: #17a2b8;">Chart 85165851</a> (Profile Views)
                    </li>
                    <li><strong>Method:</strong> Logistic regression analysis comparing subscribers vs non-subscribers</li>
                    <li><strong>Metrics:</strong> Correlation coefficients, t-statistics, predictive strength</li>
                </ul>
            </span>
        </span>`;

        const driversSection = document.createElement('div');
        driversSection.style.marginTop = '3rem';
        driversSection.innerHTML = `
            <h2 style="margin-top: 0; margin-bottom: 0.5rem; display: inline;">Top Subscription Drivers</h2>${driversTooltipHTML}
            <p style="font-size: 0.875rem; color: #6c757d; margin-top: 0.5rem; margin-bottom: 1.5rem;">The top events that are the strongest predictors of subscriptions</p>
        `;

        // Create table
        const tableWrapper = document.createElement('div');
        tableWrapper.className = 'table-wrapper';

        const table = document.createElement('table');
        table.className = 'qda-regression-table';

        const thead = document.createElement('thead');
        thead.innerHTML = `
            <tr>
                <th style="text-align: left;">Variable</th>
                <th style="text-align: right;">Correlation</th>
                <th style="text-align: right;">T-Statistic</th>
                <th style="text-align: right;">Predictive Strength</th>
            </tr>
        `;
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        driversData.slice(0, 10).forEach(row => {
            const tr = document.createElement('tr');

            // Use variable label if available
            const displayName = window.getVariableLabel?.(row.variable_name) || row.variable_name;

            // Variable cell
            const varCell = document.createElement('td');
            varCell.style.fontWeight = '600';
            varCell.textContent = displayName;
            tr.appendChild(varCell);

            // Correlation cell
            const corrCell = document.createElement('td');
            corrCell.style.textAlign = 'right';
            corrCell.textContent = parseFloat(row.correlation_coefficient).toFixed(2);
            tr.appendChild(corrCell);

            // T-Statistic cell
            const tStatCell = document.createElement('td');
            tStatCell.style.textAlign = 'right';
            tStatCell.textContent = parseFloat(row.t_stat).toFixed(2);
            tr.appendChild(tStatCell);

            // Predictive Strength cell with color coding
            const strengthCell = document.createElement('td');
            strengthCell.style.textAlign = 'right';
            const strengthValue = row.predictive_strength || 'N/A';

            // Calculate predictive strength class using same logic as behavioral drivers
            const result = window.calculatePredictiveStrength?.(
                parseFloat(row.correlation_coefficient),
                parseFloat(row.t_stat)
            ) || { strength: strengthValue, className: '' };

            const strengthSpan = document.createElement('span');
            strengthSpan.className = result.className;
            strengthSpan.textContent = result.strength;
            strengthCell.appendChild(strengthSpan);
            tr.appendChild(strengthCell);

            tbody.appendChild(tr);
        });
        table.appendChild(tbody);

        tableWrapper.appendChild(table);
        driversSection.appendChild(tableWrapper);
        parentSection.appendChild(driversSection);

    } catch (error) {
        console.error('Error in displayTopSubscriptionDrivers:', error);
    }
};

console.log('✅ Creator Analysis Tool (Supabase) loaded successfully!');
