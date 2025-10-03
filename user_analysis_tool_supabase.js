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
        // Try to restore from cache first (base results only)
        const cached = localStorage.getItem('dubAnalysisResults');
        if (cached) {
            try {
                const data = JSON.parse(cached);
                if (this.outputContainer && data.html) {
                    this.outputContainer.innerHTML = data.html;
                    console.log('✅ Restored base analysis from cache');

                    // After restoring, add engagement sections
                    await this.addEngagementSections();
                    return;
                }
            } catch (e) {
                console.warn('Failed to restore from cache, rebuilding:', e);
            }
        }

        // If no cache or cache failed, build from scratch
        // Call parent method to display standard results
        super.displayResults(results);

        // Add engagement analysis sections
        await this.addEngagementSections();
    }

    /**
     * Helper method to add engagement sections to the results
     * This is called both when building fresh and when restoring from cache
     */
    async addEngagementSections() {
        const resultsDiv = document.getElementById('qdaAnalysisResultsInline');
        if (!resultsDiv) {
            console.warn('Results div not found, cannot add engagement sections');
            return;
        }

        // Check if sections already exist (from cache)
        if (document.getElementById('qdaEngagementAnalysisInline')) {
            console.log('Engagement sections already exist, refreshing data...');
            // Just refresh the data in existing containers
            await Promise.all([
                this.displayEngagementAnalysis(),
                this.displayCopyEngagementAnalysis(),
                this.displayHiddenGemsAnalysis()
            ]);
            return;
        }

        // Find all h4 elements to locate Portfolio Copies and Subscriptions sections
        const headings = Array.from(resultsDiv.querySelectorAll('h4'));
        console.log('All h4 headings:', headings.map(h => h.textContent));
        const portfolioCopiesHeading = headings.find(h => h.textContent === 'Portfolio Copies');
        const subscriptionsHeading = headings.find(h => h.textContent === 'Subscriptions');
        console.log('Found Portfolio Copies heading:', !!portfolioCopiesHeading);
        console.log('Found Subscriptions heading:', !!subscriptionsHeading);

        // Create subscription engagement section
        const subscriptionEngagementSection = document.createElement('div');
        subscriptionEngagementSection.id = 'qdaEngagementAnalysisInline';

        // Create portfolio copies engagement section
        const copyEngagementSection = document.createElement('div');
        copyEngagementSection.id = 'qdaCopyEngagementAnalysisInline';

        // Create hidden gems section
        const hiddenGemsSection = document.createElement('div');
        hiddenGemsSection.id = 'qdaHiddenGemsAnalysisInline';

        // Find the insertion point after Subscriptions (before footer)
        let insertAfterSubs = null;
        if (subscriptionsHeading) {
            console.log('Found Subscriptions heading, looking for footer...');

            // Find the footer element (it contains "Predictive Strength Calculation")
            const footer = Array.from(resultsDiv.children).find(child =>
                child.innerHTML && child.innerHTML.includes('Predictive Strength Calculation')
            );

            console.log('Footer found:', !!footer);

            if (footer) {
                // Insert right before the footer
                insertAfterSubs = footer.previousElementSibling;
                console.log('Will insert before footer, after element:', insertAfterSubs?.tagName);
            } else {
                // If no footer found, find last element after subscriptions heading
                let currentElement = subscriptionsHeading.nextElementSibling;
                while (currentElement && currentElement.nextElementSibling) {
                    insertAfterSubs = currentElement;
                    currentElement = currentElement.nextElementSibling;
                }
                console.log('No footer found, inserting at end');
            }
        }

        // Find the next h4 after Portfolio Copies
        let insertAfterCopies = null;
        if (portfolioCopiesHeading) {
            const copiesIndex = headings.indexOf(portfolioCopiesHeading);
            const nextHeading = headings[copiesIndex + 1];

            if (nextHeading) {
                let currentElement = portfolioCopiesHeading.nextElementSibling;
                while (currentElement && currentElement !== nextHeading) {
                    insertAfterCopies = currentElement;
                    currentElement = currentElement.nextElementSibling;
                }
            }
        }

        // Insert subscription engagement after Subscriptions section
        if (insertAfterSubs) {
            console.log('Inserting subscription sections after element:', insertAfterSubs);
            // Insert subscription engagement first
            insertAfterSubs.parentNode.insertBefore(subscriptionEngagementSection, insertAfterSubs.nextElementSibling);
            // Insert hidden gems after subscription engagement
            subscriptionEngagementSection.parentNode.insertBefore(hiddenGemsSection, subscriptionEngagementSection.nextElementSibling);
        } else {
            console.warn('Could not find insertion point for subscription sections');
        }

        // Insert copy engagement after Portfolio Copies section
        if (insertAfterCopies) {
            console.log('Inserting copy sections after element:', insertAfterCopies);
            insertAfterCopies.parentNode.insertBefore(copyEngagementSection, insertAfterCopies.nextElementSibling);
        } else {
            console.warn('Could not find insertion point for copy sections');
        }

        // Load and display all engagement analyses
        await Promise.all([
            this.displayEngagementAnalysis(),
            this.displayCopyEngagementAnalysis(),
            this.displayHiddenGemsAnalysis()
        ]);

        // Save base results to localStorage (without engagement sections)
        // This allows faster cache restore, and engagement sections are rebuilt fresh
        if (resultsDiv && !cached) {
            // Only save on first build, not when sections are added
            this.saveBaseAnalysisResults();
        }
    }

    /**
     * Save only the base analysis results (without engagement sections)
     * Engagement sections will be rebuilt from Supabase on each load
     */
    saveBaseAnalysisResults() {
        // Find the base results div
        const resultsDiv = document.getElementById('qdaAnalysisResultsInline');
        if (!resultsDiv) return;

        // Clone the results div
        const clone = resultsDiv.cloneNode(true);

        // Remove engagement sections from the clone
        const sectionsToRemove = [
            'qdaEngagementAnalysisInline',
            'qdaCopyEngagementAnalysisInline',
            'qdaHiddenGemsAnalysisInline'
        ];

        sectionsToRemove.forEach(id => {
            const section = clone.querySelector(`#${id}`);
            if (section) {
                section.remove();
            }
        });

        // Save the cleaned HTML
        try {
            localStorage.setItem('dubAnalysisResults', JSON.stringify({
                html: clone.outerHTML,
                timestamp: new Date().toISOString()
            }));
            console.log('✅ Saved base analysis results to cache (engagement sections excluded)');
        } catch (error) {
            console.warn('Failed to save to localStorage:', error);
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
            const [summaryData, topCombinations] = await Promise.all([
                this.supabaseIntegration.loadEngagementSummary(),
                this.supabaseIntegration.loadTopSubscriptionCombinations('lift', 10)
            ]);

            console.log('Engagement data loaded:', {
                summaryData: summaryData?.length || 0,
                topCombinations: topCombinations?.length || 0
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

            // Top Creator Combinations (from logistic regression analysis)
            if (topCombinations && topCombinations.length > 0) {
                const combinationsSection = document.createElement('div');
                combinationsSection.style.marginTop = '2rem';

                const combinationsTitle = document.createElement('h5');
                combinationsTitle.textContent = 'Top Creator Combinations for Subscription (by Lift)';
                combinationsTitle.style.fontSize = '0.95rem';
                combinationsTitle.style.fontWeight = '600';
                combinationsSection.appendChild(combinationsTitle);

                const combinationsTable = document.createElement('table');
                combinationsTable.style.width = '100%';
                combinationsTable.style.borderCollapse = 'collapse';
                combinationsTable.style.marginTop = '1rem';

                combinationsTable.innerHTML = `
                    <thead>
                        <tr style="background-color: #f8f9fa; border-bottom: 2px solid #dee2e6;">
                            <th style="padding: 0.75rem; text-align: left;">Creator Trio</th>
                            <th style="padding: 0.75rem; text-align: right;">Lift</th>
                            <th style="padding: 0.75rem; text-align: right;">Odds Ratio</th>
                            <th style="padding: 0.75rem; text-align: right;">Conv. Rate</th>
                            <th style="padding: 0.75rem; text-align: right;">Users Exposed</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${topCombinations.map((combo, index) => `
                            <tr style="border-bottom: 1px solid #dee2e6; ${index % 2 === 0 ? 'background-color: #ffffff;' : 'background-color: #f8f9fa;'}">
                                <td style="padding: 0.75rem; font-size: 0.85rem;">${combo.value_1}, ${combo.value_2}, ${combo.value_3}</td>
                                <td style="padding: 0.75rem; text-align: right; font-weight: 600;">${parseFloat(combo.lift).toFixed(2)}x</td>
                                <td style="padding: 0.75rem; text-align: right;">${parseFloat(combo.odds_ratio).toFixed(2)}</td>
                                <td style="padding: 0.75rem; text-align: right;">${(parseFloat(combo.conversion_rate_in_group) * 100).toFixed(1)}%</td>
                                <td style="padding: 0.75rem; text-align: right;">${parseInt(combo.users_with_exposure).toLocaleString()}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                `;

                combinationsSection.appendChild(combinationsTable);

                // Add footnote
                const footnote = document.createElement('p');
                footnote.style.fontSize = '0.875rem';
                footnote.style.color = '#6c757d';
                footnote.style.fontStyle = 'italic';
                footnote.style.marginTop = '0.5rem';
                footnote.textContent = 'Results from exhaustive search with logistic regression (ranked by lift)';
                combinationsSection.appendChild(footnote);

                section.appendChild(combinationsSection);
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
            const [summaryData, topCombinations] = await Promise.all([
                this.supabaseIntegration.loadCopyEngagementSummary(),
                this.supabaseIntegration.loadTopCopyCombinations('lift', 10)
            ]);

            console.log('Copy engagement data loaded:', {
                summaryData: summaryData?.length || 0,
                topCombinations: topCombinations?.length || 0
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

            // Top Creator Combinations (from logistic regression analysis)
            if (topCombinations && topCombinations.length > 0) {
                const combinationsSection = document.createElement('div');
                combinationsSection.style.marginTop = '2rem';

                const combinationsTitle = document.createElement('h5');
                combinationsTitle.textContent = 'Top Creator Combinations for Copies (by Lift)';
                combinationsTitle.style.fontSize = '0.95rem';
                combinationsTitle.style.fontWeight = '600';
                combinationsSection.appendChild(combinationsTitle);

                const combinationsTable = document.createElement('table');
                combinationsTable.style.width = '100%';
                combinationsTable.style.borderCollapse = 'collapse';
                combinationsTable.style.marginTop = '1rem';

                combinationsTable.innerHTML = `
                    <thead>
                        <tr style="background-color: #f8f9fa; border-bottom: 2px solid #dee2e6;">
                            <th style="padding: 0.75rem; text-align: left;">Creator Trio</th>
                            <th style="padding: 0.75rem; text-align: right;">Lift</th>
                            <th style="padding: 0.75rem; text-align: right;">Odds Ratio</th>
                            <th style="padding: 0.75rem; text-align: right;">Conv. Rate</th>
                            <th style="padding: 0.75rem; text-align: right;">Users Exposed</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${topCombinations.map((combo, index) => `
                            <tr style="border-bottom: 1px solid #dee2e6; ${index % 2 === 0 ? 'background-color: #ffffff;' : 'background-color: #f8f9fa;'}">
                                <td style="padding: 0.75rem; font-size: 0.85rem;">${combo.value_1}, ${combo.value_2}, ${combo.value_3}</td>
                                <td style="padding: 0.75rem; text-align: right; font-weight: 600;">${parseFloat(combo.lift).toFixed(2)}x</td>
                                <td style="padding: 0.75rem; text-align: right;">${parseFloat(combo.odds_ratio).toFixed(2)}</td>
                                <td style="padding: 0.75rem; text-align: right;">${(parseFloat(combo.conversion_rate_in_group) * 100).toFixed(1)}%</td>
                                <td style="padding: 0.75rem; text-align: right;">${parseInt(combo.users_with_exposure).toLocaleString()}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                `;

                combinationsSection.appendChild(combinationsTable);

                // Add footnote
                const footnote = document.createElement('p');
                footnote.style.fontSize = '0.875rem';
                footnote.style.color = '#6c757d';
                footnote.style.fontStyle = 'italic';
                footnote.style.marginTop = '0.5rem';
                footnote.textContent = 'Results from exhaustive search with logistic regression (ranked by lift)';
                combinationsSection.appendChild(footnote);

                section.appendChild(combinationsSection);
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
                cardsContainer.style.gridTemplateColumns = 'repeat(3, 1fr)';
                cardsContainer.style.gap = '1rem';
                cardsContainer.style.marginBottom = '2rem';

                const metrics = [
                    { label: 'Total Hidden Gems', value: summaryData.total_hidden_gems || 0, format: 'number' },
                    { label: 'Avg PDP Views', value: summaryData.avg_pdp_views || 0, format: 'decimal' },
                    { label: 'Avg Conversion Rate', value: summaryData.avg_conversion_rate || 0, format: 'percent' }
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

            // Hidden Gems Table (limit to top 25)
            const topHiddenGems = hiddenGems && hiddenGems.length > 0
                ? hiddenGems.slice(0, 25)
                : [];

            if (topHiddenGems.length > 0) {
                const tableSection = document.createElement('div');
                tableSection.style.marginTop = '2rem';

                const table = document.createElement('table');
                table.style.width = '100%';
                table.style.borderCollapse = 'collapse';

                table.innerHTML = `
                    <thead>
                        <tr style="background-color: #f8f9fa; border-bottom: 2px solid #dee2e6;">
                            <th style="padding: 0.75rem; text-align: left;">Portfolio</th>
                            <th style="padding: 0.75rem; text-align: left;">Creator</th>
                            <th style="padding: 0.75rem; text-align: right;">Total PDP Views</th>
                            <th style="padding: 0.75rem; text-align: right;">Total Profile Views</th>
                            <th style="padding: 0.75rem; text-align: right;">Unique Views</th>
                            <th style="padding: 0.75rem; text-align: right;">Total Copies</th>
                            <th style="padding: 0.75rem; text-align: right;">Conversion Rate</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${topHiddenGems.map((gem, index) => `
                            <tr style="border-bottom: 1px solid #dee2e6; ${index % 2 === 0 ? 'background-color: #ffffff;' : 'background-color: #f8f9fa;'}">
                                <td style="padding: 0.75rem;">${gem.portfolio_ticker || 'N/A'}</td>
                                <td style="padding: 0.75rem;">${gem.creator_username || 'N/A'}</td>
                                <td style="padding: 0.75rem; text-align: right;">${parseInt(gem.total_pdp_views).toLocaleString()}</td>
                                <td style="padding: 0.75rem; text-align: right;">${parseInt(gem.total_profile_views).toLocaleString()}</td>
                                <td style="padding: 0.75rem; text-align: right;">${parseInt(gem.unique_views).toLocaleString()}</td>
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
                footnote.textContent = 'Portfolios in top 50% of engagement (PDP & Profile views) with ≤25% conversion rate';
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
