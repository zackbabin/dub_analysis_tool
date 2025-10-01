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
}

// Export to window
window.CreatorAnalysisToolSupabase = CreatorAnalysisToolSupabase;

console.log('✅ Creator Analysis Tool (Supabase) loaded successfully!');
