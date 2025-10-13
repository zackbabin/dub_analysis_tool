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

        // Clear old cached results (cache version bump to force refresh)
        const CACHE_VERSION = 'v3'; // Increment this to invalidate old cache
        const cachedVersion = localStorage.getItem('creatorAnalysisCacheVersion');
        if (cachedVersion !== CACHE_VERSION) {
            localStorage.removeItem('creatorAnalysisResults');
            localStorage.setItem('creatorAnalysisCacheVersion', CACHE_VERSION);
            console.log('Cleared old creator analysis cache');
        }

        // Call parent to create base UI
        super.createUI(container, outputContainer);

        // Remove borders and padding from wrapper since data source buttons are in separate component
        const wrapper = container.querySelector('.qda-inline-widget');
        if (wrapper) {
            wrapper.style.border = 'none';
            wrapper.style.padding = '0';
            wrapper.style.background = 'transparent';
        }

        // Also remove padding from content div to avoid empty space
        const content = container.querySelector('.qda-content');
        if (content) {
            content.style.padding = '0';
        }
    }

    /**
     * Override: Create mode section - Only create upload section (buttons are in unified component)
     */
    createModeSection() {
        const section = document.createElement('div');
        section.id = 'creatorModeSection';
        section.style.display = 'none'; // Hide entire section by default

        // File upload section (hidden by default) - Now supports 3 files
        const uploadSection = document.createElement('div');
        uploadSection.id = 'creatorUploadSection';
        uploadSection.style.cssText = 'border: 2px dashed #17a2b8; border-radius: 8px; padding: 20px; background: #f8f9fa; margin-top: 15px;';
        uploadSection.innerHTML = `
            <div style="text-align: left;">
                <div style="font-weight: bold; color: #333; margin-bottom: 15px; text-align: center;">
                    Upload 3 CSV Files for Merging
                </div>
                <div style="font-size: 12px; color: #6c757d; margin-bottom: 20px; text-align: center;">
                    Files will be merged using two-stage matching: Deals→Creator List (by name), then merge with Public Creators (by email)
                </div>

                <label style="font-weight: bold; color: #333; display: block; margin-bottom: 5px;">
                    1. Creator List CSV
                </label>
                <div style="font-size: 11px; color: #6c757d; margin-bottom: 5px;">
                    Contains: Name, Registered dub Account Email, Premium: Name of Fund
                </div>
                <input type="file" id="creatorListFileInput" accept=".csv" style="padding: 8px; border: 1px solid #ddd; border-radius: 4px; width: 100%; margin-bottom: 15px;">

                <label style="font-weight: bold; color: #333; display: block; margin-bottom: 5px;">
                    2. Deals CSV
                </label>
                <div style="font-size: 11px; color: #6c757d; margin-bottom: 5px;">
                    Contains: Deal-Title, Deal-Organization, Deal-Contact Person
                </div>
                <input type="file" id="dealsFileInput" accept=".csv" style="padding: 8px; border: 1px solid #ddd; border-radius: 4px; width: 100%; margin-bottom: 15px;">

                <label style="font-weight: bold; color: #333; display: block; margin-bottom: 5px;">
                    3. Public Creators CSV
                </label>
                <div style="font-size: 11px; color: #6c757d; margin-bottom: 5px;">
                    Contains: email, firstname, lastname, displayname, handle, description
                </div>
                <input type="file" id="publicCreatorsFileInput" accept=".csv" style="padding: 8px; border: 1px solid #ddd; border-radius: 4px; width: 100%; margin-bottom: 15px;">

                <button id="creatorProcessButton" class="qda-btn" style="display: block; width: 100%; margin-top: 10px;">
                    Process Files
                </button>
            </div>
        `;
        section.appendChild(uploadSection);

        return section;
    }

    /**
     * Override: Display results - Skip breakdown section, only show summary and behavioral analysis
     */
    displayResults(results) {
        // Clear output container
        this.outputContainer.innerHTML = '';

        // Create results div
        const resultsDiv = document.createElement('div');
        resultsDiv.id = 'creatorAnalysisResultsInline';
        resultsDiv.className = 'qda-analysis-results';
        this.outputContainer.appendChild(resultsDiv);

        // Add timestamp
        const timestamp = document.createElement('div');
        timestamp.className = 'qda-timestamp';

        const analysisData = JSON.parse(localStorage.getItem('creatorAnalysisResults') || '{}');
        const lastUpdated = analysisData.lastUpdated;
        if (lastUpdated) {
            timestamp.textContent = `Last updated: ${lastUpdated}`;
            resultsDiv.appendChild(timestamp);
        }

        // Create containers - SKIP creatorBreakdownInline
        resultsDiv.innerHTML += `
            <div id="creatorSummaryStatsInline"></div>
            <div id="creatorBehavioralAnalysisInline"></div>
        `;

        // Display results - SKIP displayCreatorBreakdown
        this.displayCreatorSummaryStats(results.summaryStats);

        const tippingPoints = analysisData.tippingPoints;
        this.displayCreatorBehavioralAnalysis(results.correlationResults, results.regressionResults, tippingPoints);

        resultsDiv.style.display = 'block';

        // Save HTML for restoration
        this.saveAnalysisResults(this.outputContainer.innerHTML);
    }

    /**
     * Process and analyze creator data directly from database (no CSV conversion)
     */
    async processAndAnalyzeDirect(creatorData) {
        try {
            console.log('=== Processing Creator Data Directly ===');
            console.log(`Raw data from database: ${creatorData.length} rows`);

            // Clean and transform data
            this.updateProgress(60, 'Cleaning data...');
            const cleanData = this.cleanCreatorDataDirect(creatorData);
            console.log(`Cleaned data: ${cleanData.length} rows`);

            // Run analysis
            this.updateProgress(75, 'Analyzing data...');
            const results = this.performCreatorAnalysis(cleanData);

            this.updateProgress(90, 'Generating insights...');

            // Calculate tipping points
            const tippingPoints = this.calculateAllTippingPoints(results.cleanData, results.correlationResults);

            // Clear cleanData reference to free memory
            results.cleanData = null;

            // Save results to localStorage
            const now = new Date();
            const timestamp = now.toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            });

            localStorage.setItem('creatorAnalysisResults', JSON.stringify({
                summaryStats: results.summaryStats,
                correlationResults: results.correlationResults,
                regressionResults: results.regressionResults,
                tippingPoints: tippingPoints,
                lastUpdated: timestamp
            }));

            // Display results
            this.displayResults(results);

            this.updateProgress(100, 'Complete!');

            // Hide progress bar after completion
            setTimeout(() => {
                const progressSection = document.getElementById('creatorProgressSection');
                if (progressSection) {
                    progressSection.style.display = 'none';
                }
            }, 2000);
        } catch (error) {
            console.error('Error in processAndAnalyzeDirect:', error);
            throw error;
        }
    }

    /**
     * Clean creator data directly from database objects (no CSV parsing needed)
     */
    cleanCreatorDataDirect(data) {
        console.log(`=== Cleaning Creator Data (Direct) ===`);
        console.log(`Input rows: ${data.length}`);

        const cleanedRows = data.map(row => {
            // Parse raw_data JSONB
            const rawData = row.raw_data || {};

            const cleanRow = {
                // Identifiers
                email: row.email || '',
                creatorUsername: row.creator_username || '',

                // Type from top-level column in view
                type: row.type || 'Regular',

                // Target variables from top-level columns
                totalCopies: this.cleanNumeric(row.total_copies),
                totalSubscriptions: this.cleanNumeric(row.total_subscriptions)
            };

            // Add ALL fields from raw_data JSONB (includes uploaded fields + Mixpanel enrichment)
            Object.keys(rawData).forEach(key => {
                // Skip fields we've already handled
                if (key === 'type' || key === 'email') return;

                const value = rawData[key];

                // Try to parse as numeric
                const numericValue = this.cleanNumeric(value);

                // Include numeric fields (even if 0/null for correlation analysis)
                if (typeof value === 'number' || !isNaN(parseFloat(value)) || value === null || value === undefined || value === '') {
                    cleanRow[key] = numericValue;
                }
                // Include string fields
                else if (typeof value === 'string') {
                    cleanRow[key] = value;
                }
            });

            return cleanRow;
        });

        const filteredRows = cleanedRows.filter(row => row.email || row.creatorUsername);
        console.log(`After filtering (must have email or username): ${filteredRows.length}`);

        return filteredRows;
    }

    /**
     * Override: Process and analyze data (skip parent's progress hiding)
     * LEGACY: Still used if CSV path is taken
     */
    async processAndAnalyze(csvContent) {
        try {
            // Parse CSV
            this.updateProgress(50, 'Parsing data...');
            console.log('Parsing CSV content, length:', csvContent?.length);
            const parsedData = this.parseCSV(csvContent);
            console.log('Parsed data rows:', parsedData?.data?.length);
            console.log('CSV headers:', parsedData?.headers);
            console.log('First 2 rows:', parsedData?.data?.slice(0, 2));

            // Clean and transform data
            this.updateProgress(60, 'Cleaning data...');
            const cleanData = this.cleanCreatorData(parsedData);
            console.log('Cleaned data rows:', cleanData?.length);

            // Run analysis
            this.updateProgress(75, 'Analyzing data...');
            const results = this.performCreatorAnalysis(cleanData);

            this.updateProgress(90, 'Generating insights...');

            // Calculate tipping points
            const tippingPoints = this.calculateAllTippingPoints(results.cleanData, results.correlationResults);

            // Clear cleanData reference to free memory
            results.cleanData = null;

            // Save results to localStorage
            const now = new Date();
            const timestamp = now.toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            });

            localStorage.setItem('creatorAnalysisResults', JSON.stringify({
                summaryStats: results.summaryStats,
                correlationResults: results.correlationResults,
                regressionResults: results.regressionResults,
                tippingPoints: tippingPoints,
                lastUpdated: timestamp
            }));

            // Display results
            this.displayResults(results);

            this.updateProgress(100, 'Complete!');

            // Hide progress bar after completion (with safety check)
            setTimeout(() => {
                const progressSection = document.getElementById('creatorProgressSection');
                if (progressSection) {
                    progressSection.style.display = 'none';
                }
            }, 2000);
        } catch (error) {
            console.error('Error in processAndAnalyze:', error);
            throw error;
        }
    }

    /**
     * Override: runWorkflow to handle progress bar properly for upload mode
     */
    async runWorkflow(mode) {
        if (mode === 'upload') {
            // For upload mode, don't show progress bar or clear status yet
            this.showUploadSection();
        } else {
            // For sync mode, use default behavior
            await super.runWorkflow(mode);
        }
    }

    /**
     * Override: Show the upload section with 3 file inputs
     */
    showUploadSection() {
        // Hide progress bar (shouldn't be visible yet)
        const progressSection = document.getElementById('creatorProgressSection');
        if (progressSection) {
            progressSection.style.display = 'none';
        }

        // Show the entire mode section first
        const modeSection = document.getElementById('creatorModeSection');
        if (modeSection) {
            modeSection.style.display = 'block';
        }

        // Upload section should already be visible as child of mode section
        const uploadSection = document.getElementById('creatorUploadSection');
        if (uploadSection) {
            console.log('✅ Upload section displayed');
        } else {
            console.error('❌ Upload section not found! Element ID: creatorUploadSection');
        }
    }

    /**
     * Override: Run the upload workflow using Supabase with 3 files
     */
    async runUploadWorkflow() {
        if (!this.supabaseIntegration) {
            throw new Error('Supabase not configured. Please check your configuration.');
        }

        try {
            // Hide entire mode section (including upload section)
            const modeSection = document.getElementById('creatorModeSection');
            if (modeSection) {
                modeSection.style.display = 'none';
            }

            // Also hide the data source buttons during upload/processing
            const dataSourceDiv = document.getElementById('creatorDataSource');
            if (dataSourceDiv) {
                dataSourceDiv.style.display = 'none';
            }

            // Show progress bar
            this.clearStatus();
            this.showProgress(0);

            // Get the 3 file inputs
            const creatorListInput = document.getElementById('creatorListFileInput');
            const dealsInput = document.getElementById('dealsFileInput');
            const publicCreatorsInput = document.getElementById('publicCreatorsFileInput');

            if (!creatorListInput.files[0] || !dealsInput.files[0] || !publicCreatorsInput.files[0]) {
                throw new Error('Please select all 3 CSV files before processing');
            }

            this.updateProgress(20, 'Reading files...');

            // Read all 3 files
            const creatorListCsv = await this.readFileAsText(creatorListInput.files[0]);
            const dealsCsv = await this.readFileAsText(dealsInput.files[0]);
            const publicCreatorsCsv = await this.readFileAsText(publicCreatorsInput.files[0]);

            this.updateProgress(40, 'Merging and processing files...');

            // Upload and merge through Supabase Edge Function
            const result = await this.supabaseIntegration.uploadAndMergeCreatorFiles(
                creatorListCsv,
                dealsCsv,
                publicCreatorsCsv
            );

            if (!result || !result.success) {
                throw new Error(result?.error || 'Failed to upload and merge creator files');
            }

            console.log('✅ Creator files merged:', result.stats);
            this.updateProgress(100, 'Upload complete!');

            // Hide progress bar
            setTimeout(() => {
                const progressSection = document.getElementById('creatorProgressSection');
                if (progressSection) {
                    progressSection.style.display = 'none';
                }
            }, 1000);

            // Show simple success message with sync button
            this.outputContainer.innerHTML = '';
            const successDiv = document.createElement('div');
            successDiv.className = 'qda-analysis-results';
            successDiv.innerHTML = `
                <div style="padding: 40px; text-align: center;">
                    <div style="font-size: 64px; margin-bottom: 20px;">✅</div>
                    <h3 style="color: #28a745; margin: 0 0 15px 0; font-size: 24px;">Files Uploaded Successfully</h3>
                    <p style="color: #666; margin: 0 0 30px 0; font-size: 16px;">
                        ${result.stats.inserted || 0} creators uploaded and ready for enrichment
                    </p>
                    <button id="syncAfterUploadBtn" class="qda-btn" style="padding: 14px 40px; font-size: 16px; background: #28a745;">
                        Sync Live Data
                    </button>
                </div>
            `;
            this.outputContainer.appendChild(successDiv);

            // Attach click handler to sync button
            const syncBtn = document.getElementById('syncAfterUploadBtn');
            if (syncBtn) {
                syncBtn.onclick = async () => {
                    // Clear the success message and run sync + analyze workflow
                    this.outputContainer.innerHTML = '';
                    await this.runSyncAndAnalyzeWorkflow();
                };
            }
        } catch (error) {
            console.error('Upload workflow error:', error);
            // Show progress section for error display
            const progressSection = document.getElementById('creatorProgressSection');
            if (progressSection) {
                progressSection.style.display = 'none';
            }
            throw error;
        }
    }

    /**
     * Parse and clean creator CSV data
     * Renames columns, cleans headers, stores all data in raw_data JSONB
     */
    parseAndCleanCreatorCSV(csvContent) {
        // Use the shared CSV parser which handles quoted fields properly
        const parsedCSV = window.CSVUtils.parseCSV(csvContent);

        if (!parsedCSV || !parsedCSV.data || parsedCSV.data.length === 0) {
            throw new Error('CSV file is empty or invalid');
        }

        const rawHeaders = parsedCSV.headers;
        const cleanedHeaders = rawHeaders.map(header =>
            header
                .trim()
                .toLowerCase()
                .replace(/^report\d+:\s*/i, '') // Remove "report#:" prefix
                .replace(/[^a-z0-9_]/g, '_') // Replace non-alphanumeric with underscore
                .replace(/_+/g, '_') // Replace multiple underscores with single
                .replace(/^_|_$/g, '') // Remove leading/trailing underscores
        );

        console.log('Original headers:', rawHeaders);
        console.log('Cleaned headers:', cleanedHeaders);

        // Columns to drop
        const columnsTosDrop = ['email', 'phone', 'createdby', 'cancelledat', 'sketchinvestigationresultid'];

        // Find important column indices
        const handleIndex = cleanedHeaders.findIndex(h => h === 'handle');
        const useruuidIndex = cleanedHeaders.findIndex(h => h === 'useruuid');
        const descriptionIndex = cleanedHeaders.findIndex(h => h === 'description');
        const birthdateIndex = cleanedHeaders.findIndex(h => h === 'birthdate');

        if (handleIndex === -1) {
            throw new Error('CSV must contain "handle" column');
        }
        if (useruuidIndex === -1) {
            throw new Error('CSV must contain "useruuid" column');
        }

        // Process each data row
        const cleanedData = [];
        parsedCSV.data.forEach((row, index) => {
            // Build raw_data object with all CSV columns (except dropped ones)
            const rawData = {};
            cleanedHeaders.forEach((header, colIndex) => {
                const originalHeader = rawHeaders[colIndex];
                // Skip columns that should be dropped
                if (!columnsTosDrop.includes(header)) {
                    const value = row[originalHeader];
                    rawData[header] = value ? String(value).trim() : null;
                }
            });

            // Calculate description_length
            if (descriptionIndex !== -1) {
                const description = row[rawHeaders[descriptionIndex]] || '';
                rawData.description_length = String(description).length;
            }

            // Calculate age from birthdate
            if (birthdateIndex !== -1) {
                const birthdate = row[rawHeaders[birthdateIndex]];
                if (birthdate) {
                    try {
                        const birthDate = new Date(birthdate);
                        const today = new Date();
                        let age = today.getFullYear() - birthDate.getFullYear();
                        const monthDiff = today.getMonth() - birthDate.getMonth();
                        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
                            age--;
                        }
                        rawData.age = age;
                    } catch (error) {
                        console.warn(`Invalid birthdate format on row ${index + 2}: ${birthdate}`);
                        rawData.age = null;
                    }
                } else {
                    rawData.age = null;
                }
            }

            // Extract creator_username and creator_id
            let creatorUsername = row[rawHeaders[handleIndex]]?.trim();
            const creatorId = row[rawHeaders[useruuidIndex]]?.trim();

            if (!creatorUsername || !creatorId) {
                console.warn(`Skipping row ${index + 2}: missing handle or useruuid`);
                return;
            }

            // Normalize username: ensure it starts with @ to match creators_insights format
            if (!creatorUsername.startsWith('@')) {
                creatorUsername = '@' + creatorUsername;
            }

            cleanedData.push({
                creator_id: creatorId,
                creator_username: creatorUsername,
                raw_data: rawData
            });
        });

        // Deduplicate by creator_username (keep last occurrence)
        const deduped = {};
        const duplicates = {};
        cleanedData.forEach(row => {
            if (deduped[row.creator_username]) {
                duplicates[row.creator_username] = (duplicates[row.creator_username] || 0) + 1;
            }
            deduped[row.creator_username] = row;
        });
        const dedupedArray = Object.values(deduped);

        console.log(`Original rows: ${cleanedData.length}, After deduplication: ${dedupedArray.length}`);
        if (Object.keys(duplicates).length > 0) {
            console.log(`Found ${Object.keys(duplicates).length} usernames with duplicates:`, Object.keys(duplicates).slice(0, 10));
        }

        return dedupedArray;
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
     * New workflow: Sync Mixpanel data + Run analysis + Display results
     * This is called after manual upload to complete the enrichment and analysis
     */
    async runSyncAndAnalyzeWorkflow() {
        if (!this.supabaseIntegration) {
            throw new Error('Supabase not configured. Please check your configuration.');
        }

        this.clearStatus();
        this.showProgress(0);

        try {
            // Step 1: Sync Mixpanel data
            this.updateProgress(20, 'Syncing Mixpanel user profiles...');

            console.log('Triggering Supabase creator enrichment sync...');
            const syncResult = await this.supabaseIntegration.triggerCreatorSync();

            if (!syncResult || !syncResult.success) {
                throw new Error('Failed to sync creator data');
            }

            console.log('✅ Creator enrichment sync completed:', syncResult.stats);
            this.updateProgress(50, 'Loading enriched data...');

            // Step 2: Load merged data from creator_analysis view (as objects, not CSV)
            const creatorData = await this.supabaseIntegration.loadCreatorDataFromSupabase();

            if (!creatorData || creatorData.length === 0) {
                throw new Error('No data returned from database');
            }

            console.log(`✅ Loaded ${creatorData.length} creators from creator_analysis view`);
            this.updateProgress(70, 'Analyzing data...');

            // Step 3: Process and analyze (directly, no CSV conversion)
            await this.processAndAnalyzeDirect(creatorData);

            this.updateProgress(100, 'Complete!');

            // Hide progress bar after completion
            setTimeout(() => {
                const progressSection = document.getElementById('creatorProgressSection');
                if (progressSection) {
                    progressSection.style.display = 'none';
                }
            }, 2000);
        } catch (error) {
            console.error('Sync and analyze workflow error:', error);
            this.addStatusMessage(`❌ Error: ${error.message}`, 'error');
            throw error;
        }
    }

    /**
     * Override: Run the sync workflow using Supabase
     * Only syncs Mixpanel data to creators_insights table - does NOT run analysis
     */
    async runSyncWorkflow() {
        if (!this.supabaseIntegration) {
            throw new Error('Supabase not configured. Please check your configuration.');
        }

        this.clearStatus();
        this.showProgress(0);

        try {
            this.updateProgress(20, 'Syncing Mixpanel data...');

            console.log('Triggering Supabase creator enrichment sync...');
            const result = await this.supabaseIntegration.triggerCreatorSync();

            if (!result || !result.success) {
                throw new Error('Failed to sync creator data');
            }

            console.log('✅ Creator enrichment sync completed:', result.stats);
            this.updateProgress(60, 'Loading creator data...');

            // Load and analyze the creator data from creator_analysis view (as objects, not CSV)
            const creatorData = await this.supabaseIntegration.loadCreatorDataFromSupabase();

            if (!creatorData || creatorData.length === 0) {
                throw new Error('No data returned from database');
            }

            console.log(`✅ Loaded ${creatorData.length} creators from creator_analysis view`);
            this.updateProgress(80, 'Analyzing data...');

            // Process and analyze the data (directly, no CSV conversion)
            await this.processAndAnalyzeDirect(creatorData);

            this.updateProgress(100, 'Complete!');

            // Hide progress bar after completion
            setTimeout(() => {
                const progressSection = document.getElementById('creatorProgressSection');
                if (progressSection) {
                    progressSection.style.display = 'none';
                }
            }, 2000);
        } catch (error) {
            console.error('Sync workflow error:', error);
            this.addStatusMessage(`❌ Sync failed: ${error.message}`, 'error');
            throw error;
        }
    }

}

// Export to window
window.CreatorAnalysisToolSupabase = CreatorAnalysisToolSupabase;

console.log('✅ Creator Analysis Tool (Supabase) loaded successfully!');
