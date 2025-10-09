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
     * Override: Run the upload workflow using Supabase
     */
    async runUploadWorkflow(csvContent) {
        if (!this.supabaseIntegration) {
            throw new Error('Supabase not configured. Please check your configuration.');
        }

        try {
            this.updateProgress(40, 'Cleaning and processing data...');

            // Parse and clean the CSV
            const cleanedData = this.parseAndCleanCreatorCSV(csvContent);
            console.log(`Parsed ${cleanedData.length} creator records`);

            this.updateProgress(60, 'Uploading to database...');

            // Upload and enrich data through Supabase
            const result = await this.supabaseIntegration.uploadAndEnrichCreatorData(cleanedData);

            if (!result || !result.success) {
                throw new Error(result?.error || 'Failed to upload creator data');
            }

            console.log('✅ Creator data uploaded:', result.stats);
            this.updateProgress(80, 'Loading updated data...');

            // Load and display the updated data
            const contents = await this.supabaseIntegration.loadCreatorDataFromSupabase();
            this.updateProgress(90, 'Analyzing data...');

            // Process and analyze
            await this.processAndAnalyze(contents[0]);

            this.updateProgress(100, 'Complete!');
        } catch (error) {
            console.error('Upload workflow error:', error);
            throw error;
        }
    }

    /**
     * Parse and clean creator CSV data
     * Renames columns, cleans headers, stores all data in raw_data JSONB
     */
    parseAndCleanCreatorCSV(csvContent) {
        // Parse CSV
        const lines = csvContent.trim().split('\n');
        if (lines.length < 2) {
            throw new Error('CSV file is empty or invalid');
        }

        // Get headers and clean them
        const rawHeaders = lines[0].split(',');
        const cleanedHeaders = rawHeaders.map(header =>
            header
                .trim()
                .toLowerCase()
                .replace(/[^a-z0-9_]/g, '_') // Replace non-alphanumeric with underscore
                .replace(/_+/g, '_') // Replace multiple underscores with single
                .replace(/^_|_$/g, '') // Remove leading/trailing underscores
        );

        console.log('Original headers:', rawHeaders);
        console.log('Cleaned headers:', cleanedHeaders);

        // Find important column indices
        const handleIndex = cleanedHeaders.findIndex(h => h === 'handle');
        const useruuidIndex = cleanedHeaders.findIndex(h => h === 'useruuid');

        if (handleIndex === -1) {
            throw new Error('CSV must contain "handle" column');
        }
        if (useruuidIndex === -1) {
            throw new Error('CSV must contain "useruuid" column');
        }

        // Process each data row
        const cleanedData = [];
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const values = this.parseCSVLine(line);
            if (values.length !== rawHeaders.length) {
                console.warn(`Skipping line ${i + 1}: column count mismatch`);
                continue;
            }

            // Build raw_data object with all CSV columns
            const rawData = {};
            cleanedHeaders.forEach((header, index) => {
                rawData[header] = values[index]?.trim() || null;
            });

            // Extract creator_username and creator_id
            const creatorUsername = values[handleIndex]?.trim();
            const creatorId = values[useruuidIndex]?.trim();

            if (!creatorUsername || !creatorId) {
                console.warn(`Skipping line ${i + 1}: missing handle or useruuid`);
                continue;
            }

            cleanedData.push({
                creator_id: creatorId,
                creator_username: creatorUsername,
                raw_data: rawData
            });
        }

        return cleanedData;
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
            subTitle.textContent = 'Subscription Price Distribution (Monthly)';
            subSection.appendChild(subTitle);

            if (subscriptionDist && subscriptionDist.length > 0) {
                const subChartContainer = document.createElement('div');
                subChartContainer.id = 'subscriptionDistributionChart';
                subChartContainer.style.width = '100%';
                subChartContainer.style.height = '400px';
                subSection.appendChild(subChartContainer);

                // Wait for DOM to update before creating chart
                setTimeout(() => {
                    this.createSubscriptionDistributionChart(subscriptionDist, 'subscriptionDistributionChart');
                }, 100);
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
        const categories = data.map(d => `$${parseFloat(d.monthly_price).toFixed(2)}`);
        const subscriptions = data.map(d => parseInt(d.total_subscriptions));
        const paywallViews = data.map(d => parseInt(d.total_paywall_views || 0));
        const usernames = data.map(d => d.creator_usernames || []);

        Highcharts.chart(containerId, {
            chart: { type: 'column' },
            title: { text: null },
            xAxis: {
                categories: categories,
                title: { text: 'Monthly Subscription Price' }
            },
            yAxis: {
                title: { text: 'Count' },
                min: 0
            },
            tooltip: {
                useHTML: true,
                shared: true,
                headerFormat: '',
                formatter: function() {
                    const index = this.points[0].point.index;
                    const subs = subscriptions[index];
                    const paywall = paywallViews[index];
                    const ratio = paywall > 0 ? ((subs / paywall) * 100).toFixed(2) : '0.00';
                    const creators = usernames[index] || [];
                    const topCreators = creators.slice(0, 10);

                    let tooltip = `<span style="color:#2563eb">\u25CF</span> Total Subscriptions: <b>${subs.toLocaleString()}</b><br/>`;
                    tooltip += `<span style="color:#10b981">\u25CF</span> Total Paywall Views: <b>${paywall.toLocaleString()}</b><br/>`;
                    tooltip += `<span style="color:#f59e0b">\u25CF</span> Subscriptions to Paywall Ratio: <b>${ratio}%</b><br/>`;

                    if (topCreators.length > 0) {
                        tooltip += '<br/><b>Top Creators:</b><br/>';
                        topCreators.forEach(creator => {
                            tooltip += `• ${creator}<br/>`;
                        });
                        if (creators.length > 10) {
                            tooltip += `<i>... and ${creators.length - 10} more</i>`;
                        }
                    }

                    return tooltip;
                }
            },
            legend: {
                enabled: true,
                align: 'center',
                verticalAlign: 'bottom'
            },
            plotOptions: {
                column: {
                    grouping: true,
                    shadow: false,
                    borderWidth: 0
                }
            },
            series: [{
                name: 'Total Subscriptions',
                data: subscriptions,
                color: '#2563eb'
            }, {
                name: 'Total Paywall Views',
                data: paywallViews,
                color: '#10b981'
            }]
        });
    }

}

// Export to window
window.CreatorAnalysisToolSupabase = CreatorAnalysisToolSupabase;

console.log('✅ Creator Analysis Tool (Supabase) loaded successfully!');
