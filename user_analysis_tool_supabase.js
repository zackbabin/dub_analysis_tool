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
     * Override: Add engagement analysis sections after Subscription section in Behavioral Analysis
     */
    async displayResults(results) {
        // Call parent method to display standard results
        super.displayResults(results);

        // Add engagement analysis sections after Subscriptions section, before footer
        const resultsDiv = document.getElementById('qdaAnalysisResultsInline');
        if (resultsDiv) {
            // Find all h4 elements to locate the Subscriptions section
            const headings = Array.from(resultsDiv.querySelectorAll('h4'));
            const subscriptionsHeading = headings.find(h => h.textContent === 'Subscriptions');

            // Find the footer (element with Predictive Strength text)
            const footer = Array.from(resultsDiv.children).find(child =>
                child.innerHTML && child.innerHTML.includes('Predictive Strength Calculation')
            );

            // Create subscription engagement section
            const subscriptionEngagementSection = document.createElement('div');
            subscriptionEngagementSection.id = 'qdaEngagementAnalysisInline';

            // Create portfolio copies section
            const copyEngagementSection = document.createElement('div');
            copyEngagementSection.id = 'qdaCopyEngagementAnalysisInline';

            // Create hidden gems section
            const hiddenGemsSection = document.createElement('div');
            hiddenGemsSection.id = 'qdaHiddenGemsAnalysisInline';

            // Insert all sections before footer
            if (subscriptionsHeading && footer) {
                resultsDiv.insertBefore(subscriptionEngagementSection, footer);
                resultsDiv.insertBefore(copyEngagementSection, footer);
                resultsDiv.insertBefore(hiddenGemsSection, footer);

                // Remove blue left border from footer
                footer.style.borderLeft = 'none';
            } else if (footer) {
                resultsDiv.insertBefore(subscriptionEngagementSection, footer);
                resultsDiv.insertBefore(copyEngagementSection, footer);
                resultsDiv.insertBefore(hiddenGemsSection, footer);
                footer.style.borderLeft = 'none';
            } else {
                resultsDiv.appendChild(subscriptionEngagementSection);
                resultsDiv.appendChild(copyEngagementSection);
                resultsDiv.appendChild(hiddenGemsSection);
            }

            // Load and display all engagement analyses
            this.displayEngagementAnalysis();
            this.displayCopyEngagementAnalysis();
            this.displayHiddenGemsAnalysis();
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
            const [summaryData, topPairs] = await Promise.all([
                this.supabaseIntegration.loadEngagementSummary(),
                this.supabaseIntegration.loadTopConvertingPairs()
            ]);

            console.log('Engagement data loaded:', {
                summaryData: summaryData?.length || 0,
                topPairs: topPairs?.length || 0
            });

            // Summary Stats Card
            if (summaryData && summaryData.length === 2) {
                const subscribersData = summaryData.find(d => d.did_subscribe === true) || {};
                const nonSubscribersData = summaryData.find(d => d.did_subscribe === false) || {};

                // Title with smaller font
                const summaryTitle = document.createElement('h5');
                summaryTitle.textContent = 'Key Insights: Subscribers vs Non-Subscribers';
                summaryTitle.style.fontSize = '0.95rem';
                summaryTitle.style.fontWeight = '600';
                summaryTitle.style.marginTop = '1rem';
                section.appendChild(summaryTitle);

                // Container for the 4 separate cards
                const cardsContainer = document.createElement('div');
                cardsContainer.style.display = 'grid';
                cardsContainer.style.gridTemplateColumns = 'repeat(4, 1fr)';
                cardsContainer.style.gap = '1rem';
                cardsContainer.style.marginBottom = '2rem';

                // Create 4 separate cards
                const metrics = [
                    { label: 'Avg Profile Views', subscriberValue: subscribersData.avg_profile_views || 0, nonSubscriberValue: nonSubscribersData.avg_profile_views || 0 },
                    { label: 'Avg PDP Views', subscriberValue: subscribersData.avg_pdp_views || 0, nonSubscriberValue: nonSubscribersData.avg_pdp_views || 0 },
                    { label: 'Unique Creators', subscriberValue: subscribersData.avg_unique_creators || 0, nonSubscriberValue: nonSubscribersData.avg_unique_creators || 0 },
                    { label: 'Unique Portfolios', subscriberValue: subscribersData.avg_unique_portfolios || 0, nonSubscriberValue: nonSubscribersData.avg_unique_portfolios || 0 }
                ];

                metrics.forEach(metric => {
                    const card = document.createElement('div');
                    card.style.backgroundColor = '#f8f9fa';
                    card.style.padding = '1rem';
                    card.style.borderRadius = '8px';
                    card.innerHTML = `
                        <div style="font-size: 0.875rem; color: #2563eb; font-weight: 600; margin-bottom: 0.5rem;">${metric.label}</div>
                        <div style="font-size: 1.5rem; font-weight: bold;">
                            ${parseFloat(metric.subscriberValue).toFixed(1)}
                            <span style="font-size: 0.9rem; color: #6c757d; font-weight: normal;">vs ${parseFloat(metric.nonSubscriberValue).toFixed(1)}</span>
                        </div>
                    `;
                    cardsContainer.appendChild(card);
                });

                section.appendChild(cardsContainer);
            }

            // Top Converting Portfolio-Creator Pairs (filter for minimum 10 PDP views)
            const filteredPairs = topPairs && topPairs.length > 0
                ? topPairs.filter(pair => parseInt(pair.total_views) >= 10)
                : [];

            if (filteredPairs.length > 0) {
                const pairsSection = document.createElement('div');
                pairsSection.style.marginTop = '2rem';

                const pairsTitle = document.createElement('h5');
                pairsTitle.textContent = 'Top Converting Portfolio-Creator Combinations';
                pairsTitle.style.fontSize = '0.95rem';
                pairsTitle.style.fontWeight = '600';
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
                            <th style="padding: 0.75rem; text-align: right;">Unique Views</th>
                            <th style="padding: 0.75rem; text-align: right;">Subscribers</th>
                            <th style="padding: 0.75rem; text-align: right;">Conversion Rate</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${filteredPairs.map((pair, index) => `
                            <tr style="border-bottom: 1px solid #dee2e6; ${index % 2 === 0 ? 'background-color: #ffffff;' : 'background-color: #f8f9fa;'}">
                                <td style="padding: 0.75rem;">${pair.portfolio_ticker || 'N/A'}</td>
                                <td style="padding: 0.75rem;">${pair.creator_username || 'N/A'}</td>
                                <td style="padding: 0.75rem; text-align: right;">${parseInt(pair.total_users).toLocaleString()}</td>
                                <td style="padding: 0.75rem; text-align: right;">${parseInt(pair.subscribers).toLocaleString()}</td>
                                <td style="padding: 0.75rem; text-align: right;">${parseFloat(pair.conversion_rate_pct).toFixed(1)}%</td>
                            </tr>
                        `).join('')}
                    </tbody>
                `;

                pairsSection.appendChild(pairsTable);

                // Add footnote
                const footnote = document.createElement('p');
                footnote.style.fontSize = '0.875rem';
                footnote.style.color = '#6c757d';
                footnote.style.fontStyle = 'italic';
                footnote.style.marginTop = '0.5rem';
                footnote.textContent = 'Portfolios with a minimum of 10 PDP views';
                pairsSection.appendChild(footnote);

                section.appendChild(pairsSection);
            }

            // Append section to container
            container.appendChild(section);

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
     * Display portfolio copies conversion analysis
     */
    async displayCopyEngagementAnalysis() {
        const container = document.getElementById('qdaCopyEngagementAnalysisInline');
        if (!container) return;

        container.innerHTML = '';

        const section = document.createElement('div');
        section.className = 'qda-result-section';

        try {
            // Load copy engagement data from Supabase
            console.log('Loading copy engagement analysis data...');
            const [summaryData, topPairs] = await Promise.all([
                this.supabaseIntegration.loadCopyEngagementSummary(),
                this.supabaseIntegration.loadTopConvertingCopyPairs()
            ]);

            console.log('Copy engagement data loaded:', {
                summaryData: summaryData?.length || 0,
                topPairs: topPairs?.length || 0
            });

            // Summary Stats Card
            if (summaryData && summaryData.length === 2) {
                const copiersData = summaryData.find(d => d.did_copy === true) || {};
                const nonCopiersData = summaryData.find(d => d.did_copy === false) || {};

                // Title with smaller font
                const summaryTitle = document.createElement('h5');
                summaryTitle.textContent = 'Key Insights: Copiers vs Non-Copiers';
                summaryTitle.style.fontSize = '0.95rem';
                summaryTitle.style.fontWeight = '600';
                summaryTitle.style.marginTop = '1rem';
                section.appendChild(summaryTitle);

                // Container for the 4 separate cards
                const cardsContainer = document.createElement('div');
                cardsContainer.style.display = 'grid';
                cardsContainer.style.gridTemplateColumns = 'repeat(4, 1fr)';
                cardsContainer.style.gap = '1rem';
                cardsContainer.style.marginBottom = '2rem';

                // Create 4 separate cards
                const metrics = [
                    { label: 'Avg Profile Views', copierValue: copiersData.avg_profile_views || 0, nonCopierValue: nonCopiersData.avg_profile_views || 0 },
                    { label: 'Avg PDP Views', copierValue: copiersData.avg_pdp_views || 0, nonCopierValue: nonCopiersData.avg_pdp_views || 0 },
                    { label: 'Unique Creators', copierValue: copiersData.avg_unique_creators || 0, nonCopierValue: nonCopiersData.avg_unique_creators || 0 },
                    { label: 'Unique Portfolios', copierValue: copiersData.avg_unique_portfolios || 0, nonCopierValue: nonCopiersData.avg_unique_portfolios || 0 }
                ];

                metrics.forEach(metric => {
                    const card = document.createElement('div');
                    card.style.backgroundColor = '#f8f9fa';
                    card.style.padding = '1rem';
                    card.style.borderRadius = '8px';
                    card.innerHTML = `
                        <div style="font-size: 0.875rem; color: #2563eb; font-weight: 600; margin-bottom: 0.5rem;">${metric.label}</div>
                        <div style="font-size: 1.5rem; font-weight: bold;">
                            ${parseFloat(metric.copierValue).toFixed(1)}
                            <span style="font-size: 0.9rem; color: #6c757d; font-weight: normal;">vs ${parseFloat(metric.nonCopierValue).toFixed(1)}</span>
                        </div>
                    `;
                    cardsContainer.appendChild(card);
                });

                section.appendChild(cardsContainer);
            }

            // Top Converting Portfolio-Creator Pairs (filter for minimum 10 views)
            const filteredPairs = topPairs && topPairs.length > 0
                ? topPairs.filter(pair => parseInt(pair.total_views) >= 10)
                : [];

            if (filteredPairs.length > 0) {
                const pairsSection = document.createElement('div');
                pairsSection.style.marginTop = '2rem';

                const pairsTitle = document.createElement('h5');
                pairsTitle.textContent = 'Top Converting Portfolio-Creator Combinations';
                pairsTitle.style.fontSize = '0.95rem';
                pairsTitle.style.fontWeight = '600';
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
                            <th style="padding: 0.75rem; text-align: right;">Unique Views</th>
                            <th style="padding: 0.75rem; text-align: right;">Copiers</th>
                            <th style="padding: 0.75rem; text-align: right;">Conversion Rate</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${filteredPairs.map((pair, index) => `
                            <tr style="border-bottom: 1px solid #dee2e6; ${index % 2 === 0 ? 'background-color: #ffffff;' : 'background-color: #f8f9fa;'}">
                                <td style="padding: 0.75rem;">${pair.portfolio_ticker || 'N/A'}</td>
                                <td style="padding: 0.75rem;">${pair.creator_username || 'N/A'}</td>
                                <td style="padding: 0.75rem; text-align: right;">${parseInt(pair.total_views).toLocaleString()}</td>
                                <td style="padding: 0.75rem; text-align: right;">${parseInt(pair.copiers).toLocaleString()}</td>
                                <td style="padding: 0.75rem; text-align: right;">${parseFloat(pair.conversion_rate_pct).toFixed(1)}%</td>
                            </tr>
                        `).join('')}
                    </tbody>
                `;

                pairsSection.appendChild(pairsTable);

                // Add footnote
                const footnote = document.createElement('p');
                footnote.style.fontSize = '0.875rem';
                footnote.style.color = '#6c757d';
                footnote.style.fontStyle = 'italic';
                footnote.style.marginTop = '0.5rem';
                footnote.textContent = 'Portfolios with a minimum of 10 views';
                pairsSection.appendChild(footnote);

                section.appendChild(pairsSection);
            }

            // Append section to container
            container.appendChild(section);

        } catch (error) {
            console.error('Error loading copy engagement analysis:', error);
            const errorMsg = document.createElement('p');
            errorMsg.textContent = `Error loading copy engagement analysis: ${error.message}`;
            errorMsg.style.color = '#dc3545';
            section.appendChild(errorMsg);
            container.appendChild(section);
        }
    }

    /**
     * Display hidden gems analysis
     */
    async displayHiddenGemsAnalysis() {
        const container = document.getElementById('qdaHiddenGemsAnalysisInline');
        if (!container) return;

        container.innerHTML = '';

        const section = document.createElement('div');
        section.className = 'qda-result-section';

        try {
            // Load hidden gems data from Supabase
            console.log('Loading hidden gems analysis data...');
            const [summaryData, hiddenGems] = await Promise.all([
                this.supabaseIntegration.loadHiddenGemsSummary(),
                this.supabaseIntegration.loadHiddenGems()
            ]);

            console.log('Hidden gems data loaded:', {
                summary: summaryData || {},
                hiddenGems: hiddenGems?.length || 0
            });

            // Title
            const title = document.createElement('h5');
            title.textContent = 'Hidden Gems';
            title.style.fontSize = '0.95rem';
            title.style.fontWeight = '600';
            title.style.marginTop = '1rem';
            section.appendChild(title);

            // Summary Stats (4 cards in grid)
            if (summaryData) {
                const cardsContainer = document.createElement('div');
                cardsContainer.style.display = 'grid';
                cardsContainer.style.gridTemplateColumns = 'repeat(4, 1fr)';
                cardsContainer.style.gap = '1rem';
                cardsContainer.style.marginBottom = '2rem';

                const metrics = [
                    { label: 'Total Hidden Gems', value: summaryData.total_hidden_gems || 0, format: 'number' },
                    { label: 'Avg PDP Views', value: summaryData.avg_pdp_views || 0, format: 'decimal' },
                    { label: 'Avg Conversion Rate', value: summaryData.avg_conversion_rate || 0, format: 'percent' },
                    { label: 'Missed Opportunities', value: summaryData.total_missed_opportunities || 0, format: 'number' }
                ];

                metrics.forEach(metric => {
                    const card = document.createElement('div');
                    card.style.backgroundColor = '#f8f9fa';
                    card.style.padding = '1rem';
                    card.style.borderRadius = '8px';

                    let displayValue = '';
                    if (metric.format === 'number') {
                        displayValue = parseInt(metric.value).toLocaleString();
                    } else if (metric.format === 'decimal') {
                        displayValue = parseFloat(metric.value).toFixed(1);
                    } else if (metric.format === 'percent') {
                        displayValue = parseFloat(metric.value).toFixed(2) + '%';
                    }

                    card.innerHTML = `
                        <div style="font-size: 0.875rem; color: #2563eb; font-weight: 600; margin-bottom: 0.5rem;">${metric.label}</div>
                        <div style="font-size: 1.5rem; font-weight: bold;">${displayValue}</div>
                    `;
                    cardsContainer.appendChild(card);
                });

                section.appendChild(cardsContainer);
            }

            // Hidden Gems Table
            if (hiddenGems && hiddenGems.length > 0) {
                const tableSection = document.createElement('div');
                tableSection.style.marginTop = '2rem';

                const tableTitle = document.createElement('h6');
                tableTitle.textContent = 'High Engagement, Low Conversion Portfolios';
                tableTitle.style.fontSize = '0.875rem';
                tableTitle.style.fontWeight = '600';
                tableTitle.style.marginBottom = '1rem';
                tableSection.appendChild(tableTitle);

                const table = document.createElement('table');
                table.style.width = '100%';
                table.style.borderCollapse = 'collapse';

                table.innerHTML = `
                    <thead>
                        <tr style="background-color: #f8f9fa; border-bottom: 2px solid #dee2e6;">
                            <th style="padding: 0.75rem; text-align: left;">Portfolio</th>
                            <th style="padding: 0.75rem; text-align: left;">Creator</th>
                            <th style="padding: 0.75rem; text-align: right;">PDP Views</th>
                            <th style="padding: 0.75rem; text-align: right;">Profile Views</th>
                            <th style="padding: 0.75rem; text-align: right;">Unique Viewers</th>
                            <th style="padding: 0.75rem; text-align: right;">Copies</th>
                            <th style="padding: 0.75rem; text-align: right;">Conversion %</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${hiddenGems.map((gem, index) => `
                            <tr style="border-bottom: 1px solid #dee2e6; ${index % 2 === 0 ? 'background-color: #ffffff;' : 'background-color: #f8f9fa;'}">
                                <td style="padding: 0.75rem;">${gem.portfolio_ticker || 'N/A'}</td>
                                <td style="padding: 0.75rem;">${gem.creator_username || 'N/A'}</td>
                                <td style="padding: 0.75rem; text-align: right;">${parseInt(gem.total_pdp_views).toLocaleString()}</td>
                                <td style="padding: 0.75rem; text-align: right;">${parseInt(gem.total_profile_views).toLocaleString()}</td>
                                <td style="padding: 0.75rem; text-align: right;">${parseInt(gem.unique_viewers).toLocaleString()}</td>
                                <td style="padding: 0.75rem; text-align: right;">${parseInt(gem.total_copies).toLocaleString()}</td>
                                <td style="padding: 0.75rem; text-align: right;">${parseFloat(gem.conversion_rate_pct).toFixed(1)}%</td>
                            </tr>
                        `).join('')}
                    </tbody>
                `;

                tableSection.appendChild(table);

                // Add footnote
                const footnote = document.createElement('p');
                footnote.style.fontSize = '0.875rem';
                footnote.style.color = '#6c757d';
                footnote.style.fontStyle = 'italic';
                footnote.style.marginTop = '0.5rem';
                footnote.textContent = 'Portfolios in top 25% of engagement (PDP & Profile views) with ≤10% conversion rate';
                tableSection.appendChild(footnote);

                section.appendChild(tableSection);
            } else {
                const noDataMsg = document.createElement('p');
                noDataMsg.textContent = 'No hidden gems found. This could mean high engagement portfolios are converting well.';
                noDataMsg.style.fontStyle = 'italic';
                noDataMsg.style.color = '#6c757d';
                section.appendChild(noDataMsg);
            }

            // Append section to container
            container.appendChild(section);

        } catch (error) {
            console.error('Error loading hidden gems analysis:', error);
            const errorMsg = document.createElement('p');
            errorMsg.textContent = `Error loading hidden gems analysis: ${error.message}`;
            errorMsg.style.color = '#dc3545';
            section.appendChild(errorMsg);
            container.appendChild(section);
        }
    }

}

// Export to window
window.UserAnalysisToolSupabase = UserAnalysisToolSupabase;

console.log('✅ User Analysis Tool (Supabase) loaded successfully!');
