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
     * Override: Add engagement analysis section after standard results
     */
    async displayResults(results) {
        // Call parent method to display standard results
        super.displayResults(results);

        // Add engagement analysis section BEFORE the footer
        const resultsDiv = document.getElementById('qdaAnalysisResultsInline');
        if (resultsDiv) {
            // Find the footer (look for element with Predictive Strength text)
            const footer = Array.from(resultsDiv.children).find(child =>
                child.innerHTML && child.innerHTML.includes('Predictive Strength Calculation')
            );

            const engagementSection = document.createElement('div');
            engagementSection.id = 'qdaEngagementAnalysisInline';

            // Insert before footer if found, otherwise append to end
            if (footer) {
                resultsDiv.insertBefore(engagementSection, footer);

                // Remove blue left border from footer
                footer.style.borderLeft = 'none';
            } else {
                resultsDiv.appendChild(engagementSection);
            }

            // Load and display engagement analysis
            this.displayEngagementAnalysis();
        }
    }

    /**
     * Display subscription conversion analysis
     */
    async displayEngagementAnalysis() {
        const container = document.getElementById('qdaEngagementAnalysisInline');
        if (!container) return;

        container.innerHTML = '';

        const section = document.createElement('div');
        section.className = 'qda-result-section';

        try {
            // Load engagement data from Supabase
            console.log('Loading engagement analysis data...');
            const [conversionData, summaryData, topPairs] = await Promise.all([
                this.supabaseIntegration.loadSubscriptionConversionAnalysis(),
                this.supabaseIntegration.loadEngagementSummary(),
                this.supabaseIntegration.loadTopConvertingPairs()
            ]);

            console.log('Engagement data loaded:', {
                conversionData: conversionData?.length || 0,
                summaryData: summaryData?.length || 0,
                topPairs: topPairs?.length || 0
            });

            // Summary Stats Card
            if (summaryData && summaryData.length === 2) {
                const subscribersData = summaryData.find(d => d.did_subscribe === true) || {};
                const nonSubscribersData = summaryData.find(d => d.did_subscribe === false) || {};

                const summaryCard = document.createElement('div');
                summaryCard.style.backgroundColor = '#f8f9fa';
                summaryCard.style.padding = '1.5rem';
                summaryCard.style.borderRadius = '8px';
                summaryCard.style.marginBottom = '2rem';

                summaryCard.innerHTML = `
                    <h4 style="margin-top: 0;">Key Insights: Subscribers vs Non-Subscribers</h4>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem;">
                        <div>
                            <div style="font-weight: bold; color: #2563eb;">Avg Profile Views</div>
                            <div style="font-size: 1.5rem;">
                                ${parseFloat(subscribersData.avg_profile_views || 0).toFixed(1)}
                                <span style="font-size: 0.9rem; color: #6c757d;">vs ${parseFloat(nonSubscribersData.avg_profile_views || 0).toFixed(1)}</span>
                            </div>
                        </div>
                        <div>
                            <div style="font-weight: bold; color: #10b981;">Avg PDP Views</div>
                            <div style="font-size: 1.5rem;">
                                ${parseFloat(subscribersData.avg_pdp_views || 0).toFixed(1)}
                                <span style="font-size: 0.9rem; color: #6c757d;">vs ${parseFloat(nonSubscribersData.avg_pdp_views || 0).toFixed(1)}</span>
                            </div>
                        </div>
                        <div>
                            <div style="font-weight: bold; color: #f59e0b;">Unique Creators</div>
                            <div style="font-size: 1.5rem;">
                                ${parseFloat(subscribersData.avg_unique_creators || 0).toFixed(1)}
                                <span style="font-size: 0.9rem; color: #6c757d;">vs ${parseFloat(nonSubscribersData.avg_unique_creators || 0).toFixed(1)}</span>
                            </div>
                        </div>
                        <div>
                            <div style="font-weight: bold; color: #8b5cf6;">Unique Portfolios</div>
                            <div style="font-size: 1.5rem;">
                                ${parseFloat(subscribersData.avg_unique_portfolios || 0).toFixed(1)}
                                <span style="font-size: 0.9rem; color: #6c757d;">vs ${parseFloat(nonSubscribersData.avg_unique_portfolios || 0).toFixed(1)}</span>
                            </div>
                        </div>
                    </div>
                `;
                section.appendChild(summaryCard);
            }

            // Top Converting Portfolio-Creator Pairs
            if (topPairs && topPairs.length > 0) {
                const pairsSection = document.createElement('div');
                pairsSection.style.marginTop = '2rem';

                const pairsTitle = document.createElement('h4');
                pairsTitle.textContent = 'Top Converting Portfolio-Creator Combinations';
                pairsSection.appendChild(pairsTitle);

                const pairsTable = document.createElement('table');
                pairsTable.style.width = '100%';
                pairsTable.style.borderCollapse = 'collapse';
                pairsTable.style.marginTop = '1rem';

                pairsTable.innerHTML = `
                    <thead>
                        <tr style="background-color: #f8f9fa; border-bottom: 2px solid #dee2e6;">
                            <th style="padding: 0.75rem; text-align: left;">Portfolio</th>
                            <th style="padding: 0.75rem; text-align: left;">Creator</th>
                            <th style="padding: 0.75rem; text-align: right;">Users</th>
                            <th style="padding: 0.75rem; text-align: right;">Subscribers</th>
                            <th style="padding: 0.75rem; text-align: right;">Conversion Rate</th>
                            <th style="padding: 0.75rem; text-align: right;">Total Views</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${topPairs.map((pair, index) => `
                            <tr style="border-bottom: 1px solid #dee2e6; ${index % 2 === 0 ? 'background-color: #ffffff;' : 'background-color: #f8f9fa;'}">
                                <td style="padding: 0.75rem; font-weight: bold; color: #2563eb;">${pair.portfolio_ticker || 'N/A'}</td>
                                <td style="padding: 0.75rem; color: #10b981;">${pair.creator_username || 'N/A'}</td>
                                <td style="padding: 0.75rem; text-align: right;">${parseInt(pair.total_users).toLocaleString()}</td>
                                <td style="padding: 0.75rem; text-align: right;">${parseInt(pair.subscribers).toLocaleString()}</td>
                                <td style="padding: 0.75rem; text-align: right; font-weight: bold;">
                                    <span style="background-color: ${pair.conversion_rate_pct >= 50 ? '#10b981' : pair.conversion_rate_pct >= 25 ? '#f59e0b' : '#6c757d'}; color: white; padding: 0.25rem 0.5rem; border-radius: 4px;">
                                        ${parseFloat(pair.conversion_rate_pct).toFixed(1)}%
                                    </span>
                                </td>
                                <td style="padding: 0.75rem; text-align: right;">${parseInt(pair.total_views).toLocaleString()}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                `;

                pairsSection.appendChild(pairsTable);
                section.appendChild(pairsSection);
            }

            // Conversion Heatmap
            if (conversionData && conversionData.length > 0) {
                const heatmapSection = document.createElement('div');
                heatmapSection.style.marginTop = '2rem';

                const heatmapTitle = document.createElement('h4');
                heatmapTitle.textContent = 'Conversion Rate by Engagement Level';
                heatmapSection.appendChild(heatmapTitle);

                const chartContainer = document.createElement('div');
                chartContainer.id = 'subscriptionConversionHeatmap';
                chartContainer.style.width = '100%';
                chartContainer.style.height = '500px';
                heatmapSection.appendChild(chartContainer);

                section.appendChild(heatmapSection);
            } else {
                const placeholder = document.createElement('p');
                placeholder.textContent = 'No conversion data available. Please sync data first.';
                placeholder.style.fontStyle = 'italic';
                placeholder.style.color = '#6c757d';
                section.appendChild(placeholder);
            }

            // Append section to container BEFORE creating charts
            container.appendChild(section);

            // Now create the chart after DOM is updated
            if (conversionData && conversionData.length > 0) {
                setTimeout(() => {
                    this.createConversionHeatmap(conversionData, 'subscriptionConversionHeatmap');
                }, 100);
            }

        } catch (error) {
            console.error('Error loading engagement analysis:', error);
            const errorMsg = document.createElement('p');
            errorMsg.textContent = `Error loading engagement analysis: ${error.message}`;
            errorMsg.style.color = '#dc3545';
            section.appendChild(errorMsg);
            container.appendChild(section);
        }
    }

    /**
     * Create conversion rate heatmap
     */
    createConversionHeatmap(data, containerId) {
        // Define bucket order
        const bucketOrder = ['0', '1-2', '3-5', '6-10', '10+'];

        // Transform data into heatmap format
        const heatmapData = [];
        bucketOrder.forEach((profileBucket, yIndex) => {
            bucketOrder.forEach((pdpBucket, xIndex) => {
                const dataPoint = data.find(d =>
                    d.profile_views_bucket === profileBucket &&
                    d.pdp_views_bucket === pdpBucket
                );

                if (dataPoint) {
                    heatmapData.push([
                        xIndex,
                        yIndex,
                        parseFloat(dataPoint.conversion_rate_pct) || 0
                    ]);
                }
            });
        });

        Highcharts.chart(containerId, {
            chart: {
                type: 'heatmap',
                plotBorderWidth: 1
            },
            title: {
                text: null
            },
            xAxis: {
                categories: bucketOrder,
                title: {
                    text: 'PDP Views'
                }
            },
            yAxis: {
                categories: bucketOrder,
                title: {
                    text: 'Profile Views'
                },
                reversed: true
            },
            colorAxis: {
                min: 0,
                minColor: '#FFFFFF',
                maxColor: '#2563eb'
            },
            legend: {
                align: 'right',
                layout: 'vertical',
                margin: 0,
                verticalAlign: 'top',
                y: 25,
                symbolHeight: 280
            },
            tooltip: {
                formatter: function () {
                    return `<b>Profile Views:</b> ${bucketOrder[this.point.y]}<br/>` +
                           `<b>PDP Views:</b> ${bucketOrder[this.point.x]}<br/>` +
                           `<b>Conversion Rate:</b> ${this.point.value.toFixed(2)}%`;
                }
            },
            series: [{
                name: 'Conversion Rate',
                borderWidth: 1,
                data: heatmapData,
                dataLabels: {
                    enabled: true,
                    color: '#000000',
                    formatter: function() {
                        return this.point.value > 0 ? this.point.value.toFixed(1) + '%' : '';
                    }
                }
            }]
        });
    }
}

// Export to window
window.UserAnalysisToolSupabase = UserAnalysisToolSupabase;

console.log('✅ User Analysis Tool (Supabase) loaded successfully!');
