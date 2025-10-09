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
     * Override: Create mode section - Disable "Sync Live Data" button, enable "Manually Upload Data"
     */
    createModeSection() {
        const section = document.createElement('div');
        section.style.cssText = 'margin-bottom: 20px;';

        const title = document.createElement('h4');
        title.textContent = 'Select Data Source';
        title.style.cssText = 'margin: 0 0 15px 0; color: #333;';
        section.appendChild(title);

        // Mode buttons
        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = 'display: flex; gap: 15px; margin-bottom: 20px; flex-wrap: wrap; justify-content: center;';

        // Sync Live Data button (disabled)
        const syncBtn = this.createModeButton(
            'Sync Live Data',
            'Not available for this analysis',
            '#dee2e6',
            '#6c757d',
            null
        );
        syncBtn.disabled = true;
        syncBtn.style.background = '#f8f9fa';
        syncBtn.style.opacity = '0.6';
        syncBtn.style.cursor = 'not-allowed';
        syncBtn.style.pointerEvents = 'none';
        buttonContainer.appendChild(syncBtn);

        // Manually Upload Data button
        const uploadBtn = this.createModeButton(
            'Manually Upload Data',
            'Upload creator CSV file for analysis',
            '#28a745',
            '#28a745',
            () => this.runWorkflow('upload')
        );
        buttonContainer.appendChild(uploadBtn);

        section.appendChild(buttonContainer);

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
        this.updateProgress(50, 'Loading data...');

        // Step 2: Load data from Supabase
        const contents = await this.supabaseIntegration.loadCreatorDataFromSupabase();
        this.updateProgress(75, 'Processing data...');

        console.log('✅ Data loaded from Supabase');

        // Step 3: Parse and display summary stats only (no correlation analysis)
        const parsedData = this.parseCSV(contents[0]);
        const cleanData = this.cleanCreatorData(parsedData);
        const summaryStats = this.calculateCreatorSummaryStats(cleanData);

        this.updateProgress(90, 'Displaying results...');

        // Display only summary stats and breakdown (no behavioral analysis)
        this.outputContainer.innerHTML = '';
        const resultsDiv = document.createElement('div');
        resultsDiv.id = 'creatorAnalysisResultsInline';
        resultsDiv.className = 'qda-analysis-results';
        this.outputContainer.appendChild(resultsDiv);

        // Add timestamp
        const timestamp = document.createElement('div');
        timestamp.className = 'qda-timestamp';
        const now = new Date();
        const timestampText = now.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
        timestamp.textContent = `Last updated: ${timestampText}`;
        resultsDiv.appendChild(timestamp);

        resultsDiv.innerHTML += `
            <div id="creatorSummaryStatsInline"></div>
        `;

        this.displayCreatorSummaryStats(summaryStats);

        // Add note about correlation analysis
        const note = document.createElement('div');
        note.className = 'info-message';
        note.style.marginTop = '2rem';
        note.innerHTML = '<strong>Note:</strong> Correlation analysis is only available when using manual CSV upload with raw creator data.';
        resultsDiv.appendChild(note);

        this.updateProgress(100, 'Complete!');

        // Hide progress bar after completion
        setTimeout(() => {
            document.getElementById('creatorProgressSection').style.display = 'none';
        }, 2000);
    }

}

// Export to window
window.CreatorAnalysisToolSupabase = CreatorAnalysisToolSupabase;

console.log('✅ Creator Analysis Tool (Supabase) loaded successfully!');
