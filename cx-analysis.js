// CX Analysis Tool - Displays support feedback analysis from Claude
// Fetches top issues from support_analysis_results table

class CXAnalysis {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.supabase = null;

        this.init();
    }

    async init() {
        // Wait for Supabase to be available
        if (window.supabaseIntegration) {
            this.supabase = window.supabaseIntegration.supabase;
            await this.loadAndDisplayResults();
        } else {
            // Retry after a short delay
            setTimeout(() => this.init(), 500);
        }
    }

    async loadAndDisplayResults() {
        try {
            console.log('Loading CX Analysis results from Supabase...');

            // Fetch most recent analysis
            const { data, error } = await this.supabase
                .from('support_analysis_results')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(1)
                .single();

            if (error) {
                console.error('Error loading CX analysis:', error);
                this.displayError('No analysis results available yet. Run the support analysis pipeline first.');
                return;
            }

            if (!data) {
                this.displayError('No analysis results available yet. Run the support analysis pipeline first.');
                return;
            }

            console.log('✅ Loaded CX analysis:', data);
            this.displayResults(data);

        } catch (error) {
            console.error('Error in loadAndDisplayResults:', error);
            this.displayError('Failed to load analysis results.');
        }
    }

    async refresh() {
        console.log('Refreshing CX Analysis data...');
        this.container.innerHTML = '<div style="padding: 40px; text-align: center; color: #6c757d;">Loading...</div>';
        await this.loadAndDisplayResults();
    }

    displayError(message) {
        this.container.innerHTML = `
            <div class="qda-analysis-results" style="padding: 40px; text-align: center;">
                <div style="color: #dc3545; font-size: 16px; margin-bottom: 10px;">⚠️ ${message}</div>
                <div style="color: #6c757d; font-size: 14px;">Check the deployment guide to set up the support analysis pipeline.</div>
            </div>
        `;
    }

    displayResults(data) {
        // Create results div
        const resultsDiv = document.createElement('div');
        resultsDiv.className = 'qda-analysis-results';
        this.container.innerHTML = '';
        this.container.appendChild(resultsDiv);

        // Format timestamp: "Data as of: MM/DD/YYYY, HH:MM PM/AM"
        const analysisDate = new Date(data.created_at);
        const formattedTimestamp = analysisDate.toLocaleString('en-US', {
            month: '2-digit',
            day: '2-digit',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });

        // Add timestamp (top right)
        const timestamp = document.createElement('div');
        timestamp.className = 'qda-timestamp';
        timestamp.textContent = `Data as of: ${formattedTimestamp}`;
        resultsDiv.appendChild(timestamp);

        // Add data scope (top left)
        const dataScope = document.createElement('div');
        dataScope.className = 'qda-data-scope';
        dataScope.textContent = `Data from support tickets in the last 30 days`;
        resultsDiv.insertBefore(dataScope, timestamp);

        // Add H1 title (using qda-result-section for consistent spacing)
        const titleSection = document.createElement('div');
        titleSection.className = 'qda-result-section';
        titleSection.innerHTML = `
            <h1 style="margin-bottom: 0.25rem;">CX Analysis</h1>
            <div style="color: #6c757d; font-size: 0.9rem;">
                AI-powered analysis of the top 10 product issues and feedback
            </div>
        `;
        resultsDiv.appendChild(titleSection);

        // Render issues table
        const tableSection = this.renderIssuesTable(data.top_issues);
        resultsDiv.appendChild(tableSection);

        resultsDiv.style.display = 'block';
    }

    renderIssuesTable(issues) {
        if (!issues || issues.length === 0) {
            return this.createEmptyMessage('No issues found in the analysis.');
        }

        const section = document.createElement('div');
        section.style.marginBottom = '40px';

        // Create scrollable table container (similar to Premium Creator Copy Affinity)
        const tableHTML = `
            <div class="cx-table-wrapper" style="position: relative; overflow-x: auto; margin-top: 20px; max-width: 100%;">
                <table class="qda-results-table" style="min-width: 1600px; border-collapse: collapse; font-size: 0.9rem;">
                    <thead>
                        <tr style="background: #f8f9fa; border-bottom: 2px solid #dee2e6;">
                            <th style="padding: 12px 16px; text-align: left; font-weight: 600; width: 50px; position: sticky; left: 0; background: #f8f9fa; z-index: 2;">#</th>
                            <th style="padding: 12px 16px; text-align: left; font-weight: 600; width: 700px; position: sticky; left: 50px; background: #f8f9fa; z-index: 2;">Summarized Feedback</th>
                            <th style="padding: 12px 16px; text-align: left; font-weight: 600; width: 160px;">Category</th>
                            <th style="padding: 12px 16px; text-align: center; font-weight: 600; width: 170px; white-space: nowrap;">Percent of Feedback</th>
                            <th style="padding: 12px 16px; text-align: center; font-weight: 600; width: 150px; white-space: nowrap;">Weekly Volume</th>
                            <th style="padding: 12px 16px; text-align: center; font-weight: 600; width: 140px;">Examples</th>
                            <th style="padding: 12px 16px; text-align: center; font-weight: 600; width: 120px;">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${issues.map((issue, index) => this.renderIssueRow(issue, index)).join('')}
                    </tbody>
                </table>
            </div>
        `;

        section.innerHTML = tableHTML;

        // Add tooltip positioning logic after rendering
        setTimeout(() => {
            this.initializeTooltips();
        }, 0);

        return section;
    }

    initializeTooltips() {
        // Get all tooltip triggers
        const tooltips = document.querySelectorAll('.cx-examples-tooltip');

        tooltips.forEach(tooltip => {
            const trigger = tooltip.querySelector('span:first-child');
            const tooltipBox = tooltip.querySelector('.tooltip-text');

            if (!trigger || !tooltipBox) return;

            // Show tooltip on hover
            trigger.addEventListener('mouseenter', (e) => {
                // Get trigger position relative to viewport
                const rect = trigger.getBoundingClientRect();
                const tableWrapper = document.querySelector('.cx-table-wrapper');
                const wrapperRect = tableWrapper ? tableWrapper.getBoundingClientRect() : null;

                // Position tooltip
                tooltipBox.style.position = 'fixed';
                tooltipBox.style.visibility = 'visible';
                tooltipBox.style.opacity = '1';
                tooltipBox.style.zIndex = '10000';

                // Calculate position (above the trigger, centered)
                const tooltipWidth = 400;
                const left = rect.left + (rect.width / 2) - (tooltipWidth / 2);
                const top = rect.top - tooltipBox.offsetHeight - 8;

                // Adjust if tooltip would go off screen
                const adjustedLeft = Math.max(10, Math.min(left, window.innerWidth - tooltipWidth - 10));
                const adjustedTop = top < 10 ? rect.bottom + 8 : top;

                tooltipBox.style.left = `${adjustedLeft}px`;
                tooltipBox.style.top = `${adjustedTop}px`;
                tooltipBox.style.transform = 'none';
            });

            // Hide tooltip
            trigger.addEventListener('mouseleave', () => {
                tooltipBox.style.visibility = 'hidden';
                tooltipBox.style.opacity = '0';
            });

            // Keep tooltip visible when hovering over it
            tooltipBox.addEventListener('mouseenter', () => {
                tooltipBox.style.visibility = 'visible';
                tooltipBox.style.opacity = '1';
            });

            tooltipBox.addEventListener('mouseleave', () => {
                tooltipBox.style.visibility = 'hidden';
                tooltipBox.style.opacity = '0';
            });
        });
    }

    renderIssueRow(issue, index) {
        // Determine category color/badge
        const categoryColors = {
            'Compliance': '#dc3545',
            'Money Movement': '#fd7e14',
            'Trading': '#ffc107',
            'App Functionality': '#17a2b8',
            'Feature Request': '#28a745'
        };

        const categoryColor = categoryColors[issue.category] || '#6c757d';

        // Format percentage
        const percentText = issue.percentage_of_total ? `${issue.percentage_of_total.toFixed(1)}%` : '-';

        // Alternate row colors
        const rowBg = index % 2 === 0 ? '#ffffff' : '#f8f9fa';

        // Generate examples tooltip
        const examplesContent = this.renderExamplesTooltip(issue.examples);

        return `
            <tr style="background: ${rowBg}; border-bottom: 1px solid #dee2e6;">
                <td style="padding: 12px 16px; font-weight: 600; color: #495057; position: sticky; left: 0; background: ${rowBg}; z-index: 1;">${issue.rank || index + 1}</td>
                <td style="padding: 12px 16px; font-weight: 500; color: #212529; position: sticky; left: 50px; background: ${rowBg}; z-index: 1;">
                    ${this.escapeHtml(issue.issue_summary)}
                </td>
                <td style="padding: 12px 16px;">
                    <span style="
                        display: inline-block;
                        padding: 4px 12px;
                        border-radius: 12px;
                        background: ${categoryColor}15;
                        color: ${categoryColor};
                        font-size: 0.85rem;
                        font-weight: 600;
                        white-space: nowrap;
                    ">
                        ${this.escapeHtml(issue.category)}
                    </span>
                </td>
                <td style="padding: 12px 16px; text-align: center; font-weight: 600; color: #495057;">
                    ${percentText}
                </td>
                <td style="padding: 12px 16px; text-align: center; font-weight: 600; color: #495057;">
                    ${issue.weekly_volume || '-'}
                </td>
                <td style="padding: 12px 16px; text-align: center;">
                    ${examplesContent}
                </td>
                <td style="padding: 12px 16px; text-align: center; color: #adb5bd;">
                    -
                </td>
            </tr>
        `;
    }

    renderExamplesTooltip(examples) {
        if (!examples || examples.length === 0) {
            return '-';
        }

        // Generate unique ID for this tooltip
        const tooltipId = `examples-${Math.random().toString(36).substr(2, 9)}`;

        // Build examples content for tooltip
        const examplesHTML = examples.map((ex, idx) => {
            const sourceIcon = ex.source === 'zendesk' ? '🎫' : '🐛';
            const userInfo = ex.user_info ? `<br><span style="font-size: 0.75rem; color: #9ca3af;">${this.escapeHtml(ex.user_info)}</span>` : '';

            return `
                <div style="margin-bottom: ${idx < examples.length - 1 ? '12px' : '0'}; padding-bottom: ${idx < examples.length - 1 ? '12px' : '0'}; border-bottom: ${idx < examples.length - 1 ? '1px solid #e5e7eb' : 'none'};">
                    <div style="font-weight: 600; color: #111827; margin-bottom: 4px;">${sourceIcon} Example ${idx + 1}</div>
                    <div style="font-size: 0.85rem; color: #374151; line-height: 1.5;">${this.escapeHtml(ex.excerpt)}</div>
                    ${userInfo}
                </div>
            `;
        }).join('');

        return `
            <span class="info-tooltip cx-examples-tooltip" style="position: relative; display: inline-block;">
                <span style="color: #212529; text-decoration: underline; cursor: pointer;">
                    See examples
                </span>
                <span class="tooltip-text" style="
                    visibility: hidden;
                    opacity: 0;
                    width: 400px;
                    max-width: 90vw;
                    background-color: white;
                    color: #1f2937;
                    text-align: left;
                    border-radius: 8px;
                    padding: 16px;
                    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
                    border: 1px solid #e5e7eb;
                    font-size: 0.875rem;
                    line-height: 1.5;
                    transition: opacity 0.2s, visibility 0.2s;
                    pointer-events: auto;
                ">
                    ${examplesHTML}
                </span>
            </span>
        `;
    }

    createEmptyMessage(message) {
        const section = document.createElement('div');
        section.style.padding = '40px';
        section.style.textAlign = 'center';
        section.style.color = '#6c757d';
        section.textContent = message;
        return section;
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
