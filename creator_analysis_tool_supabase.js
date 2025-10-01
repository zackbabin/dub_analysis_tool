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
    }

    /**
     * Override: Run the sync workflow using Supabase
     */
    async runSyncWorkflow() {
        if (!this.supabaseIntegration) {
            throw new Error('Supabase not configured. Please check your configuration.');
        }

        // Step 1: Trigger Supabase Edge Function
        this.updateProgress(15, 'Syncing creator data...');

        console.log('Triggering Supabase creator sync...');
        const result = await this.supabaseIntegration.triggerCreatorSync();

        if (!result || !result.success) {
            throw new Error('Failed to sync creator data');
        }

        console.log('✅ Creator sync completed:', result.stats);
        this.updateProgress(30, 'Loading data...');

        // Step 2: Load data from Supabase
        const contents = await this.supabaseIntegration.loadCreatorDataFromSupabase();
        this.updateProgress(50, 'Processing data...');

        console.log('✅ Data loaded from Supabase');

        // Step 3: Process and analyze data
        // contents is an array with one CSV string
        await this.processAndAnalyze(contents[0]);
    }

    /**
     * Override: Display creator breakdown with Supabase breakdown data
     */
    async displayCreatorBreakdown(stats) {
        const container = document.getElementById('creatorBreakdownInline');
        container.innerHTML = '';

        const section = document.createElement('div');
        section.className = 'qda-result-section';

        const title = document.createElement('h1');
        title.textContent = 'Breakdown';
        section.appendChild(title);

        try {
            // Load breakdown data from Supabase
            const [subscriptionDist, topCreators, topPortfolios] = await Promise.all([
                this.supabaseIntegration.loadSubscriptionDistribution(),
                this.supabaseIntegration.loadTopCreatorsByPortfolioCopies(),
                this.supabaseIntegration.loadTopPortfoliosByCopies()
            ]);

            // 1. Subscription Price Distribution Chart
            const subSection = document.createElement('div');
            subSection.style.marginBottom = '2rem';

            const subTitle = document.createElement('h4');
            subTitle.textContent = 'Subscription Price Distribution (Monthly)';
            subSection.appendChild(subTitle);

            if (subscriptionDist && subscriptionDist.length > 0) {
                const subChartContainer = document.createElement('div');
                subChartContainer.id = 'subscriptionDistributionChart';
                subChartContainer.style.width = '100%';
                subChartContainer.style.height = '400px';
                subSection.appendChild(subChartContainer);

                // Create chart
                this.createSubscriptionDistributionChart(subscriptionDist, 'subscriptionDistributionChart');
            } else {
                const placeholder = document.createElement('p');
                placeholder.textContent = 'No subscription price data available.';
                placeholder.style.fontStyle = 'italic';
                placeholder.style.color = '#6c757d';
                subSection.appendChild(placeholder);
            }

            section.appendChild(subSection);

            // 2. Top 10 Creators by Portfolio Copies
            const creatorSection = document.createElement('div');
            creatorSection.style.marginBottom = '2rem';

            const creatorTitle = document.createElement('h4');
            creatorTitle.textContent = 'Top 10 Creators by Portfolio Copies';
            creatorSection.appendChild(creatorTitle);

            if (topCreators && topCreators.length > 0) {
                const creatorChartContainer = document.createElement('div');
                creatorChartContainer.id = 'topCreatorsChart';
                creatorChartContainer.style.width = '100%';
                creatorChartContainer.style.height = '400px';
                creatorSection.appendChild(creatorChartContainer);

                // Create chart
                this.createTopCreatorsChart(topCreators, 'topCreatorsChart');
            } else {
                const placeholder = document.createElement('p');
                placeholder.textContent = 'No creator copy data available.';
                placeholder.style.fontStyle = 'italic';
                placeholder.style.color = '#6c757d';
                creatorSection.appendChild(placeholder);
            }

            section.appendChild(creatorSection);

            // 3. Top 10 Portfolios by Copies
            const portfolioSection = document.createElement('div');
            portfolioSection.style.marginBottom = '2rem';

            const portfolioTitle = document.createElement('h4');
            portfolioTitle.textContent = 'Top 10 Portfolios by Copies';
            portfolioSection.appendChild(portfolioTitle);

            if (topPortfolios && topPortfolios.length > 0) {
                const portfolioChartContainer = document.createElement('div');
                portfolioChartContainer.id = 'topPortfoliosChart';
                portfolioChartContainer.style.width = '100%';
                portfolioChartContainer.style.height = '400px';
                portfolioSection.appendChild(portfolioChartContainer);

                // Create chart
                this.createTopPortfoliosChart(topPortfolios, 'topPortfoliosChart');
            } else {
                const placeholder = document.createElement('p');
                placeholder.textContent = 'No portfolio copy data available.';
                placeholder.style.fontStyle = 'italic';
                placeholder.style.color = '#6c757d';
                portfolioSection.appendChild(placeholder);
            }

            section.appendChild(portfolioSection);

        } catch (error) {
            console.error('Error loading breakdown data:', error);
            const errorMsg = document.createElement('p');
            errorMsg.textContent = 'Error loading breakdown data. Please try syncing again.';
            errorMsg.style.color = '#dc3545';
            section.appendChild(errorMsg);
        }

        container.appendChild(section);
    }

    /**
     * Create subscription price distribution chart
     */
    createSubscriptionDistributionChart(data, containerId) {
        const categories = data.map(d => `$${parseFloat(d.monthly_price_rounded).toFixed(2)}`);
        const values = data.map(d => parseInt(d.total_subscriptions));

        Highcharts.chart(containerId, {
            chart: { type: 'column' },
            title: { text: null },
            xAxis: {
                categories: categories,
                title: { text: 'Monthly Subscription Price' }
            },
            yAxis: {
                title: { text: 'Number of Subscriptions' },
                min: 0
            },
            tooltip: {
                formatter: function() {
                    return `<b>${this.x}</b><br/>Subscriptions: ${this.y.toLocaleString()}`;
                }
            },
            legend: { enabled: false },
            series: [{
                name: 'Subscriptions',
                data: values,
                color: '#2563eb'
            }]
        });
    }

    /**
     * Create top creators chart
     */
    createTopCreatorsChart(data, containerId) {
        const categories = data.map(d => d.creator_username || 'Unknown');
        const values = data.map(d => parseInt(d.total_copies));

        Highcharts.chart(containerId, {
            chart: { type: 'bar' },
            title: { text: null },
            xAxis: {
                categories: categories,
                title: { text: null }
            },
            yAxis: {
                title: { text: 'Total Portfolio Copies' },
                min: 0
            },
            tooltip: {
                formatter: function() {
                    return `<b>${this.x}</b><br/>Copies: ${this.y.toLocaleString()}`;
                }
            },
            legend: { enabled: false },
            series: [{
                name: 'Copies',
                data: values,
                color: '#10b981'
            }]
        });
    }

    /**
     * Create top portfolios chart
     */
    createTopPortfoliosChart(data, containerId) {
        const categories = data.map(d => d.portfolio_ticker || 'Unknown');
        const values = data.map(d => parseInt(d.total_copies));

        Highcharts.chart(containerId, {
            chart: { type: 'bar' },
            title: { text: null },
            xAxis: {
                categories: categories,
                title: { text: null }
            },
            yAxis: {
                title: { text: 'Total Copies' },
                min: 0
            },
            tooltip: {
                formatter: function() {
                    return `<b>${this.x}</b><br/>Copies: ${this.y.toLocaleString()}`;
                }
            },
            legend: { enabled: false },
            series: [{
                name: 'Copies',
                data: values,
                color: '#f59e0b'
            }]
        });
    }
}

// Export to window
window.CreatorAnalysisToolSupabase = CreatorAnalysisToolSupabase;

console.log('✅ Creator Analysis Tool (Supabase) loaded successfully!');
