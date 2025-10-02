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
        this.updateProgress(15, 'Syncing data...');

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
            const subscriptionDist = await this.supabaseIntegration.loadSubscriptionDistribution();

            // Subscription Price Distribution Chart
            const subSection = document.createElement('div');
            subSection.style.marginBottom = '2rem';

            const subTitle = document.createElement('h4');
            subTitle.textContent = 'Subscription Price Distribution';
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

        } catch (error) {
            console.error('Error loading breakdown data:', error);
            console.error('Error details:', error.message, error.stack);
            const errorMsg = document.createElement('p');
            errorMsg.textContent = `Error loading breakdown data: ${error.message || 'Please try syncing again.'}`;
            errorMsg.style.color = '#dc3545';
            section.appendChild(errorMsg);
        }

        container.appendChild(section);
    }

    /**
     * Create subscription price distribution chart
     */
    createSubscriptionDistributionChart(data, containerId) {
        const categories = data.map(d => `$${parseFloat(d.subscription_price).toFixed(2)}`);
        const values = data.map(d => parseInt(d.total_subscriptions));

        Highcharts.chart(containerId, {
            chart: { type: 'column' },
            title: { text: null },
            xAxis: {
                categories: categories,
                title: { text: 'Subscription Price' }
            },
            yAxis: {
                title: { text: 'Total Subscriptions' },
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

}

// Export to window
window.CreatorAnalysisToolSupabase = CreatorAnalysisToolSupabase;

console.log('✅ Creator Analysis Tool (Supabase) loaded successfully!');
