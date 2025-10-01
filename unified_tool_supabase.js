// Unified Analysis Tool - Supabase Version
// Extends UnifiedAnalysisTool to use Supabase instead of GitHub Actions
// Keeps original unified_tool.js intact for backward compatibility

'use strict';

/**
 * Supabase-powered version of UnifiedAnalysisTool
 * Overrides specific methods to use Supabase Edge Functions and database
 */
class UnifiedAnalysisToolSupabase extends UnifiedAnalysisTool {
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
        this.addStatusMessage('🚀 Triggering Supabase Edge Function...', 'info');
        this.updateProgress(10, 'Triggering sync...');

        const triggered = await this.triggerGitHubWorkflow();
        if (!triggered) {
            throw new Error('Failed to trigger Supabase sync');
        }

        this.addStatusMessage('✅ Sync completed successfully', 'success');
        this.updateProgress(40, 'Loading data...');

        // Step 2: Load data from Supabase
        this.addStatusMessage('📥 Loading data from Supabase...', 'info');

        const contents = await this.loadGitHubData();
        this.addStatusMessage('✅ Data loaded', 'success');
        this.updateProgress(60, 'Analyzing data...');

        // Step 3: Process and analyze data
        await this.processAndAnalyze(contents);
    }

    /**
     * Override: Don't add Supabase metadata section
     */
    async displayResults(results) {
        // Just call parent method - no Supabase metadata
        super.displayResults(results);
    }
}

// Export to window
window.UnifiedAnalysisToolSupabase = UnifiedAnalysisToolSupabase;

console.log('✅ Unified Analysis Tool (Supabase) loaded successfully!');
