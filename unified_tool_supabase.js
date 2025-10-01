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

        // Add Supabase status indicator
        this.addSupabaseStatusIndicator();
    }

    /**
     * Override: Create token section for Supabase configuration
     */
    createTokenSection() {
        // If Supabase is already configured globally, show status instead of config form
        if (window.supabaseIntegration) {
            return this.createSupabaseStatusSection();
        }

        const section = document.createElement('div');
        section.style.cssText = 'margin-bottom: 20px; padding: 20px; background: #e7f3ff; border: 1px solid #2196F3; border-radius: 8px;';

        const title = document.createElement('h4');
        title.textContent = '⚙️ Supabase Configuration';
        title.style.cssText = 'margin: 0 0 10px 0; color: #1565C0;';
        section.appendChild(title);

        const description = document.createElement('p');
        description.textContent = 'Enter your Supabase project details below to enable live data sync:';
        description.style.cssText = 'margin: 0 0 15px 0; font-size: 13px; color: #1565C0;';
        section.appendChild(description);

        // Supabase URL input
        const urlContainer = document.createElement('div');
        urlContainer.style.cssText = 'margin-bottom: 10px;';

        const urlLabel = document.createElement('label');
        urlLabel.textContent = 'Supabase URL:';
        urlLabel.style.cssText = 'display: block; font-size: 12px; font-weight: bold; margin-bottom: 5px; color: #1565C0;';
        urlContainer.appendChild(urlLabel);

        const urlInput = document.createElement('input');
        urlInput.type = 'text';
        urlInput.id = 'supabaseUrlInput';
        urlInput.placeholder = 'https://your-project.supabase.co';
        urlInput.style.cssText = 'width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-family: monospace; box-sizing: border-box;';
        urlInput.value = localStorage.getItem('supabase_url') || '';
        urlContainer.appendChild(urlInput);

        section.appendChild(urlContainer);

        // Supabase Anon Key input
        const keyContainer = document.createElement('div');
        keyContainer.style.cssText = 'margin-bottom: 15px;';

        const keyLabel = document.createElement('label');
        keyLabel.textContent = 'Supabase Anon Key:';
        keyLabel.style.cssText = 'display: block; font-size: 12px; font-weight: bold; margin-bottom: 5px; color: #1565C0;';
        keyContainer.appendChild(keyLabel);

        const keyInput = document.createElement('input');
        keyInput.type = 'password';
        keyInput.id = 'supabaseKeyInput';
        keyInput.placeholder = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
        keyInput.style.cssText = 'width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-family: monospace; box-sizing: border-box;';
        keyInput.value = localStorage.getItem('supabase_anon_key') || '';
        keyContainer.appendChild(keyInput);

        section.appendChild(keyContainer);

        // Save button
        const saveBtn = document.createElement('button');
        saveBtn.textContent = 'Save Configuration';
        saveBtn.className = 'qda-btn';
        saveBtn.style.cssText = 'background: #2196F3; width: 100%;';
        saveBtn.onclick = () => {
            const url = urlInput.value.trim();
            const key = keyInput.value.trim();

            if (url && key) {
                localStorage.setItem('supabase_url', url);
                localStorage.setItem('supabase_anon_key', key);

                // Initialize Supabase integration
                try {
                    this.supabaseIntegration = new SupabaseIntegration(url, key);
                    alert('✅ Supabase configuration saved successfully!');
                    this.updateSupabaseStatus(true);
                } catch (error) {
                    alert('❌ Error initializing Supabase: ' + error.message);
                    this.updateSupabaseStatus(false);
                }
            } else {
                alert('❌ Please enter both URL and Anon Key');
            }
        };
        section.appendChild(saveBtn);

        // Help text
        const helpText = document.createElement('div');
        helpText.style.cssText = 'margin-top: 10px; padding: 10px; background: white; border-radius: 4px; font-size: 12px; color: #666;';
        helpText.innerHTML = `
            <strong>Where to find these:</strong><br>
            1. Go to your Supabase project dashboard<br>
            2. Click on "Project Settings" → "API"<br>
            3. Copy "Project URL" and "anon/public" key<br>
            <br>
            <strong>Note:</strong> Mixpanel credentials are stored securely in Supabase secrets, not in the browser.
        `;
        section.appendChild(helpText);

        return section;
    }

    /**
     * Create status section when Supabase is pre-configured
     */
    createSupabaseStatusSection() {
        const section = document.createElement('div');
        section.style.cssText = 'margin-bottom: 20px; padding: 20px; background: #e8f5e9; border: 1px solid #4CAF50; border-radius: 8px;';

        const title = document.createElement('h4');
        title.textContent = '✅ Supabase Connected';
        title.style.cssText = 'margin: 0 0 10px 0; color: #2E7D32;';
        section.appendChild(title);

        const description = document.createElement('p');
        description.textContent = 'Your application is connected to Supabase. Click "Sync Live Data" to fetch the latest data from Mixpanel.';
        description.style.cssText = 'margin: 0; font-size: 13px; color: #2E7D32;';
        section.appendChild(description);

        return section;
    }

    /**
     * Add Supabase status indicator to UI
     */
    addSupabaseStatusIndicator() {
        const statusDiv = document.createElement('div');
        statusDiv.id = 'supabaseStatus';
        statusDiv.style.cssText = 'position: fixed; top: 10px; right: 10px; padding: 8px 15px; background: #ff9800; color: white; border-radius: 20px; font-size: 12px; font-weight: bold; z-index: 1000;';
        statusDiv.textContent = '⚠️ Supabase Not Configured';
        document.body.appendChild(statusDiv);

        // Check if already configured (either globally or in localStorage)
        if (this.supabaseIntegration) {
            this.updateSupabaseStatus(true);
        } else {
            const url = localStorage.getItem('supabase_url');
            const key = localStorage.getItem('supabase_anon_key');

            if (url && key) {
                try {
                    this.supabaseIntegration = new SupabaseIntegration(url, key);
                    this.updateSupabaseStatus(true);
                } catch (error) {
                    console.error('Error initializing Supabase:', error);
                    this.updateSupabaseStatus(false);
                }
            }
        }
    }

    /**
     * Update Supabase status indicator
     */
    updateSupabaseStatus(connected) {
        const statusDiv = document.getElementById('supabaseStatus');
        if (statusDiv) {
            if (connected) {
                statusDiv.style.background = '#4CAF50';
                statusDiv.textContent = '✅ Supabase Connected';
            } else {
                statusDiv.style.background = '#ff9800';
                statusDiv.textContent = '⚠️ Supabase Not Configured';
            }
        }
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
     * Add data freshness info to results
     */
    async displayResults(results) {
        // Call parent method first
        super.displayResults(results);

        // Add Supabase-specific info
        if (this.supabaseIntegration) {
            const freshness = await this.supabaseIntegration.getDataFreshness();
            const syncStatus = await this.supabaseIntegration.getLatestSyncStatus();

            if (freshness || syncStatus) {
                this.addSupabaseMetadata(freshness, syncStatus);
            }
        }
    }

    /**
     * Add Supabase metadata section to results
     */
    addSupabaseMetadata(freshness, syncStatus) {
        const resultsDiv = document.getElementById('qdaAnalysisResultsInline');
        if (!resultsDiv) return;

        const metadataDiv = document.createElement('div');
        metadataDiv.style.cssText = 'margin: 20px 0; padding: 15px; background: #f0f9ff; border-left: 4px solid #2196F3; border-radius: 4px;';

        const title = document.createElement('h4');
        title.textContent = 'Data Source: Supabase';
        title.style.cssText = 'margin: 0 0 10px 0; color: #1565C0;';
        metadataDiv.appendChild(title);

        if (freshness) {
            const freshnessInfo = document.createElement('div');
            freshnessInfo.style.cssText = 'font-size: 13px; color: #333; margin-bottom: 8px;';
            freshnessInfo.innerHTML = `
                <strong>Last Sync:</strong> ${new Date(freshness.last_data_sync).toLocaleString()}<br>
                <strong>Total Users:</strong> ${freshness.total_users?.toLocaleString() || 'N/A'}
            `;
            metadataDiv.appendChild(freshnessInfo);
        }

        if (syncStatus) {
            const statusInfo = document.createElement('div');
            statusInfo.style.cssText = 'font-size: 13px; color: #333;';
            statusInfo.innerHTML = `
                <strong>Sync Duration:</strong> ${syncStatus.duration_seconds ? syncStatus.duration_seconds.toFixed(1) + 's' : 'N/A'}<br>
                <strong>Records Synced:</strong> ${syncStatus.total_records_inserted?.toLocaleString() || 'N/A'}
            `;
            metadataDiv.appendChild(statusInfo);
        }

        // Insert at the top of results
        resultsDiv.insertBefore(metadataDiv, resultsDiv.firstChild);
    }
}

// Export to window
window.UnifiedAnalysisToolSupabase = UnifiedAnalysisToolSupabase;

console.log('✅ Unified Analysis Tool (Supabase) loaded successfully!');
