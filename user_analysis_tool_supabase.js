// User Analysis Tool - Supabase Version
// Extends UserAnalysisTool to use Supabase instead of GitHub Actions
// Keeps original user_analysis_tool.js intact for backward compatibility
//
// Version: 2025-12-04-v7
// - Fixed Copy Conversion Paths tab ID conflicts with Top Behavioral Drivers
// - Copy Conversion Paths now uses unique IDs: conversion-portfolios-behavioral-tab, conversion-creators-behavioral-tab
// - Tab data attributes: data-behavioral-tab="conversion-portfolios" and data-behavioral-tab="conversion-creators"
// - This fixes the issue where Copy Conversion Paths data wasn't rendering (was going into wrong tabs due to duplicate IDs)

'use strict';

// ============================================================================
// DOM Helper Functions - Performance Optimizations
// ============================================================================
// These functions use DocumentFragment and DOM APIs instead of innerHTML
// to improve performance by reducing reflows and repaints

/**
 * Create a DOM element with properties and children
 * @param {string} tag - HTML tag name
 * @param {object} props - Element properties (className, id, style, etc.)
 * @param {Array|string|Node} children - Child elements or text content
 * @returns {HTMLElement}
 */
function createElement(tag, props = {}, children = []) {
    const element = document.createElement(tag);

    // Set properties
    Object.entries(props).forEach(([key, value]) => {
        if (key === 'className') {
            element.className = value;
        } else if (key === 'style' && typeof value === 'object') {
            Object.assign(element.style, value);
        } else if (key === 'dataset' && typeof value === 'object') {
            Object.entries(value).forEach(([dataKey, dataValue]) => {
                element.dataset[dataKey] = dataValue;
            });
        } else if (key.startsWith('on') && typeof value === 'function') {
            element.addEventListener(key.substring(2).toLowerCase(), value);
        } else {
            element.setAttribute(key, value);
        }
    });

    // Add children
    if (typeof children === 'string') {
        element.textContent = children;
    } else if (children instanceof Node) {
        element.appendChild(children);
    } else if (Array.isArray(children)) {
        children.forEach(child => {
            if (typeof child === 'string') {
                element.appendChild(document.createTextNode(child));
            } else if (child instanceof Node) {
                element.appendChild(child);
            }
        });
    }

    return element;
}

/**
 * Create a DocumentFragment from multiple elements
 * @param {Array<Node>} elements - Array of DOM nodes
 * @returns {DocumentFragment}
 */
function createFragment(elements = []) {
    const fragment = document.createDocumentFragment();
    elements.forEach(element => {
        if (element instanceof Node) {
            fragment.appendChild(element);
        }
    });
    return fragment;
}

/**
 * Efficiently replace container contents with new elements
 * @param {HTMLElement} container - Target container
 * @param {Array<Node>|Node|DocumentFragment} content - New content
 */
function replaceContent(container, content) {
    // Clear existing content
    container.textContent = '';

    // Add new content
    if (content instanceof DocumentFragment || content instanceof Node) {
        container.appendChild(content);
    } else if (Array.isArray(content)) {
        const fragment = createFragment(content);
        container.appendChild(fragment);
    }
}

/**
 * Supabase-powered version of UserAnalysisTool
 * Overrides specific methods to use Supabase Edge Functions and database
 */
class UserAnalysisToolSupabase extends UserAnalysisTool {
    // Cache version - increment when cached HTML structure changes
    static CACHE_VERSION = 26; // Auto-hide progress bar after completion

    constructor() {
        super();
        this.supabaseIntegration = null;
    }

    /**
     * Override: Create UI with Supabase-specific configuration
     */
    createUI(container, outputContainers) {
        // Check if Supabase is already initialized globally
        if (window.supabaseIntegration) {
            this.supabaseIntegration = window.supabaseIntegration;
        }

        // Store output containers for each tab
        this.outputContainers = outputContainers;

        // Note: Cache restoration and stale flag handling is now managed centrally in index.html
        // This ensures all tabs restore consistently and refresh together when needed

        // Call parent to create base UI (just the data source selection)
        super.createUI(container, null);
    }

    /**
     * Save user analysis HTML to unified cache
     */
    saveToUnifiedCache() {
        try {
            const cached = localStorage.getItem('dubAnalysisResults');
            const data = cached ? JSON.parse(cached) : {};

            // Update summary and portfolio tabs in unified cache
            data.summary = this.outputContainers.summary?.innerHTML || '';
            data.portfolio = this.outputContainers.portfolio?.innerHTML || '';
            // Don't update timestamp here - it should only be updated during actual sync operations
            // The timestamp reflects when data was last synced from source, not when cache was saved

            localStorage.setItem('dubAnalysisResults', JSON.stringify(data));
            console.log('✅ Saved user analysis to unified cache');
        } catch (e) {
            console.warn('Failed to save user analysis to unified cache:', e);
        }
    }

    /**
     * Override: Restore cached analysis results for all tabs
     */
    restoreAnalysisResults() {
        try {
            const saved = localStorage.getItem('dubAnalysisResults');
            if (saved) {
                const data = JSON.parse(saved);
                if (this.outputContainers) {
                    // Restore cached HTML to each tab (if available and container exists)
                    if (data.summary && this.outputContainers.summary) {
                        this.outputContainers.summary.innerHTML = data.summary;
                        this.removeAnchorLinks(this.outputContainers.summary);
                    }
                    if (data.portfolio && this.outputContainers.portfolio) {
                        this.outputContainers.portfolio.innerHTML = data.portfolio;
                        this.removeAnchorLinks(this.outputContainers.portfolio);
                        // Re-initialize nested tab event listeners for portfolio
                        this.initializePortfolioNestedTabs();
                    }

                    console.log('✅ Restored analysis results from', data.timestamp);
                }
            }
        } catch (e) {
            console.warn('Failed to restore analysis results from localStorage:', e);
        }
    }

    /**
     * Remove anchor link icons from cached HTML
     */
    removeAnchorLinks(container) {
        if (!container) return;
        const anchorIcons = container.querySelectorAll('.anchor-icon');
        anchorIcons.forEach(icon => icon.remove());
    }

    /**
     * Initialize nested tab event listeners for Portfolio Analysis tab
     * Called after restoring cached content or after fresh render
     */
    initializePortfolioNestedTabs() {
        const portfolioContentSection = this.outputContainers.portfolio;
        if (!portfolioContentSection) return;

        // Initialize behavioral tab switching
        const behavioralTabButtons = portfolioContentSection.querySelectorAll('.behavioral-tab-btn');
        const behavioralTabPanes = portfolioContentSection.querySelectorAll('.behavioral-tab-pane');

        console.log('Initializing behavioral tabs:', behavioralTabButtons.length);

        behavioralTabButtons.forEach((button) => {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                const targetTab = button.getAttribute('data-behavioral-tab');
                console.log('Behavioral tab clicked:', targetTab);

                // Remove active class from all buttons and panes
                behavioralTabButtons.forEach(btn => btn.classList.remove('active'));
                behavioralTabPanes.forEach(pane => pane.classList.remove('active'));

                // Add active class to clicked button and corresponding pane
                button.classList.add('active');
                const targetPane = portfolioContentSection.querySelector(`#${targetTab}-behavioral-tab`);
                if (targetPane) {
                    targetPane.classList.add('active');
                }
            });
        });

        // Initialize conversion paths tab switching
        const conversionPathsTabButtons = portfolioContentSection.querySelectorAll('.conversion-paths-tab-btn');
        const conversionPathsTabPanes = portfolioContentSection.querySelectorAll('.conversion-paths-tab-pane');

        console.log('Initializing conversion paths tabs:', conversionPathsTabButtons.length);

        conversionPathsTabButtons.forEach((button) => {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                const targetTab = button.getAttribute('data-conversion-paths-tab');
                console.log('Conversion paths tab clicked:', targetTab);

                // Remove active class from all buttons and panes in this section only
                conversionPathsTabButtons.forEach(btn => btn.classList.remove('active'));
                conversionPathsTabPanes.forEach(pane => pane.classList.remove('active'));

                // Add active class to clicked button and corresponding pane
                button.classList.add('active');
                const targetPane = portfolioContentSection.querySelector(`#conversion-${targetTab}-tab`);
                if (targetPane) {
                    targetPane.classList.add('active');
                }
            });
        });

        // Initialize combinations tab switching
        const combinationsTabButtons = portfolioContentSection.querySelectorAll('.combinations-tab-btn');
        const combinationsTabPanes = portfolioContentSection.querySelectorAll('.combinations-tab-pane');

        console.log('Initializing combinations tabs:', combinationsTabButtons.length);

        combinationsTabButtons.forEach((button) => {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                const targetTab = button.getAttribute('data-combinations-tab');
                console.log('Combinations tab clicked:', targetTab);

                // Remove active class from all buttons and panes
                combinationsTabButtons.forEach(btn => btn.classList.remove('active'));
                combinationsTabPanes.forEach(pane => pane.classList.remove('active'));

                // Add active class to clicked button and corresponding pane
                button.classList.add('active');
                const targetPane = portfolioContentSection.querySelector(`#${targetTab}-combinations-tab`);
                if (targetPane) {
                    targetPane.classList.add('active');
                }
            });
        });
    }

    /**
     * Override: Create data source section - Only show "Sync Live Data" button (hide "Manually Upload Data")
     */
    createDataSourceSection() {
        const section = document.createElement('div');
        section.style.cssText = 'margin-bottom: 20px;';

        const title = document.createElement('h4');
        title.textContent = 'Select Data Source';
        title.style.cssText = 'margin: 0 0 15px 0; color: #333;';
        section.appendChild(title);

        // Mode buttons container
        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = 'display: flex; gap: 15px; margin-bottom: 20px; flex-wrap: wrap; justify-content: center;';

        // "Sync Live Data" button
        const githubBtn = this.createModeButton(
            'Sync Live Data',
            'Fetch the latest data from Mixpanel',
            '#28a745',
            '#28a745',
            () => this.runWorkflow('github')
        );
        buttonContainer.appendChild(githubBtn);

        // "Manually Upload Data" button
        // Note: The actual click handler is overridden in index.html to call showMarketingUploadModal()
        // which handles Public Portfolios Data and Total Investments Data uploads
        const uploadBtn = this.createModeButton(
            'Manually Upload Data',
            'Upload CSV files for analysis',
            '#dee2e6',
            '#6c757d',
            () => console.log('Upload button clicked - should be overridden by index.html')
        );
        buttonContainer.appendChild(uploadBtn);

        section.appendChild(buttonContainer);

        return section;
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

        console.log('🔄 Sync Live Data: Starting workflow...');

        try {
            // Step 1: Sync user data (Mixpanel) - 30%
            this.updateProgress(30, 'Step 1/5: Syncing user data...');
            console.log('\n═══ Step 1: User Data (Mixpanel) ═══');
            const userResult = await this.supabaseIntegration.triggerMixpanelSync();

            // Step 2: Sync creator data - 40%
            this.updateProgress(40, 'Step 2/5: Syncing creator data...');
            console.log('\n═══ Step 2: Creator Data ═══');
            let creatorResult = null;
            try {
                creatorResult = await this.supabaseIntegration.triggerCreatorSync();
                console.log('✅ Creator Sync: Complete');
            } catch (error) {
                console.warn('⚠ Creator Sync: Failed, continuing with existing data');
            }

            // Step 3: Support analysis workflow (Zendesk + Linear) - 60%
            this.updateProgress(60, 'Step 3/5: Checking support data...');
            console.log('\n═══ Step 3: Support Analysis (Zendesk + Linear) ═══');

            // Check if support_analysis was already completed in the past 24 hours
            // If so, skip entire workflow (sync, analysis, and mapping)
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
            console.log(`Checking for recent support_analysis since: ${oneDayAgo}`);

            const { data: recentAnalysis, error: analysisCheckError } = await this.supabaseIntegration.supabase
                .from('sync_logs')
                .select('id, sync_completed_at, sync_status, source')
                .eq('source', 'support_analysis')
                .eq('sync_status', 'completed')
                .gte('sync_completed_at', oneDayAgo)
                .order('sync_completed_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (analysisCheckError) {
                console.warn('⚠ Error checking for recent analysis:', analysisCheckError);
            }

            console.log('Recent analysis query result:', recentAnalysis);

            if (recentAnalysis) {
                console.log(`✓ Support analysis already completed in past 24 hours at ${recentAnalysis.sync_completed_at}`);
                console.log('Skipping Step 3 workflow (recent data exists)');
            } else {
                console.log('No recent analysis found - running full workflow');

                try {
                    const supportResult = await this.supabaseIntegration.triggerSupportAnalysis();
                    console.log('✅ Support Data Sync: Complete');

                    // Step 3a: Analyze support feedback
                    console.log('→ 3a: Analyzing support feedback with Claude AI');
                    let analysisSucceeded = false;
                    try {
                        const analysisResult = await this.supabaseIntegration.supabase.functions.invoke('analyze-support-feedback', { body: {} });

                        if (analysisResult.error) {
                            console.warn('  ⚠ 3a: Analysis failed, continuing');
                        } else {
                            console.log('  ✓ 3a: Analysis complete');
                            analysisSucceeded = analysisResult.data?.success !== false;
                        }
                    } catch (analysisError) {
                        console.warn('  ⚠ 3a: Network error, will attempt Linear mapping');
                        analysisSucceeded = true;
                    }

                    // Step 3b: Map Linear issues to feedback
                    console.log('→ 3b: Mapping Linear issues to feedback');
                    try {
                        const mappingResult = await this.supabaseIntegration.supabase.functions.invoke('map-linear-to-feedback', { body: {} });
                        if (mappingResult.error) {
                            console.warn('  ⚠ 3b: Linear mapping failed');
                        } else {
                            console.log('  ✓ 3b: Linear mapping complete');
                        }
                    } catch (mappingError) {
                        console.warn('  ⚠ 3b: Linear mapping exception');
                    }

                    console.log('✅ Support Analysis: Complete');
                } catch (error) {
                    console.warn('⚠ Support Analysis: Workflow failed, continuing');
                }
            }

            // Step 4: Refresh materialized views - 70%
            this.updateProgress(70, 'Step 4/5: Refreshing views...');
            console.log('\n═══ Step 4: Refresh Materialized Views ═══');
            console.log('Refreshing:');
            console.log('  1. main_analysis');
            console.log('  2. portfolio_creator_engagement_metrics');
            console.log('  3. enriched_support_conversations');
            console.log('');
            console.log('Auto-updating regular views:');
            console.log('  - copy_engagement_summary');
            console.log('  - hidden_gems_portfolios');

            try {
                const refreshResult = await this.supabaseIntegration.triggerMaterializedViewsRefresh();
                if (refreshResult?.success) {
                    console.log('✅ All materialized views refreshed');
                } else {
                    console.warn('⚠ Materialized views refresh failed, continuing');
                }
            } catch (error) {
                console.warn('⚠ Materialized views refresh failed, continuing');
            }

            // Step 5: Run analysis workflows in parallel - 90%
            this.updateProgress(90, 'Step 5/5: Running analysis...');
            console.log('\n═══ Step 5: Analysis Workflows (Parallel) ═══');

            await Promise.allSettled([
                // Behavioral drivers analysis
                (async () => {
                    console.log('→ 5a: Behavioral Drivers (starting in parallel)');
                    try {
                        const { data, error } = await this.supabaseIntegration.supabase.functions.invoke('analyze-behavioral-drivers', { body: {} });
                        if (error) {
                            console.warn('⚠ 5a: Behavioral Drivers - Failed:', error.message);
                        } else if (data?.success) {
                            console.log('✅ 5a: Behavioral Drivers - Complete');
                            console.log(`   - ${data.stats?.deposit_drivers_count || 0} deposit drivers`);
                            console.log(`   - ${data.stats?.copy_drivers_count || 0} copy drivers`);
                            console.log(`   - ${data.stats?.subscription_drivers_count || 0} subscription drivers`);
                        } else {
                            console.warn('⚠ 5a: Behavioral Drivers - Failed');
                        }
                        return { success: data?.success };
                    } catch (error) {
                        console.warn('⚠ 5a: Behavioral Drivers - Failed, continuing');
                        return { success: false, error: error.message };
                    }
                })(),

                // Summary stats analysis
                (async () => {
                    console.log('→ 5b: Summary Stats (starting in parallel)');
                    try {
                        const { data, error } = await this.supabaseIntegration.supabase.functions.invoke('analyze-summary-stats', { body: {} });
                        if (error) {
                            console.warn('⚠ 5b: Summary Stats - Failed:', error.message);
                        } else if (data?.success) {
                            console.log('✅ 5b: Summary Stats - Complete');
                            console.log(`   - ${data.stats?.total_users || 0} total users analyzed`);
                            console.log(`   - Link bank: ${data.stats?.link_bank_conversion?.toFixed(2) || 0}%`);
                            console.log(`   - Copy: ${data.stats?.first_copy_conversion?.toFixed(2) || 0}%`);
                        } else {
                            console.warn('⚠ 5b: Summary Stats - Failed');
                        }
                        return { success: data?.success };
                    } catch (error) {
                        console.warn('⚠ 5b: Summary Stats - Failed, continuing');
                        return { success: false, error: error.message };
                    }
                })(),
                // Event sequence workflow (Portfolio + Creator + Subscriptions - 3 steps: Sync first events → Sync sequences → Analyze sequences)
                (async () => {
                    console.log('→ 5c: Event Sequences (Portfolio + Creator + Subscriptions)');
                    try {
                        // Step 1: Sync first copy users AND first subscription users in parallel
                        console.log('  → Step 1: Syncing first copy users + first subscription users (parallel)');
                        const [firstCopyResult, firstSubscriptionResult] = await Promise.all([
                            (async () => {
                                try {
                                    const result = await this.supabaseIntegration.triggerFirstCopyUsersSync();
                                    if (result?.success) {
                                        console.log(`    ✓ First copy users: ${result.stats?.usersSynced || 0} users synced`);
                                    } else {
                                        console.warn('    ⚠ First copy sync failed, will use existing data');
                                    }
                                    return result;
                                } catch (error) {
                                    console.warn('    ⚠ First copy sync error, will use existing data:', error.message);
                                    return { success: false, error: error.message };
                                }
                            })(),
                            (async () => {
                                try {
                                    const result = await this.supabaseIntegration.triggerFirstSubscriptionUsersSync();
                                    if (result?.success) {
                                        console.log(`    ✓ First subscription users: ${result.stats?.total_users || 0} users synced`);
                                    } else {
                                        console.warn('    ⚠ First subscription sync failed, will use existing data');
                                    }
                                    return result;
                                } catch (error) {
                                    console.warn('    ⚠ First subscription sync error, will use existing data:', error.message);
                                    return { success: false, error: error.message };
                                }
                            })()
                        ]);

                        // Step 2: Sync both portfolio and creator events in parallel (after first copies)
                        console.log('  → Step 2: Syncing portfolio views + creator profile views (parallel)');
                        const [portfolioSyncResult, creatorSyncResult] = await Promise.all([
                            this.supabaseIntegration.triggerPortfolioSequencesSync(),
                            this.supabaseIntegration.triggerCreatorSequencesSync()
                        ]);

                        if (portfolioSyncResult?.success) {
                            console.log(`    ✓ Portfolio: Synced ${portfolioSyncResult.stats?.eventsInserted || 0} views`);
                        } else {
                            console.warn('    ⚠ Portfolio sync failed, using existing data');
                        }

                        if (creatorSyncResult?.success) {
                            console.log(`    ✓ Creator: Synced ${creatorSyncResult.stats?.eventsInserted || 0} profile views`);
                        } else {
                            console.warn('    ⚠ Creator sync failed, using existing data');
                        }

                        // Step 3: Analyze portfolio, creator, subscription, and unified copy patterns in parallel (only after syncs complete)
                        console.log('  → Step 3: Analyzing portfolio + creator + subscription + unified copy patterns with SQL (parallel)');
                        const [portfolioAnalysisResult, creatorAnalysisResult, subscriptionAnalysisResult, copyAnalysisResult] = await Promise.all([
                            this.supabaseIntegration.triggerPortfolioSequencesAnalysis('copies'),
                            this.supabaseIntegration.triggerCreatorSequencesAnalysis('copies'),
                            (async () => {
                                try {
                                    const result = await this.supabaseIntegration.triggerSubscriptionSequencesAnalysis();
                                    if (result?.success) {
                                        console.log('    ✓ Subscription analysis complete');
                                    } else {
                                        console.warn('    ⚠ Subscription analysis failed');
                                    }
                                    return result;
                                } catch (error) {
                                    console.warn('    ⚠ Subscription analysis error:', error.message);
                                    return { success: false, error: error.message };
                                }
                            })(),
                            (async () => {
                                try {
                                    const result = await this.supabaseIntegration.triggerCopySequencesAnalysis();
                                    if (result?.success) {
                                        console.log('    ✓ Unified copy analysis complete');
                                    } else {
                                        console.warn('    ⚠ Unified copy analysis failed');
                                    }
                                    return result;
                                } catch (error) {
                                    console.warn('    ⚠ Unified copy analysis error:', error.message);
                                    return { success: false, error: error.message };
                                }
                            })()
                        ]);

                        if (portfolioAnalysisResult?.success) {
                            console.log('    ✓ Portfolio analysis complete');
                        } else {
                            console.warn('    ⚠ Portfolio analysis failed');
                        }

                        if (creatorAnalysisResult?.success) {
                            console.log('    ✓ Creator analysis complete');
                        } else {
                            console.warn('    ⚠ Creator analysis failed');
                        }

                        if (copyAnalysisResult?.success) {
                            console.log('    ✓ Unified copy analysis complete');
                        } else {
                            console.warn('    ⚠ Unified copy analysis failed');
                        }

                        console.log('✅ 5c: Event Sequences (Portfolio + Creator + Subscriptions + Unified Copy) - Complete');
                        return { success: true };
                    } catch (error) {
                        console.warn('⚠ 5c: Event Sequences - Failed, continuing');
                        return { success: false, error: error.message };
                    }
                })(),

                // Subscription price analysis
                (async () => {
                    console.log('→ 5d: Subscription Pricing (starting in parallel)');
                    try {
                        const priceResult = await this.supabaseIntegration.triggerSubscriptionPriceAnalysis();
                        if (priceResult?.success) {
                            console.log('✅ 5d: Subscription Pricing - Complete');
                        } else {
                            console.warn('⚠ 5d: Subscription Pricing - Failed');
                        }
                        return priceResult;
                    } catch (error) {
                        console.warn('⚠ 5d: Subscription Pricing - Failed, continuing');
                        return { success: false, error: error.message };
                    }
                })(),

                // Copy pattern analysis - DISABLED (replaced by Portfolio Combinations in Copy Conversion Paths)
                // (async () => {
                //     console.log('→ 5e: Copy Pattern Analysis (starting in parallel)');
                //     try {
                //         const copyResult = await this.supabaseIntegration.triggerCopyAnalysis();
                //         if (copyResult?.success) {
                //             console.log('✅ 5e: Copy Pattern Analysis - Complete');
                //         } else {
                //             console.warn('⚠ 5e: Copy Pattern Analysis - Failed');
                //         }
                //         return copyResult;
                //     } catch (error) {
                //         console.warn('⚠ 5e: Copy Pattern Analysis - Failed, continuing');
                //         return { success: false, error: error.message };
                //     }
                // })()
                // Return resolved promise to maintain Promise.all structure
                Promise.resolve({ success: true, skipped: true, reason: 'Replaced by Portfolio Combinations analysis' })
            ]);

            // Log parallel completion
            console.log('\n✅ All analysis workflows completed');
        } catch (error) {
            console.error('❌ Workflow failed:', error);
            throw error;
        }

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

        // Load from Supabase database (returns CSV format for compatibility)
        const contents = await this.supabaseIntegration.loadDataFromSupabase();
        return contents;
    }

    /**
     * Reload UI from cache only (no database queries)
     * Used when refreshing after version updates - just reloads the cached UI
     */
    reloadUIFromCache() {
        // Reuse existing restore logic to avoid duplication
        this.restoreAnalysisResults();
    }

    async refreshFromDatabaseOnly() {
        try {
            console.log('🔄 Refreshing from database (no sync)...');

            // Clear query cache to ensure fresh data
            if (this.supabaseIntegration) {
                this.supabaseIntegration.invalidateCache();
                console.log('🗑️ Query cache cleared');
            }

            // Fetch and update Marketing Metrics
            await this.displayMarketingMetrics(true);

            // Display results from database (no client-side processing needed)
            await this.displayResultsFromDatabase();

            console.log('✅ Database refresh completed');
        } catch (error) {
            this.addStatusMessage(`❌ Error refreshing data: ${error.message}`, 'error');
            console.error('Database refresh error:', error);
            throw error;
        }
    }

    /**
     * Override: Run the GitHub workflow using Supabase
     * Syncs all data but does NOT refresh UI (UI refresh handled separately)
     */
    async runGitHubWorkflow() {
        // Trigger the sync workflow (progress updates happen inside triggerGitHubWorkflow)
        // This now includes analyze-summary-stats Edge Function call
        const triggered = await this.triggerGitHubWorkflow();
        if (!triggered) {
            throw new Error('Failed to trigger Supabase sync');
        }

        console.log('✅ All sync workflows completed');
    }

    /**
     * Display results from database (no client-side processing)
     * Fetches pre-calculated summary stats from Edge Function
     */
    async displayResultsFromDatabase() {
        // Step 1: Try to restore from cache FIRST (instant display)
        const cached = localStorage.getItem('dubAnalysisResults');
        if (cached) {
            try {
                const data = JSON.parse(cached);
                // Check cache version - invalidate if old version
                if (data.cacheVersion !== UserAnalysisToolSupabase.CACHE_VERSION) {
                    console.log('⚠️ Cache version mismatch, clearing old cache');
                    localStorage.removeItem('dubAnalysisResults');
                } else if (data.timestamp) {
                    // Restore cached HTML to each tab (if available)
                    if (data.summary) {
                        this.outputContainers.summary.innerHTML = data.summary;
                        this.removeAnchorLinks(this.outputContainers.summary);
                    }
                    if (data.portfolio) {
                        this.outputContainers.portfolio.innerHTML = data.portfolio;
                        this.removeAnchorLinks(this.outputContainers.portfolio);
                    }
                    if (data.subscription) {
                        this.outputContainers.subscription.innerHTML = data.subscription;
                        this.removeAnchorLinks(this.outputContainers.subscription);
                    }

                    const cacheAge = Math.floor((Date.now() - new Date(data.timestamp).getTime()) / 60000);
                    console.log(`✅ Restored complete analysis from cache (${cacheAge} min ago)`);
                    // Fall through to rebuild with fresh data
                }
            } catch (e) {
                console.warn('Failed to restore from cache, rebuilding:', e);
            }
        }

        // Step 2: Build complete HTML with data from database (modifies DOM directly)
        await this.buildCompleteHTMLFromDatabase();

        // Step 3: Cache complete rendered HTML for all tabs
        try {
            // Get existing cache to preserve timestamp
            const existingCache = localStorage.getItem('dubAnalysisResults');
            const existingData = existingCache ? JSON.parse(existingCache) : {};

            const cacheData = {
                summary: this.outputContainers.summary?.innerHTML || '',
                portfolio: this.outputContainers.portfolio?.innerHTML || '',
                subscription: this.outputContainers.subscription?.innerHTML || '',
                // Preserve existing timestamp - it should only be updated during actual sync operations
                timestamp: existingData.timestamp || new Date().toISOString(),
                cacheVersion: UserAnalysisToolSupabase.CACHE_VERSION
            };
            console.log('💾 Saving cache with timestamp:', cacheData.timestamp);
            localStorage.setItem('dubAnalysisResults', JSON.stringify(cacheData));
            console.log('✅ Cached complete analysis for all tabs');
        } catch (error) {
            console.error('❌ Failed to cache:', error);
        }
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
                // Check cache version - invalidate if old version
                if (data.cacheVersion !== UserAnalysisToolSupabase.CACHE_VERSION) {
                    console.log('⚠️ Cache version mismatch, clearing old cache');
                    localStorage.removeItem('dubAnalysisResults');
                } else if (data.timestamp) {
                    // Restore cached HTML to each tab (if available)
                    if (data.summary) {
                        this.outputContainers.summary.innerHTML = data.summary;
                        this.removeAnchorLinks(this.outputContainers.summary);
                    }
                    if (data.portfolio) {
                        this.outputContainers.portfolio.innerHTML = data.portfolio;
                        this.removeAnchorLinks(this.outputContainers.portfolio);
                    }
                    if (data.subscription) {
                        this.outputContainers.subscription.innerHTML = data.subscription;
                        this.removeAnchorLinks(this.outputContainers.subscription);
                    }
                    if (data.creator && this.outputContainers.creator) {
                        this.outputContainers.creator.innerHTML = data.creator;
                    }

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

        // Step 3: Cache complete rendered HTML for all tabs (user analysis only)
        try {
            // Get existing cache to preserve timestamp
            const existingCache = localStorage.getItem('dubAnalysisResults');
            const existingData = existingCache ? JSON.parse(existingCache) : {};

            const cacheData = {
                summary: this.outputContainers.summary?.innerHTML || '',
                portfolio: this.outputContainers.portfolio?.innerHTML || '',
                // Preserve existing timestamp - it should only be updated during actual sync operations
                timestamp: existingData.timestamp || new Date().toISOString(),
                cacheVersion: UserAnalysisToolSupabase.CACHE_VERSION
            };
            console.log('💾 Saving cache with timestamp:', cacheData.timestamp);
            localStorage.setItem('dubAnalysisResults', JSON.stringify(cacheData));
            console.log('✅ Cached complete analysis for all tabs');

            // Verify it was saved
            const saved = localStorage.getItem('dubAnalysisResults');
            const savedTimestamp = JSON.parse(saved).timestamp;
            console.log('✅ Verified cache saved with timestamp:', savedTimestamp);
        } catch (error) {
            console.error('❌ Failed to cache:', error);
        }
    }

    /**
     * Build complete HTML including all analysis sections
     * Now renders to separate main tab containers instead of nested tabs
     */
    async buildCompleteHTML(results) {
        // Load all engagement data in parallel with base analysis
        const [
            hiddenGems,
            copyEngagementSummary,
            subscriptionDistribution
        ] = await Promise.all([
            this.supabaseIntegration.loadHiddenGems().catch(e => { console.warn('Failed to load hidden gems:', e); return []; }),
            this.supabaseIntegration.loadCopyEngagementSummary().catch(e => { console.warn('Failed to load copy engagement summary:', e); return null; }),
            this.supabaseIntegration.loadSubscriptionDistribution().catch(e => { console.warn('Failed to load subscription distribution:', e); return []; })
        ]);

        // Data loaded successfully

        // Calculate hidden gems summary from hiddenGems array
        const hiddenGemsSummary = hiddenGems && hiddenGems.length > 0 ? {
            total_hidden_gems: hiddenGems.length,
            avg_pdp_views: Math.round(hiddenGems.reduce((sum, gem) => sum + (gem.total_pdp_views || 0), 0) / hiddenGems.length * 10) / 10,
            avg_conversion_rate: Math.round(hiddenGems.reduce((sum, gem) => sum + (gem.copy_conversion_rate || 0), 0) / hiddenGems.length * 100) / 100
        } : null;
        const subscriptionSequenceAnalysis = null; // Set to null since we're not loading it
        const topSequences = []; // Empty array for now

        // Store subscription distribution for caching
        this.cachedSubscriptionDistribution = subscriptionDistribution;

        // === SUMMARY TAB ===
        const summaryContainer = this.outputContainers.summary;
        summaryContainer.innerHTML = `
            <div class="qda-analysis-results">
                <div id="qdaSummaryStatsInline"></div>
                <div id="qdaMarketingMetricsInline"></div>
                <div id="qdaDemographicBreakdownInline"></div>
                <div id="qdaPersonaBreakdownInline"></div>
            </div>
        `;

        displaySummaryStatsInline(results.summaryStats);
        await this.displayMarketingMetrics();
        displayDemographicBreakdownInline(results.summaryStats);
        displayPersonaBreakdownInline(results.summaryStats);

        // === PORTFOLIO TAB ===
        const portfolioContainer = this.outputContainers.portfolio;
        portfolioContainer.innerHTML = `
            <div class="qda-analysis-results">
                <div id="portfolioContentSection"></div>
            </div>
        `;

        // Build Portfolio Content Section
        const portfolioContentSection = document.getElementById('portfolioContentSection');

        // Check if we have summary stats (indicating analysis was run)
        if (results.summaryStats) {
            // Build all HTML sections first
            const metricsHTML = this.generateCopyMetricsHTML(copyEngagementSummary);
            const hiddenGemsHTML = this.generateHiddenGemsHTML(hiddenGemsSummary, hiddenGems);

            // Build complete HTML structure with H1 in same section as metrics
            let portfolioHTML = `
                <div class="qda-result-section">
                    <div style="margin-bottom: 0.25rem;">
                        <h1 style="margin: 0;"><span class="info-tooltip">Behavior Analysis<span class="info-icon">i</span>
                            <span class="tooltip-text">
                                <strong>Behavior Analysis</strong>
                                User behavior patterns, engagement metrics, and conversion analysis across the platform.
                                <ul>
                                    <li><strong>Data Sources:</strong>
                                        <a href="https://mixpanel.com/project/2599235/view/3138115/app/boards#id=10576025&editor-card-id=%22report-85713544%22" target="_blank" style="color: #17a2b8;">Chart 85713544</a> (User Event Metrics),
                                        <a href="https://mixpanel.com/project/2599235/view/3138115/app/boards#id=10576025&editor-card-id=%22report-85165580%22" target="_blank" style="color: #17a2b8;">Chart 85165580</a> (Engagement: PDP Views, Copies, Liquidations),
                                        <a href="https://mixpanel.com/project/2599235/view/3138115/app/boards#id=10576025&editor-card-id=%22report-85165851%22" target="_blank" style="color: #17a2b8;">Chart 85165851</a> (Profile Views)
                                    </li>
                                    <li><strong>Analyses:</strong> Behavioral drivers, high-impact combinations, hidden gems, pattern sequences</li>
                                </ul>
                            </span>
                        </span></h1>
                    </div>
                    ${metricsHTML}
                    ${hiddenGemsHTML}
                </div>
            `;

            // Add Top Behavioral Drivers Section with nested tabs
            portfolioHTML += `
                <div class="qda-result-section" style="margin-top: 3rem;">
                    <h2 style="margin-bottom: 0.5rem;"><span class="info-tooltip">Top Behavioral Drivers<span class="info-icon">i</span>
                <span class="tooltip-text">
                    <strong>Top Behavioral Drivers</strong>
                    Statistical analysis showing which user behaviors best predict deposits, copies, and subscriptions.
                    <ul>
                        <li><strong>Data Sources:</strong>
                            <a href="https://mixpanel.com/project/2599235/view/3138115/app/boards#id=10576025&editor-card-id=%22report-85713544%22" target="_blank" style="color: #17a2b8;">Chart 85713544</a> (Deposits/Copies),
                            <a href="https://mixpanel.com/project/2599235/view/3138115/app/boards#id=10576025&editor-card-id=%22report-85165590%22" target="_blank" style="color: #17a2b8;">Chart 85165590</a> (Subscriptions)
                        </li>
                        <li><strong>Analysis:</strong> Correlation + Logistic Regression</li>
                        <li><strong>Metrics:</strong> Correlation coefficient, t-statistic, predictive strength, tipping point</li>
                    </ul>
                </span>
            </span></h2>
                    <p style="color: #6c757d; font-size: 0.9rem; margin-bottom: 1.5rem;">Top events that are the strong predictors of deposits, copies, and subscriptions</p>

                    <div class="behavioral-tabs-container">
                        <div class="behavioral-tab-navigation">
                            <button class="behavioral-tab-btn active" data-behavioral-tab="deposits">Deposit Funds</button>
                            <button class="behavioral-tab-btn" data-behavioral-tab="copies">Copy Portfolios</button>
                            <button class="behavioral-tab-btn" data-behavioral-tab="subscriptions">Subscriptions</button>
                        </div>

                        <div class="behavioral-tab-content">
                            <div id="deposits-behavioral-tab" class="behavioral-tab-pane active">
                                <!-- Deposit Funds content will be inserted here -->
                            </div>
                            <div id="copies-behavioral-tab" class="behavioral-tab-pane">
                                <!-- Copy Portfolios content will be inserted here -->
                            </div>
                            <div id="subscriptions-behavioral-tab" class="behavioral-tab-pane">
                                <!-- Subscriptions content will be inserted here -->
                            </div>
                        </div>
                    </div>
                </div>
            `;

            // Insert complete HTML once
            portfolioContentSection.innerHTML = portfolioHTML;

            // Now populate the behavioral tabs
            const depositsTabPane = document.getElementById('deposits-behavioral-tab');
            const copiesTabPane = document.getElementById('copies-behavioral-tab');

            // Add Deposit Funds Table (load from database)
            await this.displayTopDepositDrivers();

            // Add Top Portfolio Copy Drivers Table (load from database)
            await this.displayTopCopyDrivers();

            // Initialize nested tab event listeners using shared function
            this.initializePortfolioNestedTabs();

            // Display Top Subscription Drivers section (load from database)
            await this.displayTopSubscriptionDrivers();
        } else {
            // Even without copies data, create minimal structure for subscription drivers
            portfolioContentSection.innerHTML = `
                <div class="qda-result-section">
                    <p style="color: #6c757d; font-style: italic;">Portfolio analysis data will be available after syncing.</p>
                </div>
                <div class="qda-result-section" style="margin-top: 3rem;">
                    <h2>Top Behavioral Drivers</h2>
                    <div class="behavioral-tabs-container">
                        <div class="behavioral-tab-navigation">
                            <button class="behavioral-tab-btn active" data-behavioral-tab="subscriptions">Subscriptions</button>
                        </div>
                        <div class="behavioral-tab-content">
                            <div id="subscriptions-behavioral-tab" class="behavioral-tab-pane active">
                                <!-- Subscriptions content will be inserted here -->
                            </div>
                        </div>
                    </div>
                </div>
            `;

            // Display Top Subscription Drivers section (load from database)
            await this.displayTopSubscriptionDrivers();
        }

        // Add timestamp and data scope to remaining tabs (summary, portfolio)
        // Each tab uses its own specific data source from sync_logs

        // Summary Stats tab: uses mixpanel_user_properties_v2
        const summaryResultsDiv = summaryContainer.querySelector('.qda-analysis-results');
        if (summaryResultsDiv) {
            // Add timestamp using shared utility
            await window.addTimestampToResults(summaryResultsDiv, 'mixpanel_user_properties_v2', window.supabaseIntegration);

            // Add data scope text (top left)
            const summaryDataScope = document.createElement('div');
            summaryDataScope.className = 'qda-data-scope';
            summaryDataScope.textContent = 'All KYC approved users since 8/27';
            summaryResultsDiv.insertBefore(summaryDataScope, summaryResultsDiv.firstChild);
        }

        // Behavior Analysis tab: uses most recent of mixpanel_creator_sequences or mixpanel_portfolio_sequences
        const portfolioResultsDiv = portfolioContainer.querySelector('.qda-analysis-results');
        if (portfolioResultsDiv) {
            // Add timestamp using shared utility (array of sources)
            await window.addTimestampToResults(
                portfolioResultsDiv,
                ['mixpanel_creator_sequences', 'mixpanel_portfolio_sequences'],
                window.supabaseIntegration
            );

            // Add data scope text (top left)
            const portfolioDataScope = document.createElement('div');
            portfolioDataScope.className = 'qda-data-scope';
            portfolioDataScope.textContent = 'All KYC approved users since 8/27';
            portfolioResultsDiv.insertBefore(portfolioDataScope, portfolioResultsDiv.firstChild);
        }

        // Anchor links removed - using only tab anchors for simplicity
    }

    /**
     * Build complete HTML from database (no client-side processing)
     * Fetches pre-calculated summary stats from database table
     */
    async buildCompleteHTMLFromDatabase() {
        // Step 1: Fetch summary stats from database
        const { data: summaryStatsRows, error: statsError } = await this.supabaseIntegration.supabase
            .from('summary_stats')
            .select('stats_data, calculated_at')
            .order('calculated_at', { ascending: false })
            .limit(1);

        if (statsError) {
            console.error('Failed to load summary stats:', statsError);
            throw statsError;
        }

        if (!summaryStatsRows || summaryStatsRows.length === 0) {
            console.error('No summary stats found in database');
            throw new Error('Summary stats not calculated yet. Please run Sync Live Data first.');
        }

        const summaryStats = summaryStatsRows[0].stats_data;
        console.log('✅ Loaded summary stats from database');

        // Step 2: Load all other engagement data in parallel
        const [
            hiddenGems,
            copyEngagementSummary,
            subscriptionDistribution
        ] = await Promise.all([
            this.supabaseIntegration.loadHiddenGems().catch(e => { console.warn('Failed to load hidden gems:', e); return []; }),
            this.supabaseIntegration.loadCopyEngagementSummary().catch(e => { console.warn('Failed to load copy engagement summary:', e); return null; }),
            this.supabaseIntegration.loadSubscriptionDistribution().catch(e => { console.warn('Failed to load subscription distribution:', e); return []; })
        ]);

        // Calculate hidden gems summary
        const hiddenGemsSummary = hiddenGems && hiddenGems.length > 0 ? {
            total_hidden_gems: hiddenGems.length,
            avg_pdp_views: Math.round(hiddenGems.reduce((sum, gem) => sum + (gem.total_pdp_views || 0), 0) / hiddenGems.length * 10) / 10,
            avg_conversion_rate: Math.round(hiddenGems.reduce((sum, gem) => sum + (gem.copy_conversion_rate || 0), 0) / hiddenGems.length * 100) / 100
        } : null;

        // Store subscription distribution for caching
        this.cachedSubscriptionDistribution = subscriptionDistribution;

        // === SUMMARY TAB ===
        const summaryContainer = this.outputContainers.summary;
        summaryContainer.innerHTML = `
            <div class="qda-analysis-results">
                <div id="qdaSummaryStatsInline"></div>
                <div id="qdaMarketingMetricsInline"></div>
                <div id="qdaDemographicBreakdownInline"></div>
                <div id="qdaPersonaBreakdownInline"></div>
            </div>
        `;

        displaySummaryStatsInline(summaryStats);
        await this.displayMarketingMetrics();
        displayDemographicBreakdownInline(summaryStats);
        displayPersonaBreakdownInline(summaryStats);

        // === PORTFOLIO TAB ===
        const portfolioContainer = this.outputContainers.portfolio;
        portfolioContainer.innerHTML = `
            <div class="qda-analysis-results">
                <div id="portfolioContentSection"></div>
            </div>
        `;

        // Build Portfolio Content Section
        const portfolioContentSection = document.getElementById('portfolioContentSection');

        // Load portfolio copy path analysis
        const portfolioCopyPaths = await this.supabaseIntegration.loadPortfolioCopyPaths().catch(e => {
            console.warn('Failed to load portfolio copy paths:', e);
            return null;
        });

        // Load creator copy path analysis
        const creatorCopyPaths = await this.supabaseIntegration.loadCreatorCopyPaths().catch(e => {
            console.warn('Failed to load creator copy paths:', e);
            return null;
        });

        // Load unified copy path analysis (combines creator + portfolio views)
        const unifiedCopyPaths = await this.supabaseIntegration.loadUnifiedCopyPaths().catch(e => {
            console.warn('Failed to load unified copy paths:', e);
            return null;
        });

        // Build all HTML sections
        const metricsHTML = this.generateCopyMetricsHTML(copyEngagementSummary);
        const hiddenGemsHTML = this.generateHiddenGemsHTML(hiddenGemsSummary, hiddenGems);

        // Build complete HTML structure
        let portfolioHTML = `
            <div class="qda-result-section">
                <div style="margin-bottom: 0.25rem;">
                    <h1 style="margin: 0;"><span class="info-tooltip">Behavior Analysis<span class="info-icon">i</span>
                        <span class="tooltip-text">
                            <strong>Behavior Analysis</strong>
                            User behavior patterns, engagement metrics, and conversion analysis across the platform.
                        </span>
                    </span></h1>
                </div>
                ${metricsHTML}
            </div>
        `;

        // Add Copy Conversion Paths Section with nested tabs (Overall, Portfolios & Creators)
        if (portfolioCopyPaths || creatorCopyPaths || unifiedCopyPaths) {
            portfolioHTML += this.generateCopyConversionPathsHTML(portfolioCopyPaths, creatorCopyPaths, unifiedCopyPaths);
        }

        // Add Hidden Gems section
        portfolioHTML += `<div class="qda-result-section">${hiddenGemsHTML}</div>`;

        /* ====================================================================================
         * HIGH-IMPACT COMBINATIONS SECTION - COMMENTED OUT
         * Replaced by Copy Conversion Path Analysis (portfolio_copy_path_analysis + creator_copy_path_analysis)
         * ====================================================================================
         *
         * // Add High-Impact Combinations Section with tabs structure
         * portfolioHTML += `
         *     <div class="qda-result-section" style="margin-top: 3rem;">
         *         <h2 style="margin-bottom: 0.25rem;"><span class="info-tooltip">High-Impact Combinations<span class="info-icon">i</span>
         *     <span class="tooltip-text">
         *         <strong>High-Impact Combinations</strong>
         *         Portfolio and creator pairs that users view together before copying, with highest conversion lift.
         *         <ul>
         *             <li><strong>Data Sources:</strong>
         *                 <a href="https://mixpanel.com/project/2599235/view/3138115/app/boards#id=10576025&editor-card-id=%22report-85165580%22" target="_blank" style="color: #17a2b8;">Chart 85165580</a> (Copies),
         *                 <a href="https://mixpanel.com/project/2599235/view/3138115/app/boards#id=10576025&editor-card-id=%22report-85165851%22" target="_blank" style="color: #17a2b8;">Chart 85165851</a> (Views)
         *             </li>
         *             <li><strong>Analysis:</strong> Exhaustive pair search + Logistic Regression (max 200 entities = ~19,900 pairs tested)</li>
         *             <li><strong>Filters:</strong> Min 3 users exposed per combination</li>
         *             <li><strong>Ranking:</strong> By Expected Value (Lift × Total Conversions) - balances impact and reach</li>
         *             <li><strong>Metrics:</strong> Lift, odds ratio, precision, recall, AIC</li>
         *         </ul>
         *     </span>
         * </span></h2>
         *         <p style="color: #6c757d; font-size: 0.9rem; margin-bottom: 1.5rem;">The top portfolio or creator combinations that drive highest likelihood to copy</p>
         *
         *         <div class="combinations-tabs-container">
         *             <div class="combinations-tab-navigation">
         *                 <button class="combinations-tab-btn active" data-combinations-tab="portfolios">Portfolios</button>
         *                 <button class="combinations-tab-btn" data-combinations-tab="creators">Creators</button>
         *             </div>
         *
         *             <div class="combinations-tab-content">
         *                 <div id="portfolios-combinations-tab" class="combinations-tab-pane active">
         *                     ${combinationsHTML}
         *                 </div>
         *                 <div id="creators-combinations-tab" class="combinations-tab-pane">
         *                     ${creatorCombinationsHTML}
         *                 </div>
         *             </div>
         *         </div>
         *     </div>
         * `;
         *
         * ==================================================================================== */

        // Add Top Behavioral Drivers Section with nested tabs
        portfolioHTML += `
            <div class="qda-result-section" style="margin-top: 3rem;">
                <h2 style="margin-bottom: 0.5rem;"><span class="info-tooltip">Top Behavioral Drivers<span class="info-icon">i</span>
            <span class="tooltip-text">
                <strong>Top Behavioral Drivers</strong>
                Statistical analysis showing which user behaviors best predict deposits, copies, and subscriptions.
            </span>
        </span></h2>
                <p style="color: #6c757d; font-size: 0.9rem; margin-bottom: 1.5rem;">Top events that are the strong predictors of deposits, copies, and subscriptions</p>

                <div class="behavioral-tabs-container">
                    <div class="behavioral-tab-navigation">
                        <button class="behavioral-tab-btn active" data-behavioral-tab="deposits">Deposit Funds</button>
                        <button class="behavioral-tab-btn" data-behavioral-tab="copies">Copy Portfolios</button>
                        <button class="behavioral-tab-btn" data-behavioral-tab="subscriptions">Subscriptions</button>
                    </div>

                    <div class="behavioral-tab-content">
                        <div id="deposits-behavioral-tab" class="behavioral-tab-pane active">
                            <!-- Deposit Funds content will be inserted here -->
                        </div>
                        <div id="copies-behavioral-tab" class="behavioral-tab-pane">
                            <!-- Copy Portfolios content will be inserted here -->
                        </div>
                        <div id="subscriptions-behavioral-tab" class="behavioral-tab-pane">
                            <!-- Subscriptions content will be inserted here -->
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Set portfolio content
        portfolioContentSection.innerHTML = portfolioHTML;

        // Initialize behavioral tab switching
        this.initializePortfolioNestedTabs();

        // Load behavioral drivers from database for each outcome
        await this.displayTopDepositDrivers();
        await this.displayTopCopyDrivers();
        await this.displayTopSubscriptionDrivers();

        // Add timestamps - each tab uses its own specific data source from sync_logs

        // Summary Stats tab: uses mixpanel_user_properties_v2
        const summaryResultsDiv2 = summaryContainer.querySelector('.qda-analysis-results');
        if (summaryResultsDiv2) {
            // Add timestamp using shared utility
            await window.addTimestampToResults(summaryResultsDiv2, 'mixpanel_user_properties_v2', window.supabaseIntegration);

            // Add data scope text (top left)
            const summaryDataScope = document.createElement('div');
            summaryDataScope.className = 'qda-data-scope';
            summaryDataScope.textContent = 'All KYC approved users since 8/27';
            summaryResultsDiv2.insertBefore(summaryDataScope, summaryResultsDiv2.firstChild);
        }

        // Behavior Analysis tab: uses most recent of mixpanel_creator_sequences or mixpanel_portfolio_sequences
        const portfolioResultsDiv2 = portfolioContainer.querySelector('.qda-analysis-results');
        if (portfolioResultsDiv2) {
            // Add timestamp using shared utility (array of sources)
            await window.addTimestampToResults(
                portfolioResultsDiv2,
                ['mixpanel_creator_sequences', 'mixpanel_portfolio_sequences'],
                window.supabaseIntegration
            );

            // Add data scope text (top left)
            const portfolioDataScope = document.createElement('div');
            portfolioDataScope.className = 'qda-data-scope';
            portfolioDataScope.textContent = 'All KYC approved users since 8/27';
            portfolioResultsDiv2.insertBefore(portfolioDataScope, portfolioResultsDiv2.firstChild);
        }
    }


    /**
     * Generate Subscription Combinations HTML (inserted after correlation table)
     * Uses array.join() for optimal string building performance
     */
    generateSubscriptionCombinationsHTML(topCombinations) {
        if (!topCombinations || topCombinations.length === 0) {
            return '';
        }

        const parts = [
            '<div class="qda-result-section" style="margin-top: 2rem;">',
            this.generateCombinationsTableHTML(
                `<span class="info-tooltip">High-Impact Creator Combinations<span class="info-icon">i</span>
            <span class="tooltip-text">
                <strong>High-Impact Creator Combinations</strong>
                Identifies 2-creator pairs that drive subscriptions:
                <ul>
                    <li><strong>Method:</strong> Logistic regression with Newton-Raphson optimization</li>
                    <li><strong>Filters:</strong> Min 3 users exposed per combination, max 200 creators analyzed</li>
                    <li><strong>Ranking:</strong> By Expected Value (Lift × Total Conversions) - balances impact and volume</li>
                    <li><strong>Metrics:</strong> Lift (impact multiplier), odds ratio, precision, recall</li>
                </ul>
                Shows top 10 combinations sorted by Expected Value. Users must view BOTH creators to be counted as "exposed."
            </span>
        </span>`,
                'Users who viewed both of these creators were significantly more likely to subscribe',
                topCombinations,
                (combo) => {
                    const creator1 = combo.username_1 || combo.value_1;
                    const creator2 = combo.username_2 || combo.value_2;
                    return `${creator1}, ${creator2}`;
                },
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

        const parts = [
            '<div class="qda-result-section" style="margin-top: 3rem;">',
            `<h2 style="margin-top: 0; margin-bottom: 0.5rem;"><span class="info-tooltip">Hidden Gems<span class="info-icon">i</span>
            <span class="tooltip-text">
                <strong>Hidden Gems</strong>
                Portfolios attracting attention but not yet frequently copied:
                <ul>
                    <li><strong>Criteria:</strong> ≥10 total PDP views, ≥5:1 views-to-copies ratio, ≤100 total copies</li>
                    <li><strong>Data Source:</strong> <a href="https://mixpanel.com/project/2599235/view/3138115/app/boards#id=10576025&editor-card-id=%22report-85165580%22" target="_blank" style="color: #17a2b8;">Chart 85165580</a> (aggregated in portfolio_creator_engagement_metrics view)</li>
                    <li><strong>Ranking:</strong> By total PDP views (descending)</li>
                    <li><strong>Limit:</strong> Top 10 portfolios shown</li>
                </ul>
                These portfolios show potential for growth opportunities.
            </span>
        </span></h2>`,
            '<p style="font-size: 0.875rem; color: #6c757d; margin-top: 0; margin-bottom: 1rem;">Portfolios with high engagement but low conversion (Total PDP Views to Copies ratio ≥ 5:1, max 100 copies)</p>'
        ];

        // Summary Stats
        if (summaryData) {
            parts.push('<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem; margin-bottom: 2rem;">');

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
        if (hiddenGems && hiddenGems.length > 0) {
            parts.push(
                '<div class="table-wrapper">',
                '<table class="qda-regression-table">',
                `<thead>
                    <tr>
                        <th>Portfolio</th>
                        <th>Creator</th>
                        <th style="text-align: right;">Total PDP Views</th>
                        <th style="text-align: right;">Unique Views</th>
                        <th style="text-align: right;">Copies</th>
                        <th style="text-align: right;">Conv Rate</th>
                    </tr>
                </thead>
                <tbody id="hidden-gems-tbody">`
            );

            // Render all hidden gems with visibility classes
            hiddenGems.forEach((gem, index) => {
                const visibilityClass = index < 10 ? '' : ' style="display: none;"';
                const rowClass = index < 10 ? 'hidden-gems-row-initial' : 'hidden-gems-row-extra';
                parts.push(
                    `<tr class="${rowClass}"${visibilityClass}>
                        <td>${gem.portfolio_ticker || 'N/A'}</td>
                        <td>${gem.creator_username || 'N/A'}</td>
                        <td style="text-align: right;">${parseInt(gem.total_pdp_views || 0).toLocaleString()}</td>
                        <td style="text-align: right;">${parseInt(gem.unique_viewers || 0).toLocaleString()}</td>
                        <td style="text-align: right;">${parseInt(gem.total_copies || 0).toLocaleString()}</td>
                        <td style="text-align: right;">${parseFloat(gem.copy_conversion_rate || 0).toFixed(1)}%</td>
                    </tr>`
                );
            });

            parts.push('</tbody></table></div>');

            // Add Show More/Show Less button if there are more than 10 items
            if (hiddenGems.length > 10) {
                parts.push(
                    `<div style="text-align: left; margin-top: 1rem;">
                        <button id="hidden-gems-toggle-btn" class="show-more-btn" onclick="window.toggleHiddenGems()">
                            Show More
                        </button>
                    </div>`
                );
            }
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

        const copiersData = summaryData.find(d => d.did_copy === 1 || d.did_copy === true) || {};
        const nonCopiersData = summaryData.find(d => d.did_copy === 0 || d.did_copy === false) || {};

        // Extract unique creators and portfolios mean/median from copiers data (populated by SQL via event_sequence_metrics table)
        const uniqueCreatorsMean = copiersData.mean_unique_creators || 0;
        const uniqueCreatorsMedian = copiersData.median_unique_creators || 0;
        const uniquePortfoliosMean = copiersData.mean_unique_portfolios || 0;
        const uniquePortfoliosMedian = copiersData.median_unique_portfolios || 0;
        const creatorConverterCount = copiersData.creator_converter_count || 0;
        const portfolioConverterCount = copiersData.portfolio_converter_count || 0;

        // Calculate dynamic time range (last 30 days)
        const today = new Date();
        const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
        const timeRangeText = `${thirtyDaysAgo.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} - ${today.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

        const metrics = [
            { label: 'Avg Total Profile Views', primaryValue: copiersData.avg_profile_views || 0, secondaryValue: nonCopiersData.avg_profile_views || 0, showComparison: true, comparisonLabel: 'for non-copiers' },
            { label: 'Avg Total PDP Views', primaryValue: copiersData.avg_pdp_views || 0, secondaryValue: nonCopiersData.avg_pdp_views || 0, showComparison: true, comparisonLabel: 'for non-copiers' },
            {
                label: 'Avg Profile Views Before Copy',
                primaryValue: uniqueCreatorsMean,
                secondaryValue: uniqueCreatorsMedian,
                showComparison: false,
                showMedian: true,
                tooltip: `Average number of unique creator profiles viewed before first copy. Calculated by analyzing "Viewed Creator Profile" events from the last 30 days (${timeRangeText}) for ${creatorConverterCount.toLocaleString()} converters, counting distinct creator profiles viewed before their first copy, then calculating mean and median across all converters.`,
                tooltipPosition: 'top'
            },
            {
                label: 'Avg PDP Views Before Copy',
                primaryValue: uniquePortfoliosMean,
                secondaryValue: uniquePortfoliosMedian,
                showComparison: false,
                showMedian: true,
                tooltip: `Average number of unique portfolio detail pages viewed before first copy. Calculated by analyzing "Viewed Portfolio Details" events from the last 30 days (${timeRangeText}) for ${portfolioConverterCount.toLocaleString()} converters, counting distinct portfolios viewed before their first copy, then calculating mean and median across all converters.`,
                tooltipPosition: 'top'
            }
        ];

        // Use DocumentFragment for performance - build DOM elements instead of HTML strings
        const fragment = document.createDocumentFragment();

        // Create grid container
        const gridContainer = createElement('div', {
            style: {
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '1rem',
                marginBottom: '0.5rem',
                marginTop: '1.5rem'
            }
        });

        // Create metric cards
        metrics.forEach(metric => {
            // Build value display
            const valueDiv = createElement('div', {
                style: {
                    fontSize: '1.5rem',
                    fontWeight: 'bold'
                }
            });

            if (metric.showComparison) {
                const mainValue = document.createTextNode(`${parseFloat(metric.primaryValue).toFixed(1)} `);
                const compareSpan = createElement('span', {
                    style: {
                        fontSize: '0.9rem',
                        color: '#6c757d',
                        fontWeight: 'normal'
                    }
                }, `vs. ${parseFloat(metric.secondaryValue).toFixed(1)} ${metric.comparisonLabel || ''}`);
                valueDiv.appendChild(mainValue);
                valueDiv.appendChild(compareSpan);
            } else if (metric.showMedian) {
                const mainValue = document.createTextNode(`${parseFloat(metric.primaryValue).toFixed(1)}\n                   `);
                const medianSpan = createElement('span', {
                    style: {
                        fontSize: '0.9rem',
                        color: '#6c757d',
                        fontWeight: 'normal'
                    }
                }, `(median: ${parseFloat(metric.secondaryValue).toFixed(1)})`);
                valueDiv.appendChild(mainValue);
                valueDiv.appendChild(medianSpan);
            } else {
                valueDiv.textContent = `${Math.round(metric.primaryValue).toLocaleString()}`;
            }

            // Create label element (with tooltip if present)
            let labelElement;
            if (metric.tooltip) {
                // Create label with tooltip
                const tooltipClass = metric.tooltipPosition === 'top' ? 'info-tooltip info-tooltip-top' : 'info-tooltip';
                const tooltipSpan = createElement('span', { className: tooltipClass }, [
                    document.createTextNode(metric.label),
                    createElement('span', { className: 'info-icon' }, 'i'),
                    createElement('span', { className: 'tooltip-text' }, metric.tooltip)
                ]);
                labelElement = createElement('div', {
                    style: {
                        fontSize: '0.875rem',
                        color: '#2563eb',
                        fontWeight: '600',
                        marginBottom: '0.5rem'
                    }
                }, [tooltipSpan]);
            } else {
                // Create label without tooltip
                labelElement = createElement('div', {
                    style: {
                        fontSize: '0.875rem',
                        color: '#2563eb',
                        fontWeight: '600',
                        marginBottom: '0.5rem'
                    }
                }, metric.label);
            }

            // Create card
            const card = createElement('div', {
                style: {
                    backgroundColor: '#f8f9fa',
                    padding: '1rem',
                    borderRadius: '8px'
                }
            }, [
                labelElement,
                valueDiv
            ]);

            gridContainer.appendChild(card);
        });

        fragment.appendChild(gridContainer);

        // Convert DocumentFragment to HTML string to maintain compatibility with existing code
        const tempContainer = document.createElement('div');
        tempContainer.appendChild(fragment);
        return tempContainer.innerHTML;
    }

    /**
     * Generate Copy Conversion Paths HTML with tabs for Overall, Portfolios, and Creators
     * Merges unified, portfolio, and creator conversion path analysis into a single section
     */
    generateCopyConversionPathsHTML(portfolioPathData, creatorPathData, unifiedPathData) {
        // Check if we have any data
        if ((!portfolioPathData || portfolioPathData.length === 0) &&
            (!creatorPathData || creatorPathData.length === 0) &&
            (!unifiedPathData || unifiedPathData.length === 0)) {
            return '';
        }

        // Generate content HTML for each tab
        const overallContentHTML = this.generateUnifiedCopyPathsHTML(unifiedPathData);
        const portfolioContentHTML = this.generatePortfolioCopyPathsHTML(portfolioPathData);
        const creatorContentHTML = this.generateCreatorCopyPathsHTML(creatorPathData);

        // Build the section with tabs (using same pattern as Top Behavioral Drivers)
        let html = `
            <div class="qda-result-section" style="margin-top: 3rem;">
                <h2 style="margin-top: 0; margin-bottom: 0.5rem;"><span class="info-tooltip">Copy Conversion Paths<span class="info-icon">i</span>
                    <span class="tooltip-text">
                        <strong>Copy Conversion Paths</strong>
                        <p><strong>Overall:</strong> Analyzes combined creator + portfolio viewing sequences that lead to copy conversions. Shows the most common combinations and complete sequential viewing paths intermingling both types of views.</p>
                        <p><strong>Portfolio Paths:</strong> Analyzes portfolio viewing sequences that lead to copy conversions. Shows the most common entry points, portfolio combinations viewed together, and complete sequential viewing paths.</p>
                        <p><strong>Creator Paths:</strong> Analyzes creator profile viewing patterns that lead to copy conversions. Shows the most common entry creators, creator combinations viewed together, and complete sequential viewing paths.</p>
                    </span>
                </span></h2>
                <p style="color: #6c757d; font-size: 0.9rem; margin-bottom: 1.5rem;">
                    Viewing patterns that lead to successful copy conversions
                </p>
                <div class="conversion-paths-tabs-container">
                    <div class="conversion-paths-tab-navigation">
                        <button class="conversion-paths-tab-btn active" data-conversion-paths-tab="overall">Overall</button>
                        <button class="conversion-paths-tab-btn" data-conversion-paths-tab="portfolios">Portfolios</button>
                        <button class="conversion-paths-tab-btn" data-conversion-paths-tab="creators">Creators</button>
                    </div>
                    <div class="conversion-paths-tab-content">
                        <div id="conversion-overall-tab" class="conversion-paths-tab-pane active">
                            ${overallContentHTML}
                        </div>
                        <div id="conversion-portfolios-tab" class="conversion-paths-tab-pane">
                            ${portfolioContentHTML}
                        </div>
                        <div id="conversion-creators-tab" class="conversion-paths-tab-pane">
                            ${creatorContentHTML}
                        </div>
                    </div>
                </div>
            </div>
        `;

        return html;
    }

    /**
     * Generate Portfolio Copy Paths HTML - visualizes ordered portfolio viewing patterns
     * Returns just the 3 cards without header (used in tab content)
     */
    generatePortfolioCopyPathsHTML(pathData) {
        if (!pathData || pathData.length === 0) {
            console.warn('No portfolio copy path data available');
            return '';
        }

        // Group by analysis type
        const topPortfolios = pathData.filter(r => r.analysis_type === 'top_portfolios_viewed');
        const portfolioCombinations = pathData.filter(r => r.analysis_type === 'portfolio_combinations');
        const fullSequences = pathData.filter(r => r.analysis_type === 'full_sequence');

        console.log('Portfolio copy paths data:', {
            total: pathData.length,
            topPortfolios: topPortfolios.length,
            portfolioCombinations: portfolioCombinations.length,
            fullSequences: fullSequences.length,
            analysisTypes: [...new Set(pathData.map(r => r.analysis_type))]
        });

        if (topPortfolios.length === 0 && portfolioCombinations.length === 0 && fullSequences.length === 0) {
            console.warn('No valid analysis types found in data');
            return '';
        }

        // Build 3 cards grid (first card narrower, 2nd and 3rd equal width)
        let html = `<div style="display: grid; grid-template-columns: 1fr 2fr 2fr; gap: 20px; margin-top: 1rem;">`;

        // Top Portfolios Viewed Section
        if (topPortfolios.length > 0) {
            html += `
                <div style="background: #f8f9fa; padding: 1rem; border-radius: 8px;">
                    <h4 style="margin: 0 0 12px 0; color: #333; font-size: 0.875rem; font-weight: 600;">Top Portfolios Viewed</h4>
                    <div class="portfolio-list">
            `;

            topPortfolios.forEach(item => {
                const ticker = item.portfolio_sequence[0];
                const pct = parseFloat(item.pct_of_converters);

                html += `
                    <div style="display: flex; gap: 12px; padding: 6px 0; font-size: 0.875rem;">
                        <span style="min-width: 20px; color: #6c757d;">${item.path_rank}.</span>
                        <span style="flex: 2; color: #495057;">${ticker}</span>
                        <span style="min-width: 60px; text-align: right; font-weight: 500;">${pct}%</span>
                    </div>
                `;
            });

            html += `
                    </div>
                </div>
            `;
        }

        // Top Portfolio Combinations Section
        if (portfolioCombinations.length > 0) {
            html += `
                <div style="background: #f8f9fa; padding: 1rem; border-radius: 8px;">
                    <h4 style="margin: 0 0 12px 0; color: #333; font-size: 0.875rem; font-weight: 600;">Top Portfolio Combinations</h4>
                    <div class="portfolio-list">
            `;

            portfolioCombinations.forEach(item => {
                const portfolioSet = item.portfolio_sequence.join(', ');

                html += `
                    <div style="display: flex; gap: 12px; padding: 6px 0; font-size: 0.875rem;">
                        <span style="min-width: 20px; color: #6c757d;">${item.path_rank}.</span>
                        <span style="flex: 2; color: #495057;">${portfolioSet}</span>
                    </div>
                `;
            });

            html += `
                    </div>
                </div>
            `;
        }

        // Most Common Sequences Section
        if (fullSequences.length > 0) {
            html += `
                <div style="background: #f8f9fa; padding: 1rem; border-radius: 8px;">
                    <h4 style="margin: 0 0 12px 0; color: #333; font-size: 0.875rem; font-weight: 600;">Most Common Sequences</h4>
                    <div class="paths-list">
            `;

            fullSequences.forEach(item => {
                const pathStr = item.portfolio_sequence.join(' → ');

                html += `
                    <div style="display: flex; gap: 12px; padding: 6px 0; font-size: 0.875rem;">
                        <span style="min-width: 20px; color: #6c757d;">${item.path_rank}.</span>
                        <span style="flex: 2; color: #495057;">${pathStr}</span>
                    </div>
                `;
            });

            html += `
                    </div>
                </div>
            `;
        }

        html += `
            </div>
        `;

        return html;
    }

    /**
     * Generate Creator Copy Paths HTML - visualizes ordered creator viewing patterns
     * Returns just the 3 cards without header (used in tab content)
     */
    generateCreatorCopyPathsHTML(pathData) {
        if (!pathData || pathData.length === 0) {
            return '';
        }

        // Group by analysis type
        const topCreators = pathData.filter(r => r.analysis_type === 'top_creators_viewed');
        const creatorCombinations = pathData.filter(r => r.analysis_type === 'creator_combinations');
        const fullSequences = pathData.filter(r => r.analysis_type === 'full_sequence');

        if (topCreators.length === 0 && creatorCombinations.length === 0 && fullSequences.length === 0) {
            return '';
        }

        // Build 3 cards grid (first card narrower, 2nd and 3rd equal width)
        let html = `<div style="display: grid; grid-template-columns: 1fr 2fr 2fr; gap: 20px; margin-top: 1rem;">`;

        // Top Creators Viewed Section
        if (topCreators.length > 0) {
            html += `
                <div style="background: #f8f9fa; padding: 1rem; border-radius: 8px;">
                    <h4 style="margin: 0 0 12px 0; color: #333; font-size: 0.875rem; font-weight: 600;">Top Creators Viewed</h4>
                    <div class="portfolio-list">
            `;

            topCreators.forEach(item => {
                const creator = item.creator_sequence[0];
                const pct = parseFloat(item.pct_of_converters);

                html += `
                    <div style="display: flex; gap: 12px; padding: 6px 0; font-size: 0.875rem;">
                        <span style="min-width: 20px; color: #6c757d;">${item.path_rank}.</span>
                        <span style="flex: 2; color: #495057;">${creator}</span>
                        <span style="min-width: 60px; text-align: right; font-weight: 500;">${pct}%</span>
                    </div>
                `;
            });

            html += `
                    </div>
                </div>
            `;
        }

        // Top Creator Combinations Section
        if (creatorCombinations.length > 0) {
            html += `
                <div style="background: #f8f9fa; padding: 1rem; border-radius: 8px;">
                    <h4 style="margin: 0 0 12px 0; color: #333; font-size: 0.875rem; font-weight: 600;">Top Creator Combinations</h4>
                    <div class="portfolio-list">
            `;

            creatorCombinations.forEach(item => {
                const creatorSet = item.creator_sequence.join(', ');

                html += `
                    <div style="display: flex; gap: 12px; padding: 6px 0; font-size: 0.875rem;">
                        <span style="min-width: 20px; color: #6c757d;">${item.path_rank}.</span>
                        <span style="flex: 2; color: #495057;">${creatorSet}</span>
                    </div>
                `;
            });

            html += `
                    </div>
                </div>
            `;
        }

        // Most Common Sequences Section
        if (fullSequences.length > 0) {
            html += `
                <div style="background: #f8f9fa; padding: 1rem; border-radius: 8px;">
                    <h4 style="margin: 0 0 12px 0; color: #333; font-size: 0.875rem; font-weight: 600;">Most Common Sequences</h4>
                    <div class="paths-list">
            `;

            fullSequences.forEach(item => {
                const pathStr = item.creator_sequence.join(' → ');

                html += `
                    <div style="display: flex; gap: 12px; padding: 6px 0; font-size: 0.875rem;">
                        <span style="min-width: 20px; color: #6c757d;">${item.path_rank}.</span>
                        <span style="flex: 2; color: #495057;">${pathStr}</span>
                    </div>
                `;
            });

            html += `
                    </div>
                </div>
            `;
        }

        html += `</div>`;

        return html;
    }

    /**
     * Generate Unified Copy Paths HTML - combines creator + portfolio views
     * Returns 2-card layout: Top Combinations and Most Common Sequences
     */
    generateUnifiedCopyPathsHTML(pathData) {
        if (!pathData || pathData.length === 0) {
            return '';
        }

        // Group by analysis type
        const combinations = pathData.filter(r => r.analysis_type === 'combinations');
        const fullSequences = pathData.filter(r => r.analysis_type === 'full_sequence');

        if (combinations.length === 0 && fullSequences.length === 0) {
            return '';
        }

        // Helper function to format view items from "Creator: username" or "Portfolio: ticker" to "@username" or "$ticker"
        const formatViewItem = (item) => {
            if (item.startsWith('Creator: ')) {
                const username = item.substring(9);
                return username.startsWith('@') ? username : '@' + username;
            } else if (item.startsWith('Portfolio: ')) {
                const ticker = item.substring(11);
                return ticker.startsWith('$') ? ticker : '$' + ticker;
            } else if (item.startsWith('@') || item.startsWith('$')) {
                return item;
            }
            return item;
        };

        // Build 2 cards grid (equal width)
        let html = `<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 1rem;">`;

        // Card 1: Top Combinations
        if (combinations.length > 0) {
            html += `
                <div style="background: #f8f9fa; padding: 1rem; border-radius: 8px;">
                    <h4 style="margin: 0 0 12px 0; color: #333; font-size: 0.875rem; font-weight: 600;">Top Combinations</h4>
                    <div class="portfolio-list">
            `;

            combinations.forEach(item => {
                const formattedItems = item.view_sequence.map(v => formatViewItem(v));
                const combinationStr = formattedItems.join(', ');

                html += `
                    <div style="display: flex; gap: 12px; padding: 6px 0; font-size: 0.875rem;">
                        <span style="min-width: 20px; color: #6c757d;">${item.path_rank}.</span>
                        <span style="flex: 2; color: #495057;">${combinationStr}</span>
                    </div>
                `;
            });

            html += `
                    </div>
                </div>
            `;
        }

        // Card 2: Most Common Sequences
        if (fullSequences.length > 0) {
            html += `
                <div style="background: #f8f9fa; padding: 1rem; border-radius: 8px;">
                    <h4 style="margin: 0 0 12px 0; color: #333; font-size: 0.875rem; font-weight: 600;">Most Common Sequences</h4>
                    <div class="paths-list">
            `;

            fullSequences.forEach(item => {
                const formattedItems = item.view_sequence.map(v => formatViewItem(v));
                const pathStr = formattedItems.join(' → ');

                html += `
                    <div style="display: flex; gap: 12px; padding: 6px 0; font-size: 0.875rem;">
                        <span style="min-width: 20px; color: #6c757d;">${item.path_rank}.</span>
                        <span style="flex: 2; color: #495057;">${pathStr}</span>
                    </div>
                `;
            });

            html += `
                    </div>
                </div>
            `;
        }

        html += `</div>`;

        return html;
    }

    /**
     * Generate Correlation Header HTML (h3 + subtitle for correlation table)
     * Uses array.join() for optimal string building performance
     */
    generateCorrelationHeaderHTML(title, subtitle) {
        const parts = [
            `<h2 style="margin-top: 1.5rem; margin-bottom: 0.5rem;">${title}</h2>`,
            `<p style="font-size: 0.875rem; color: #6c757d; margin-top: 0; margin-bottom: 1rem;">${subtitle}</p>`
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

        const parts = [
            '<div class="qda-result-section" style="margin-top: 3rem;">',
            `<h3 style="margin-top: 1.5rem; margin-bottom: 0.5rem;"><span class="info-tooltip">Portfolio Sequence Analysis<span class="info-icon">i</span>
            <span class="tooltip-text">
                <strong>Portfolio Sequence Analysis</strong>
                Identifies the first 3 portfolios viewed (in exact order) that drive copies:
                <ul>
                    <li><strong>Method:</strong> Logistic regression analyzing sequential viewing patterns</li>
                    <li><strong>Filters:</strong> Min 3 users exposed per sequence</li>
                    <li><strong>Order Matters:</strong> [A, B, C] is different from [B, A, C]</li>
                    <li><strong>Ranking:</strong> By Expected Value (Lift × Total Conversions) - balances impact and volume</li>
                </ul>
                Reveals optimal onboarding paths for new users.
            </span>
        </span></h3>`,
            '<p style="font-size: 0.875rem; color: #6c757d; margin-top: 0; margin-bottom: 1rem;">This analysis identifies the first three PDP views that drive highest likelihood to copy</p>',
            '<div class="table-wrapper">',
            '<table class="qda-regression-table">',
            `<thead>
                <tr>
                    <th>Rank</th>
                    <th>Portfolio Sequence</th>
                    <th style="text-align: right;"><span class="info-tooltip">Impact<span class="info-icon">i</span>
            <span class="tooltip-text">
                <strong>Impact (Lift)</strong>
                Measures conversion likelihood multiplier:
                <ul>
                    <li><strong>Formula:</strong> Group conversion rate ÷ Overall baseline rate</li>
                    <li><strong>Example:</strong> 2.5x means users who viewed this sequence were 2.5 times more likely to convert</li>
                    <li><strong>Interpretation:</strong> Higher lift = stronger predictive signal</li>
                </ul>
            </span>
        </span></th>
                    <th style="text-align: right;">Users</th>
                    <th style="text-align: right;">Total Copies</th>
                    <th style="text-align: right;">Conv Rate</th>
                </tr>
            </thead>
            <tbody>`
        ];

        topSequences.forEach((seq, index) => {
            // Handle both 2-way and 3-way combinations (for backwards compatibility)
            const displayValue = seq.value_3
                ? `${seq.value_1} → ${seq.value_2} → ${seq.value_3}`
                : `${seq.value_1} → ${seq.value_2}`;
            parts.push(
                `<tr>
                    <td style="font-weight: 600;">${index + 1}</td>
                    <td>${displayValue}</td>
                    <td style="text-align: right; font-weight: 600; color: #2563eb;">${parseFloat(seq.lift).toFixed(2)}x lift</td>
                    <td style="text-align: right;">${parseInt(seq.users_with_exposure).toLocaleString()}</td>
                    <td style="text-align: right;">${parseInt(seq.total_conversions || 0).toLocaleString()}</td>
                    <td style="text-align: right;">${(parseFloat(seq.conversion_rate_in_group) * 100).toFixed(1)}%</td>
                </tr>`
            );
        });

        parts.push(
            '</tbody></table>',
            '</div>',
            '</div>'
        );

        return parts.join('');
    }

    /**
     * Generate Combinations Table HTML (DRY helper)
     * @param {string} extraColumnLabel - Optional extra column label (e.g., "Total PDP Views")
     * @param {function} extraColumnValueFn - Optional function to extract extra column value from combo
     */
    generateCombinationsTableHTML(title, subtitle, data, valueFormatter, columnLabel, conversionLabel, extraColumnLabel = null, extraColumnValueFn = null) {
        const parts = [
            '<div style="margin-top: 3rem;">',
            `<h2 style="margin-top: 1.5rem; margin-bottom: 0.5rem;">${title}</h2>`,
            `<p style="font-size: 0.875rem; color: #6c757d; margin-top: 0; margin-bottom: 1rem;">${subtitle}</p>`,
            '<div class="table-wrapper">',
            '<table class="qda-regression-table">',
            '<thead><tr>',
            '<th>Rank</th>',
            `<th>${columnLabel}</th>`,
            `<th style="text-align: right;"><span class="info-tooltip">Impact<span class="info-icon">i</span>
            <span class="tooltip-text">
                <strong>Impact (Lift)</strong>
                Measures conversion likelihood multiplier:
                <ul>
                    <li><strong>Formula:</strong> Group conversion rate ÷ Overall baseline rate</li>
                    <li><strong>Example:</strong> 2.5x means users who viewed this combination were 2.5 times more likely to convert</li>
                    <li><strong>Interpretation:</strong> Higher lift = stronger predictive signal</li>
                </ul>
            </span>
        </span></th>`,
            '<th style="text-align: right;">Unique Views</th>'
        ];

        // Add extra column header if provided
        if (extraColumnLabel) {
            parts.push(`<th style="text-align: right;">${extraColumnLabel}</th>`);
        }

        parts.push(
            `<th style="text-align: right;"><span class="info-tooltip">${conversionLabel}<span class="info-icon">i</span>
            <span class="tooltip-text">
                The total portfolio copies by users who viewed all portfolios/creators
            </span>
        </span></th>`,
            '<th style="text-align: right;">Conv Rate</th>',
            '</tr></thead>',
            '<tbody>'
        );

        // Build rows as separate array items
        data.forEach((combo, index) => {
            const displayValue = valueFormatter(combo);
            parts.push(
                '<tr>',
                `<td style="font-weight: 600;">${index + 1}</td>`,
                `<td>${displayValue}</td>`,
                `<td style="text-align: right; font-weight: 600; color: #2563eb;">${parseFloat(combo.lift).toFixed(2)}x lift</td>`,
                `<td style="text-align: right;">${parseInt(combo.users_with_exposure).toLocaleString()}</td>`
            );

            // Add extra column value if function provided
            if (extraColumnValueFn) {
                const extraValue = extraColumnValueFn(combo);
                parts.push(`<td style="text-align: right;">${extraValue}</td>`);
            }

            parts.push(
                `<td style="text-align: right;">${parseInt(combo.total_conversions || 0).toLocaleString()}</td>`,
                `<td style="text-align: right;">${(parseFloat(combo.conversion_rate_in_group) * 100).toFixed(1)}%</td>`,
                '</tr>'
            );
        });

        parts.push(
            '</tbody></table>',
            '</div>',
            '</div>'
        );

        return parts.join('');
    }



    /**
     * Create metric card HTML (for creator summary stats)
     */
    createMetricCardHTML(title, content, size = null) {
        return `
            <div style="background-color: #f8f9fa; padding: 1rem; border-radius: 8px;">
                <div style="font-size: 0.875rem; color: #2563eb; font-weight: 600; margin-bottom: 0.5rem;">${title}</div>
                <div style="font-size: 1.5rem; font-weight: bold;">${content}</div>
            </div>
        `;
    }

    /**
     * Build creator correlation table (specialized for creator metrics)
     */
    buildCreatorCorrelationTable(correlationData, regressionData, tippingPoints) {
        const outcome = 'totalSubscriptions';

        const allVariables = Object.keys(correlationData);
        const filteredVariables = allVariables; // No exclusions for creator data

        const combinedData = filteredVariables.map(variable => {
            const correlation = correlationData[variable];
            const regressionItem = regressionData.find(item => item.variable === variable);

            let tippingPoint = 'N/A';
            if (tippingPoints && tippingPoints[outcome] && tippingPoints[outcome][variable]) {
                tippingPoint = tippingPoints[outcome][variable];
            }

            return {
                variable: variable,
                correlation: correlation,
                tStat: regressionItem ? regressionItem.tStat : 0,
                tippingPoint: tippingPoint
            };
        }).sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));

        // Calculate predictive strength
        combinedData.forEach(item => {
            const result = window.calculatePredictiveStrength?.(item.correlation, item.tStat) || { strength: 'N/A', className: '' };
            item.predictiveStrength = result.strength;
            item.predictiveClass = result.className;
        });

        const table = document.createElement('table');
        table.className = 'qda-regression-table';

        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        const headers = [
            { text: 'Variable', tooltip: null },
            { text: 'Correlation', tooltip: null },
            { text: 'T-Statistic', tooltip: null },
            {
                text: 'Predictive Strength',
                tooltip: `<strong>Predictive Strength</strong>
                    Combines statistical significance and effect size using a two-stage approach:
                    <ul>
                        <li><strong>Stage 1:</strong> T-statistic ≥1.96 (95% confidence)</li>
                        <li><strong>Stage 2:</strong> Weighted score = Correlation (90%) + T-stat (10%)</li>
                        <li><strong>Ranges:</strong> Very Strong (≥5.5), Strong (≥4.5), Moderate-Strong (≥3.5), Moderate (≥2.5), Weak-Moderate (≥1.5), Weak (≥0.5)</li>
                    </ul>
                    Higher scores indicate stronger and more reliable predictive relationships.`
            },
            {
                text: 'Tipping Point',
                tooltip: `<strong>Tipping Point</strong>
                    The "magic number" threshold where creator behavior changes significantly:
                    <ul>
                        <li>Identifies the value where the largest jump in conversion rate occurs</li>
                        <li>Only considers groups with 10+ creators and >10% conversion rate</li>
                        <li>Represents the minimum exposure needed for behavioral change</li>
                    </ul>
                    Example: If tipping point is 5, creators with 5+ of this metric convert at much higher rates.`
            }
        ];

        headers.forEach(headerData => {
            const th = document.createElement('th');
            if (headerData.tooltip) {
                th.innerHTML = `<span class="info-tooltip">${headerData.text}<span class="info-icon">i</span><span class="tooltip-text">${headerData.tooltip}</span></span>`;
            } else {
                th.textContent = headerData.text;
            }
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        const fragment = document.createDocumentFragment();

        combinedData.slice(0, 10).forEach(item => {
            const row = document.createElement('tr');

            // Variable - convert camelCase to readable format
            const varCell = document.createElement('td');
            // Handle acronyms like "PDP" - keep consecutive capitals together
            const readableVar = item.variable
                .replace(/([a-z])([A-Z])/g, '$1 $2') // Split between lowercase and capital
                .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2') // Split before last capital in sequence (e.g., "PDPViews" → "PDP Views")
                .trim();
            varCell.textContent = readableVar;
            varCell.style.width = '200px'; // Consistent variable column width
            row.appendChild(varCell);

            // Correlation
            const corrCell = document.createElement('td');
            corrCell.textContent = item.correlation.toFixed(2);
            row.appendChild(corrCell);

            // T-Stat
            const tStatCell = document.createElement('td');
            tStatCell.textContent = item.tStat.toFixed(2);
            row.appendChild(tStatCell);

            // Predictive Strength
            const strengthCell = document.createElement('td');
            const strengthSpan = document.createElement('span');
            strengthSpan.className = item.predictiveClass;
            strengthSpan.textContent = item.predictiveStrength;
            strengthCell.appendChild(strengthSpan);
            row.appendChild(strengthCell);

            // Tipping Point
            const tpCell = document.createElement('td');
            tpCell.textContent = item.tippingPoint !== 'N/A' ?
                (typeof item.tippingPoint === 'number' ? item.tippingPoint.toFixed(1) : item.tippingPoint) :
                'N/A';
            row.appendChild(tpCell);

            fragment.appendChild(row);
        });

        tbody.appendChild(fragment);
        table.appendChild(tbody);

        // Wrap table in a scrollable container for mobile
        const wrapper = document.createElement('div');
        wrapper.className = 'table-wrapper';
        wrapper.appendChild(table);

        return wrapper;
    }


    /**
     * Process creator data for display
     */
    async processCreatorData(csvContent) {
        try {
            // Create a temporary creator tool instance just for processing
            const tempTool = new CreatorAnalysisTool();

            // Parse CSV
            const parsedData = tempTool.parseCSV(csvContent);

            // Clean and transform data
            const cleanData = tempTool.cleanCreatorData(parsedData);

            // Run analysis
            const results = tempTool.performCreatorAnalysis(cleanData);

            return results;
        } catch (e) {
            console.error('Error processing creator data:', e);
            return null;
        }
    }

    /**
     * Render subscription price distribution as Highcharts bar chart
     */
    renderSubscriptionPriceChart(chartId, subscriptionDistribution) {
        // Data is already aggregated by price from the database view
        // Each row represents one price point with aggregated totals
        // Group by rounded price (to 2 decimals) to combine similar prices like 49.99 and 49.995
        const priceMap = {};

        subscriptionDistribution.forEach(row => {
            const rawPrice = parseFloat(row.monthly_price || row.subscription_price);
            const roundedPrice = Math.round(rawPrice * 100) / 100; // Round to 2 decimals
            const totalSubs = parseInt(row.total_subscriptions) || 0;
            const totalPaywallViews = parseInt(row.total_paywall_views) || 0;
            const creators = Array.isArray(row.creator_usernames) ? row.creator_usernames : [];
            const creatorCount = parseInt(row.creator_count) || creators.length;

            if (!priceMap[roundedPrice]) {
                priceMap[roundedPrice] = {
                    price: roundedPrice,
                    totalSubs: 0,
                    totalPaywallViews: 0,
                    creatorCount: 0,
                    creators: []
                };
            }

            // Aggregate data for this rounded price
            priceMap[roundedPrice].totalSubs += totalSubs;
            priceMap[roundedPrice].totalPaywallViews += totalPaywallViews;
            priceMap[roundedPrice].creatorCount += creatorCount;
            priceMap[roundedPrice].creators.push(...creators);
        });

        const sortedData = Object.values(priceMap)
            .map(data => {
                // Calculate overall conversion rate for this price point
                const overallConversionRate = data.totalPaywallViews > 0
                    ? (data.totalSubs / data.totalPaywallViews)
                    : 0;

                // Take top 5 unique creators
                const uniqueCreators = [...new Set(data.creators)];
                const topCreators = uniqueCreators.slice(0, 5);

                return {
                    name: `$${data.price.toFixed(2)}`,
                    price: data.price,
                    y: data.totalSubs,  // Total subscriptions across all creators at this price
                    creatorCount: data.creatorCount,
                    totalPaywallViews: data.totalPaywallViews,
                    conversionRate: overallConversionRate,
                    creators: topCreators
                };
            })
            .sort((a, b) => a.price - b.price);

        // Render Highcharts bar chart
        Highcharts.chart(chartId, {
            accessibility: {
                enabled: false  // Disable accessibility module warning
            },
            chart: {
                type: 'column',
                backgroundColor: 'transparent'
            },
            title: {
                text: null
            },
            xAxis: {
                type: 'category',
                title: {
                    text: 'Monthly Price'
                },
                labels: {
                    rotation: -45,
                    style: {
                        fontSize: '11px'
                    }
                }
            },
            yAxis: {
                min: 0,
                title: {
                    text: 'Total Subscriptions'
                }
            },
            legend: {
                enabled: false
            },
            tooltip: {
                useHTML: true,
                formatter: function() {
                    let tooltipHTML = `<b>${this.point.name}</b><br/>`;
                    tooltipHTML += `<b>${this.point.y.toLocaleString()}</b> total subscriptions<br/>`;
                    tooltipHTML += `<b>${this.point.creatorCount}</b> creators at this price<br/>`;
                    tooltipHTML += `<b>${this.point.totalPaywallViews.toLocaleString()}</b> total paywall views<br/>`;

                    // Show overall conversion rate for this price point
                    const conversionRate = (this.point.conversionRate * 100).toFixed(1);
                    tooltipHTML += `<b>${conversionRate}%</b> conversion rate<br/><br/>`;

                    // Show top creators at this price point
                    if (this.point.creators && this.point.creators.length > 0) {
                        tooltipHTML += '<b>Top Creators:</b><br/>';
                        this.point.creators.forEach(creator => {
                            tooltipHTML += `${creator}<br/>`;
                        });
                    }

                    return tooltipHTML;
                }
            },
            series: [{
                name: 'Total Subscriptions',
                data: sortedData,
                color: '#2563eb',
                dataLabels: {
                    enabled: true,
                    format: '{point.y}',
                    inside: false,
                    y: -5
                }
            }],
            credits: {
                enabled: false
            }
        });
    }

    /**
     * Create subscription price table HTML (returns HTML string)
     */
    createSubscriptionPriceTableHTML(priceData) {
        const sortedPrices = Object.entries(priceData).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));

        let html = '<table class="qda-regression-table">';
        html += '<thead><tr><th>Price Point</th><th>Count</th></tr></thead>';
        html += '<tbody>';

        sortedPrices.forEach(([price, count]) => {
            html += `<tr><td>$${parseFloat(price).toFixed(2)}</td><td>${count}</td></tr>`;
        });

        html += '</tbody></table>';
        return html;
    }

    /**
     * Create subscription price table (returns DOM element)
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

    /**
     * Toggle Hidden Gems visibility (Show More/Show Less)
     */
    toggleHiddenGems() {
        const extraRows = document.querySelectorAll('.hidden-gems-row-extra');
        const button = document.getElementById('hidden-gems-toggle-btn');

        if (!extraRows.length || !button) return;

        const isHidden = extraRows[0].style.display === 'none';

        // Toggle visibility in batches of 10
        let visibleCount = document.querySelectorAll('.hidden-gems-row-initial').length;

        extraRows.forEach((row, index) => {
            if (isHidden) {
                // Show next 10
                if (index < 10) {
                    row.style.display = '';
                }
            } else {
                // Hide all extra rows
                row.style.display = 'none';
            }
        });

        // Update button text
        if (isHidden) {
            const remainingCount = Array.from(extraRows).filter(row => row.style.display === 'none').length;
            if (remainingCount > 0) {
                button.textContent = 'Show More';
            } else {
                button.textContent = 'Show Less';
            }
        } else {
            button.textContent = 'Show More';
        }
    }

}

// Export to window
window.UserAnalysisToolSupabase = UserAnalysisToolSupabase;

// Global toggle function for Hidden Gems
window.toggleHiddenGems = function() {
    const extraRows = document.querySelectorAll('.hidden-gems-row-extra');
    const button = document.getElementById('hidden-gems-toggle-btn');

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
 * Display Marketing Metrics section
 * Shows: Avg Monthly Copies, Total Investments, Total Public Portfolios, Total Market-Beating Portfolios
 */
/**
 * Display Marketing Metrics section
 * @param {boolean} fetchFromMixpanel - Whether to fetch fresh data from Mixpanel (default: false)
 */
UserAnalysisToolSupabase.prototype.displayMarketingMetrics = async function(fetchFromMixpanel = false) {
    const container = document.getElementById('qdaMarketingMetricsInline');
    if (!container) return;

    container.innerHTML = '';

    const resultSection = document.createElement('div');
    resultSection.className = 'qda-result-section';
    resultSection.style.marginTop = '2rem';

    const title = document.createElement('h2');
    title.style.cssText = 'margin-top: 0; margin-bottom: 0.5rem;';
    title.innerHTML = `<span class="info-tooltip">Marketing Metrics<span class="info-icon">i</span>
        <span class="tooltip-text">
            <strong>Marketing Metrics</strong>
            Key platform metrics for marketing and growth tracking.
            <ul>
                <li><strong>Data Sources:</strong>
                    <a href="https://mixpanel.com/project/2599235/view/3138115/app/boards#id=10576025&editor-card-id=%22report-86100814%22" target="_blank" style="color: #17a2b8;">Chart 86100814</a> (Avg Monthly Copies),
                    Manual CSV Upload (Portfolio Performance Metrics for Market-Beating count)
                </li>
                <li><strong>Trigger:</strong> Manual "Fetch Marketing Data" button</li>
                <li><strong>Metrics:</strong> Avg monthly copies, total investments, total public portfolios, total market-beating portfolios</li>
            </ul>
        </span>
    </span>`;
    resultSection.appendChild(title);

    // Load existing metrics from database
    const existingMetrics = await this.loadMarketingMetrics();

    // Fetch fresh data from Mixpanel/Supabase only if requested (during sync)
    let avgMonthlyCopies = existingMetrics?.avg_monthly_copies || null;
    let totalMarketBeating = existingMetrics?.total_market_beating_portfolios || null;

    // ALWAYS recalculate market-beating portfolios from current data
    // This ensures the metric is up-to-date after manual CSV uploads
    try {
        const marketBeatingCount = await this.fetchMarketBeatingPortfolios();
        if (marketBeatingCount !== null) {
            totalMarketBeating = marketBeatingCount;
        }
    } catch (error) {
        console.warn('Error fetching market-beating portfolios count:', error);
        // Fall back to cached value if fetch fails
    }

    if (fetchFromMixpanel) {
        try {
            // Fetch Avg Monthly Copies from Mixpanel
            const freshCopies = await this.fetchAvgMonthlyCopies();
            if (freshCopies !== null) {
                avgMonthlyCopies = freshCopies;
            }

            // Save updated metrics to database only when fetching fresh data
            await this.saveMarketingMetrics({
                avg_monthly_copies: avgMonthlyCopies,
                total_investments: existingMetrics?.total_investments || null,
                total_public_portfolios: existingMetrics?.total_public_portfolios || null,
                total_market_beating_portfolios: totalMarketBeating
            });
        } catch (error) {
            console.error('Error fetching marketing metrics:', error);
        }
    } else {
        // Even when not syncing from Mixpanel, save updated market-beating count
        // This ensures manual uploads update the cached metric
        try {
            await this.saveMarketingMetrics({
                avg_monthly_copies: existingMetrics?.avg_monthly_copies || null,
                total_investments: existingMetrics?.total_investments || null,
                total_public_portfolios: existingMetrics?.total_public_portfolios || null,
                total_market_beating_portfolios: totalMarketBeating
            });
        } catch (error) {
            console.warn('Error saving updated market-beating count:', error);
        }
    }

    // Get other metrics from database
    const totalInvestments = existingMetrics?.total_investments || null;
    const totalPublicPortfolios = existingMetrics?.total_public_portfolios || null;

    // Create metric cards grid (4 columns for Marketing Metrics)
    const metricSummary = document.createElement('div');
    metricSummary.className = 'qda-metric-summary';
    metricSummary.style.gridTemplateColumns = 'repeat(4, 1fr)';

    const metrics = [
        ['Avg Monthly Copies', avgMonthlyCopies !== null ? avgMonthlyCopies.toLocaleString() : '-', '18px'],
        ['Total Investments', totalInvestments !== null ? `$${totalInvestments.toLocaleString()}` : '-', '18px'],
        ['Total Public Portfolios', totalPublicPortfolios !== null ? totalPublicPortfolios.toLocaleString() : '-', '18px'],
        ['Total Market-Beating Portfolios', totalMarketBeating !== null ? totalMarketBeating.toLocaleString() : '-', '18px']
    ];

    metrics.forEach(([title, content, size]) => {
        metricSummary.appendChild(createMetricCard(title, content, size));
    });

    resultSection.appendChild(metricSummary);

    container.appendChild(resultSection);
};

/**
 * Load marketing metrics from database
 */
UserAnalysisToolSupabase.prototype.loadMarketingMetrics = async function() {
    try {
        if (!this.supabaseIntegration) {
            console.warn('Supabase integration not available');
            return null;
        }

        const { data, error } = await this.supabaseIntegration.supabase
            .from('marketing_metrics')
            .select('*')
            .order('updated_at', { ascending: false })
            .limit(1)
            .single();

        if (error) {
            // If no rows exist yet, that's okay
            if (error.code === 'PGRST116') {
                console.log('No marketing metrics found yet');
                return null;
            }
            console.error('Error loading marketing metrics:', error);
            console.error('Full error details:', JSON.stringify(error, null, 2));
            return null;
        }

        return data;
    } catch (error) {
        console.error('Error in loadMarketingMetrics:', error);
        return null;
    }
};

/**
 * Save marketing metrics to database
 */
UserAnalysisToolSupabase.prototype.saveMarketingMetrics = async function(metrics) {
    try {
        if (!this.supabaseIntegration) {
            console.warn('Supabase integration not available');
            return;
        }

        // Upsert with id=1 (single row table)
        // If row with id=1 exists, update it. Otherwise insert with id=1.
        const { error } = await this.supabaseIntegration.supabase
            .from('marketing_metrics')
            .upsert({
                id: 1,  // Single row constraint
                avg_monthly_copies: metrics.avg_monthly_copies,
                total_investments: metrics.total_investments,
                total_public_portfolios: metrics.total_public_portfolios,
                total_market_beating_portfolios: metrics.total_market_beating_portfolios,
                updated_at: new Date().toISOString()
            }, {
                onConflict: 'id'  // Use id as the conflict resolution key
            });

        if (error) {
            console.error('Error upserting marketing metrics:', error);
            return;
        }

        // Marketing metrics saved successfully
    } catch (error) {
        console.error('Error in saveMarketingMetrics:', error);
    }
};

/**
 * Fetch average monthly copies from Mixpanel Chart 86100814
 */
UserAnalysisToolSupabase.prototype.fetchAvgMonthlyCopies = async function() {
    try {
        if (!this.supabaseIntegration) {
            console.warn('Supabase integration not available');
            return null;
        }

        const response = await this.supabaseIntegration.fetchMixpanelInsights('86100814');

        if (!response || !response.series) {
            console.warn('No data returned from Mixpanel');
            return null;
        }

        // Get the first series (should be "Total Events of Copied Portfolio")
        const seriesKey = Object.keys(response.series)[0];
        const monthlyData = response.series[seriesKey];

        if (!monthlyData || typeof monthlyData !== 'object') {
            console.warn('Invalid monthly data format');
            return null;
        }

        // Convert to array and exclude the last month (current incomplete month)
        const monthlyValues = Object.values(monthlyData);
        if (monthlyValues.length <= 1) {
            console.warn('Not enough data to calculate average');
            return null;
        }

        // Exclude last month and calculate average
        const completedMonths = monthlyValues.slice(0, -1);
        const sum = completedMonths.reduce((acc, val) => acc + val, 0);
        const average = Math.round(sum / completedMonths.length);
        return average;
    } catch (error) {
        console.error('Error fetching avg monthly copies:', error);
        return null;
    }
};

/**
 * Fetch count of market-beating portfolios from portfolio_performance_metrics
 * Market-beating = total_returns_percentage >= 0.15 (15%)
 */
UserAnalysisToolSupabase.prototype.fetchMarketBeatingPortfolios = async function() {
    try {
        if (!this.supabaseIntegration) {
            console.warn('Supabase integration not available');
            return null;
        }

        const { count, error } = await this.supabaseIntegration.supabase
            .from('portfolio_performance_metrics')
            .select('*', { count: 'exact', head: true })
            .gte('total_returns_percentage', 0.15);

        if (error) {
            console.error('Error fetching market-beating portfolios:', error);
            return null;
        }
        return count;
    } catch (error) {
        console.error('Error fetching market-beating portfolios:', error);
        return null;
    }
};

/**
 * Process marketing data CSV and calculate Total Public Portfolios
 */
UserAnalysisToolSupabase.prototype.processMarketingDataCSV = async function(file) {
    try {
        this.clearStatus();

        // Show the unified progress bar
        const progressSection = document.getElementById('unifiedProgressSection');
        if (progressSection) {
            progressSection.style.display = 'block';
        }

        this.showProgress(0);
        this.updateProgress(10, `Uploading ${file.name}...`);
        console.log('Processing marketing data CSV...');

        // Add small delay to ensure progress bar is visible
        await new Promise(resolve => setTimeout(resolve, 400));

        const text = await file.text();
        // Handle different line endings (Windows \r\n, Unix \n, Mac \r)
        const lines = text.split(/\r?\n/).filter(line => line.trim());

        console.log(`CSV file has ${lines.length} lines (after filtering empty lines)`);
        console.log('First few lines:', lines.slice(0, 3));

        if (lines.length < 2) {
            this.addStatusMessage(`❌ CSV file appears to be empty or invalid (found ${lines.length} lines)`, 'error');
            setTimeout(() => {
                if (progressSection) progressSection.style.display = 'none';
            }, 1500);
            return;
        }

        this.updateProgress(30, 'Processing records...');

        // Parse header
        const headers = lines[0].split(',').map(h => h.trim());
        const strategyTickerIndex = headers.findIndex(h => h.toLowerCase() === 'strategyticker');

        if (strategyTickerIndex === -1) {
            this.addStatusMessage('❌ CSV file must contain a "strategyTicker" column', 'error');
            setTimeout(() => {
                if (progressSection) progressSection.style.display = 'none';
            }, 1500);
            return;
        }

        // Add delay before next step
        await new Promise(resolve => setTimeout(resolve, 300));
        this.updateProgress(50, 'Processing records...');

        // Count unique strategyTicker values
        const uniqueTickers = new Set();
        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',');
            const ticker = values[strategyTickerIndex]?.trim();
            if (ticker && ticker !== '') {
                uniqueTickers.add(ticker);
            }
        }

        const totalPublicPortfolios = uniqueTickers.size;
        console.log(`✅ Found ${totalPublicPortfolios} unique public portfolios`);

        // Add delay before next step
        await new Promise(resolve => setTimeout(resolve, 300));
        this.updateProgress(70, 'Refreshing table...');

        // Update only the total_public_portfolios field, keep other metrics unchanged
        const existingMetrics = await this.loadMarketingMetrics();
        const updatedMetrics = {
            avg_monthly_copies: existingMetrics?.avg_monthly_copies || null,
            total_investments: existingMetrics?.total_investments || null,
            total_public_portfolios: totalPublicPortfolios,
            total_market_beating_portfolios: existingMetrics?.total_market_beating_portfolios || null
        };

        await this.saveMarketingMetrics(updatedMetrics);

        // Refresh display to show updated portfolio count (won't fetch Mixpanel, just displays stored data)
        await this.displayMarketingMetrics();

        // Save updated summary tab HTML to cache (so marketing metrics persist on refresh)
        this.saveToUnifiedCache();

        // Final delay to show completion
        await new Promise(resolve => setTimeout(resolve, 300));
        this.updateProgress(100, 'Complete!');

        this.addStatusMessage(`✅ Uploaded ${file.name} (${totalPublicPortfolios} public portfolios)`, 'success');

        // Hide progress bar after 1.5 seconds
        setTimeout(() => {
            if (progressSection) {
                progressSection.style.display = 'none';
            }
        }, 1500);
    } catch (error) {
        console.error('Error processing CSV:', error);
        this.addStatusMessage('❌ Error processing CSV file. Check console for details.', 'error');

        // Hide progress bar on error
        setTimeout(() => {
            const progressSection = document.getElementById('unifiedProgressSection');
            if (progressSection) {
                progressSection.style.display = 'none';
            }
        }, 1500);
    }
};

/**
 * Process total investments CSV and calculate Total Investments
 */
UserAnalysisToolSupabase.prototype.processTotalInvestmentsCSV = async function(file) {
    try {
        this.clearStatus();

        // Show the unified progress bar
        const progressSection = document.getElementById('unifiedProgressSection');
        if (progressSection) {
            progressSection.style.display = 'block';
        }

        this.showProgress(0);
        this.updateProgress(10, `Uploading ${file.name}...`);
        console.log('Processing total investments CSV...');

        // Add small delay to ensure progress bar is visible
        await new Promise(resolve => setTimeout(resolve, 400));

        const text = await file.text();
        // Handle different line endings (Windows \r\n, Unix \n, Mac \r)
        const lines = text.split(/\r?\n/).filter(line => line.trim());

        console.log(`CSV file has ${lines.length} lines (after filtering empty lines)`);
        console.log('First few lines:', lines.slice(0, 3));

        if (lines.length < 2) {
            this.addStatusMessage(`❌ CSV file appears to be empty or invalid (found ${lines.length} lines)`, 'error');
            setTimeout(() => {
                if (progressSection) progressSection.style.display = 'none';
            }, 1500);
            return;
        }

        this.updateProgress(30, 'Processing records...');

        // Helper function to parse CSV line properly (handles quoted values with commas)
        const parseCSVLine = (line) => {
            const result = [];
            let current = '';
            let inQuotes = false;

            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                if (char === '"') {
                    inQuotes = !inQuotes;
                } else if (char === ',' && !inQuotes) {
                    result.push(current.trim());
                    current = '';
                } else {
                    current += char;
                }
            }
            result.push(current.trim());
            return result;
        };

        // Parse header
        const headers = parseCSVLine(lines[0]);
        console.log('Headers:', headers);

        const valueIndex = headers.findIndex(h => h.toLowerCase() === 'value');

        if (valueIndex === -1) {
            this.addStatusMessage('❌ CSV file must contain a "Value" column', 'error');
            setTimeout(() => {
                if (progressSection) progressSection.style.display = 'none';
            }, 1500);
            return;
        }

        // Add delay before next step
        await new Promise(resolve => setTimeout(resolve, 300));
        this.updateProgress(50, 'Extracting Total Investments value...');

        // Get the value from the first data row (row index 1)
        const dataLine = lines[1];
        console.log('Data line:', dataLine);

        const values = parseCSVLine(dataLine);
        console.log('Parsed values:', values);
        console.log('Value Index:', valueIndex);

        const totalInvestmentsValue = values[valueIndex]?.trim() || '0';
        console.log('Total Investments Value (raw):', totalInvestmentsValue);

        // Remove commas from the numeric value
        const cleanedValue = totalInvestmentsValue.replace(/,/g, '');
        console.log('Cleaned value:', cleanedValue);

        const totalInvestments = parseFloat(cleanedValue);

        if (isNaN(totalInvestments) || totalInvestments === 0) {
            this.addStatusMessage(`❌ Could not parse Total Investments value (got: "${totalInvestmentsValue}")`, 'error');
            setTimeout(() => {
                if (progressSection) progressSection.style.display = 'none';
            }, 1500);
            return;
        }

        console.log(`✅ Calculated Total Investments: $${totalInvestments.toLocaleString()}`);

        // Add delay before next step
        await new Promise(resolve => setTimeout(resolve, 300));
        this.updateProgress(70, 'Refreshing table...');

        // Update only the total_investments field, keep other metrics unchanged
        const existingMetrics = await this.loadMarketingMetrics();
        const updatedMetrics = {
            avg_monthly_copies: existingMetrics?.avg_monthly_copies || null,
            total_investments: totalInvestments,
            total_public_portfolios: existingMetrics?.total_public_portfolios || null,
            total_market_beating_portfolios: existingMetrics?.total_market_beating_portfolios || null
        };

        await this.saveMarketingMetrics(updatedMetrics);

        // Refresh display to show updated total investments (won't fetch Mixpanel, just displays stored data)
        await this.displayMarketingMetrics();

        // Save updated summary tab HTML to cache (so marketing metrics persist on refresh)
        this.saveToUnifiedCache();

        // Final delay to show completion
        await new Promise(resolve => setTimeout(resolve, 300));
        this.updateProgress(100, 'Complete!');

        this.addStatusMessage(`✅ Uploaded ${file.name} ($${totalInvestments.toLocaleString()} total investments)`, 'success');

        // Hide progress bar after 1.5 seconds
        setTimeout(() => {
            if (progressSection) {
                progressSection.style.display = 'none';
            }
        }, 1500);
    } catch (error) {
        console.error('Error processing total investments CSV:', error);
        this.addStatusMessage('❌ Error processing CSV file. Check console for details.', 'error');

        // Hide progress bar on error
        setTimeout(() => {
            const progressSection = document.getElementById('unifiedProgressSection');
            if (progressSection) {
                progressSection.style.display = 'none';
            }
        }, 1500);
    }
};

/**
 * Display Top Subscription Drivers in the Subscriptions tab
 * Loads data from subscription_drivers table (populated during sync)
 */
UserAnalysisToolSupabase.prototype.displayTopSubscriptionDrivers = async function() {
    try {
        if (!this.supabaseIntegration) {
            console.error('Supabase not configured');
            return;
        }

        const contentDiv = document.getElementById('subscriptions-behavioral-tab');
        if (!contentDiv) {
            console.warn('Subscriptions behavioral tab not found');
            return;
        }

        // Fetch subscription drivers from database table
        const { data: driversData, error: driversError } = await this.supabaseIntegration.supabase
            .from('subscription_drivers')
            .select('*');

        if (driversError) {
            console.error('Error fetching subscription drivers:', driversError);
            console.error('Full error details:', JSON.stringify(driversError));
            contentDiv.innerHTML = `
                <p style="color: #dc3545;">Error loading subscription drivers. Please check console for details.</p>
            `;
            return;
        }

        console.log(`📊 Fetched ${driversData?.length || 0} subscription drivers from database`);

        if (!driversData || driversData.length === 0) {
            console.warn('No subscription drivers data available.');
            contentDiv.innerHTML = '';
            return;
        }

        // Sort by absolute correlation coefficient (descending) for proper predictive strength ordering
        driversData.sort((a, b) => {
            const absA = Math.abs(parseFloat(a.correlation_coefficient) || 0);
            const absB = Math.abs(parseFloat(b.correlation_coefficient) || 0);
            return absB - absA;
        });

        console.log('Top 5 subscription drivers:', driversData.slice(0, 5).map(d => ({
            variable: d.variable_name,
            correlation: d.correlation_coefficient,
            strength: d.predictive_strength
        })));

        // Clear existing content to prevent duplicates (same pattern as deposits/copies tabs)
        contentDiv.innerHTML = '';

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
                <th style="text-align: right;">Tipping Point</th>
            </tr>
        `;
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        driversData.slice(0, 10).forEach(row => {
            const tr = document.createElement('tr');

            // Variable cell - use getVariableLabel for consistent formatting
            const varCell = document.createElement('td');
            const displayName = window.getVariableLabel?.(row.variable_name) || row.variable_name;
            varCell.textContent = displayName;
            varCell.style.width = '200px'; // Consistent variable column width across all tables
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

            // Tipping Point cell
            const tpCell = document.createElement('td');
            tpCell.style.textAlign = 'right';
            tpCell.textContent = row.tipping_point || 'N/A';
            tr.appendChild(tpCell);

            tbody.appendChild(tr);
        });
        table.appendChild(tbody);

        tableWrapper.appendChild(table);
        contentDiv.appendChild(tableWrapper);

        // Also display subscription conversion paths below the drivers table
        await this.displaySubscriptionConversionPaths();

    } catch (error) {
        console.error('Error in displayTopSubscriptionDrivers:', error);
    }
};

/**
 * Display Subscription Conversion Paths
 * Shows UNIFIED creator + portfolio viewing patterns before subscription
 * Queries subscription_path_analysis table (DB combines creator & portfolio views by timestamp)
 */
UserAnalysisToolSupabase.prototype.displaySubscriptionConversionPaths = async function() {
    try {
        if (!this.supabaseIntegration) {
            console.error('Supabase not configured');
            return;
        }

        const contentDiv = document.getElementById('subscriptions-behavioral-tab');
        if (!contentDiv) {
            console.warn('Subscriptions behavioral tab not found');
            return;
        }

        // Fetch unified subscription path data
        const { data, error } = await this.supabaseIntegration.supabase
            .from('subscription_path_analysis')
            .select('*')
            .order('converter_count', { ascending: false });

        if (error) {
            console.error('Error fetching subscription paths:', error);
            return;
        }

        console.log(`📊 Fetched ${data?.length || 0} unified subscription paths`);

        // Filter by analysis type
        const combinations = data.filter(r => r.analysis_type === 'combinations');
        const sequences = data.filter(r => r.analysis_type === 'full_sequence');

        // Build HTML for the section
        let html = `
            <div style="margin-top: 2rem;">
                <h3 style="margin: 0 0 0.5rem 0; color: #333; font-size: 1.1rem;">Subscription Conversion Paths</h3>
                <p style="color: #6c757d; font-size: 0.9rem; margin-bottom: 1.5rem;">
                    Combined creator and portfolio viewing patterns before first subscription
                </p>
        `;

        // Check if we have any data
        if (combinations.length === 0 && sequences.length === 0) {
            html += `
                <p style="color: #6c757d; padding: 20px; background: #f8f9fa; border-radius: 8px;">
                    No subscription conversion path data available. Run the subscription sequence analysis to generate this data.
                </p>
            `;
        } else {
            // Build 2-column grid layout (equal width)
            html += `<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">`;

            // Top Creator/Portfolio Combinations Section
            if (combinations.length > 0) {
                html += `
                    <div style="background: #f8f9fa; padding: 1rem; border-radius: 8px;">
                        <h4 style="margin: 0 0 12px 0; color: #333; font-size: 0.875rem; font-weight: 600;">Top Creator/Portfolio Combinations</h4>
                        <div class="combinations-list">
                `;

                combinations.forEach((item, index) => {
                    const itemSet = item.view_sequence.join(', ');
                    const pct = parseFloat(item.pct_of_converters);

                    html += `
                        <div style="display: flex; gap: 12px; padding: 6px 0; font-size: 0.875rem;">
                            <span style="min-width: 20px; color: #6c757d;">${index + 1}.</span>
                            <span style="flex: 2; color: #495057;">${itemSet}</span>
                            <span style="min-width: 60px; text-align: right; font-weight: 500;">${pct}%</span>
                        </div>
                    `;
                });

                html += `
                        </div>
                    </div>
                `;
            }

            // Most Common Sequences Section
            if (sequences.length > 0) {
                html += `
                    <div style="background: #f8f9fa; padding: 1rem; border-radius: 8px;">
                        <h4 style="margin: 0 0 12px 0; color: #333; font-size: 0.875rem; font-weight: 600;">Most Common Sequences</h4>
                        <div class="paths-list">
                `;

                sequences.forEach((item, index) => {
                    const pathStr = item.view_sequence.join(' → ');
                    const pct = parseFloat(item.pct_of_converters);

                    html += `
                        <div style="display: flex; gap: 12px; padding: 6px 0; font-size: 0.875rem;">
                            <span style="min-width: 20px; color: #6c757d;">${index + 1}.</span>
                            <span style="flex: 2; color: #495057;">${pathStr}</span>
                            <span style="min-width: 60px; text-align: right; font-weight: 500;">${pct}%</span>
                        </div>
                    `;
                });

                html += `
                        </div>
                    </div>
                `;
            }

            html += `</div>`; // Close grid
        }

        html += `</div>`; // Close main container

        // Append to content div (after subscription drivers table)
        contentDiv.insertAdjacentHTML('beforeend', html);

    } catch (error) {
        console.error('Error in displaySubscriptionConversionPaths:', error);
    }
};

/**
 * Display Top Deposit Drivers
 * Loads data from deposit_drivers table (populated during sync)
 */
UserAnalysisToolSupabase.prototype.displayTopDepositDrivers = async function() {
    try {
        if (!this.supabaseIntegration) {
            console.error('Supabase not configured');
            return;
        }

        const contentDiv = document.getElementById('deposits-behavioral-tab');
        if (!contentDiv) {
            console.warn('Deposits behavioral tab not found');
            return;
        }

        // Fetch deposit drivers from database table
        const { data: driversData, error: driversError } = await this.supabaseIntegration.supabase
            .from('deposit_drivers')
            .select('*');

        if (driversError) {
            console.error('Error fetching deposit drivers:', driversError);
            contentDiv.innerHTML = `
                <p style="color: #dc3545;">Error loading deposit drivers. Please check console for details.</p>
            `;
            return;
        }

        console.log(`📊 Fetched ${driversData?.length || 0} deposit drivers from database`);

        if (!driversData || driversData.length === 0) {
            console.warn('No deposit drivers data available.');
            contentDiv.innerHTML = '';
            return;
        }

        // Sort by absolute correlation coefficient (descending)
        driversData.sort((a, b) => {
            const absA = Math.abs(parseFloat(a.correlation_coefficient) || 0);
            const absB = Math.abs(parseFloat(b.correlation_coefficient) || 0);
            return absB - absA;
        });

        // Clear existing content
        contentDiv.innerHTML = '';

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
                <th style="text-align: right;">Tipping Point</th>
            </tr>
        `;
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        driversData.slice(0, 10).forEach(row => {
            const tr = document.createElement('tr');

            // Variable cell
            const varCell = document.createElement('td');
            const displayName = window.getVariableLabel?.(row.variable_name) || row.variable_name;
            varCell.textContent = displayName;
            varCell.style.width = '200px';
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

            // Predictive Strength cell
            const strengthCell = document.createElement('td');
            strengthCell.style.textAlign = 'right';
            const strengthValue = row.predictive_strength || 'N/A';

            const result = window.calculatePredictiveStrength?.(
                parseFloat(row.correlation_coefficient),
                parseFloat(row.t_stat)
            ) || { strength: strengthValue, className: '' };

            const strengthSpan = document.createElement('span');
            strengthSpan.className = result.className;
            strengthSpan.textContent = result.strength;
            strengthCell.appendChild(strengthSpan);
            tr.appendChild(strengthCell);

            // Tipping Point cell
            const tpCell = document.createElement('td');
            tpCell.style.textAlign = 'right';
            tpCell.textContent = row.tipping_point || 'N/A';
            tr.appendChild(tpCell);

            tbody.appendChild(tr);
        });
        table.appendChild(tbody);

        tableWrapper.appendChild(table);
        contentDiv.appendChild(tableWrapper);

    } catch (error) {
        console.error('Error in displayTopDepositDrivers:', error);
    }
};

/**
 * Display Top Copy Drivers
 * Loads data from copy_drivers table (populated during sync)
 */
UserAnalysisToolSupabase.prototype.displayTopCopyDrivers = async function() {
    try {
        if (!this.supabaseIntegration) {
            console.error('Supabase not configured');
            return;
        }

        const contentDiv = document.getElementById('copies-behavioral-tab');
        if (!contentDiv) {
            console.warn('Copies behavioral tab not found');
            return;
        }

        // Fetch copy drivers from database table
        const { data: driversData, error: driversError } = await this.supabaseIntegration.supabase
            .from('copy_drivers')
            .select('*');

        if (driversError) {
            console.error('Error fetching copy drivers:', driversError);
            contentDiv.innerHTML = `
                <p style="color: #dc3545;">Error loading copy drivers. Please check console for details.</p>
            `;
            return;
        }

        console.log(`📊 Fetched ${driversData?.length || 0} copy drivers from database`);

        if (!driversData || driversData.length === 0) {
            console.warn('No copy drivers data available.');
            contentDiv.innerHTML = '';
            return;
        }

        // Sort by absolute correlation coefficient (descending)
        driversData.sort((a, b) => {
            const absA = Math.abs(parseFloat(a.correlation_coefficient) || 0);
            const absB = Math.abs(parseFloat(b.correlation_coefficient) || 0);
            return absB - absA;
        });

        // Clear existing content
        contentDiv.innerHTML = '';

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
                <th style="text-align: right;">Tipping Point</th>
            </tr>
        `;
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        driversData.slice(0, 10).forEach(row => {
            const tr = document.createElement('tr');

            // Variable cell
            const varCell = document.createElement('td');
            const displayName = window.getVariableLabel?.(row.variable_name) || row.variable_name;
            varCell.textContent = displayName;
            varCell.style.width = '200px';
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

            // Predictive Strength cell
            const strengthCell = document.createElement('td');
            strengthCell.style.textAlign = 'right';
            const strengthValue = row.predictive_strength || 'N/A';

            const result = window.calculatePredictiveStrength?.(
                parseFloat(row.correlation_coefficient),
                parseFloat(row.t_stat)
            ) || { strength: strengthValue, className: '' };

            const strengthSpan = document.createElement('span');
            strengthSpan.className = result.className;
            strengthSpan.textContent = result.strength;
            strengthCell.appendChild(strengthSpan);
            tr.appendChild(strengthCell);

            // Tipping Point cell
            const tpCell = document.createElement('td');
            tpCell.style.textAlign = 'right';
            tpCell.textContent = row.tipping_point || 'N/A';
            tr.appendChild(tpCell);

            tbody.appendChild(tr);
        });
        table.appendChild(tbody);

        tableWrapper.appendChild(table);
        contentDiv.appendChild(tableWrapper);

    } catch (error) {
        console.error('Error in displayTopCopyDrivers:', error);
    }
};

console.log('✅ User Analysis Tool (Supabase) loaded successfully!');
