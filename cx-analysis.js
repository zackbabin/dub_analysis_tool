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
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem;">
                <h1 style="margin: 0;">CX Analysis</h1>
                <button onclick="window.refreshAllTabs()" style="padding: 8px 16px; background: #17a2b8; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500; transition: background 0.2s;" onmouseover="this.style.background='#138496'" onmouseout="this.style.background='#17a2b8'">Refresh Data</button>
            </div>
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
                <table class="qda-results-table" style="min-width: 1500px; border-collapse: collapse; font-size: 0.9rem;">
                    <thead>
                        <tr style="background: #f8f9fa; border-bottom: 2px solid #dee2e6;">
                            <th style="padding: 12px 16px; text-align: left; font-weight: 600; width: 50px; position: sticky; left: 0; background: #f8f9fa; z-index: 2;">#</th>
                            <th style="padding: 12px 16px; text-align: left; font-weight: 600; width: 500px; position: sticky; left: 50px; background: #f8f9fa; z-index: 2;">Summarized Feedback</th>
                            <th style="padding: 12px 16px; text-align: left; font-weight: 600; width: 160px;">Category</th>
                            <th style="padding: 12px 16px; text-align: center; font-weight: 600; width: 170px; white-space: nowrap;">Percent of Feedback</th>
                            <th style="padding: 12px 16px; text-align: center; font-weight: 600; width: 150px; white-space: nowrap;">Weekly Volume</th>
                            <th style="padding: 12px 16px; text-align: center; font-weight: 600; width: 140px;">Examples</th>
                            <th style="padding: 12px 16px; text-align: center; font-weight: 600; width: 160px;">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${issues.map((issue, index) => this.renderIssueRow(issue, index)).join('')}
                    </tbody>
                </table>
            </div>
        `;

        section.innerHTML = tableHTML;

        // Initialize tooltips after rendering
        setTimeout(() => {
            this.initializeExamplesToolips();
            this.initializeLinearStatusTooltips();
        }, 0);

        return section;
    }

    initializeExamplesToolips() {
        const tooltips = document.querySelectorAll('.cx-examples-tooltip');

        tooltips.forEach(tooltipWrapper => {
            const trigger = tooltipWrapper.querySelector('.tooltip-trigger');
            const tooltipBox = tooltipWrapper.querySelector('.tooltip-text');

            if (!trigger || !tooltipBox) return;

            trigger.addEventListener('mouseenter', () => {
                // Get trigger position
                const rect = trigger.getBoundingClientRect();

                // Show tooltip
                tooltipBox.style.visibility = 'visible';
                tooltipBox.style.opacity = '1';

                // Calculate position (above trigger, centered)
                const tooltipWidth = 400;
                let left = rect.left + (rect.width / 2) - (tooltipWidth / 2);
                let top = rect.top - tooltipBox.offsetHeight - 8;

                // Keep tooltip on screen horizontally
                if (left < 10) left = 10;
                if (left + tooltipWidth > window.innerWidth - 10) {
                    left = window.innerWidth - tooltipWidth - 10;
                }

                // If tooltip goes above viewport, show below instead
                if (top < 10) {
                    top = rect.bottom + 8;
                }

                tooltipBox.style.left = `${left}px`;
                tooltipBox.style.top = `${top}px`;
            });

            trigger.addEventListener('mouseleave', () => {
                // Delay hiding to allow moving to tooltip
                setTimeout(() => {
                    if (!tooltipBox.matches(':hover')) {
                        tooltipBox.style.visibility = 'hidden';
                        tooltipBox.style.opacity = '0';
                    }
                }, 100);
            });

            // Keep visible when hovering tooltip
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

    initializeLinearStatusTooltips() {
        const tooltips = document.querySelectorAll('.cx-linear-status-tooltip');

        tooltips.forEach(tooltipWrapper => {
            const trigger = tooltipWrapper.querySelector('.tooltip-trigger');
            const tooltipBox = tooltipWrapper.querySelector('.tooltip-text');

            if (!trigger || !tooltipBox) return;

            trigger.addEventListener('mouseenter', () => {
                // Get trigger position
                const rect = trigger.getBoundingClientRect();

                // Show tooltip
                tooltipBox.style.visibility = 'visible';
                tooltipBox.style.opacity = '1';

                // Calculate position (above trigger, centered)
                const tooltipWidth = 400;
                let left = rect.left + (rect.width / 2) - (tooltipWidth / 2);
                let top = rect.top - tooltipBox.offsetHeight - 8;

                // Keep tooltip on screen horizontally
                if (left < 10) left = 10;
                if (left + tooltipWidth > window.innerWidth - 10) {
                    left = window.innerWidth - tooltipWidth - 10;
                }

                // If tooltip goes above viewport, show below instead
                if (top < 10) {
                    top = rect.bottom + 8;
                }

                tooltipBox.style.left = `${left}px`;
                tooltipBox.style.top = `${top}px`;
            });

            trigger.addEventListener('mouseleave', () => {
                // Delay hiding to allow moving to tooltip
                setTimeout(() => {
                    if (!tooltipBox.matches(':hover')) {
                        tooltipBox.style.visibility = 'hidden';
                        tooltipBox.style.opacity = '0';
                    }
                }, 100);
            });

            // Keep visible when hovering tooltip
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
                <td style="padding: 12px 16px; text-align: center;">
                    ${this.renderLinearStatus(issue)}
                </td>
            </tr>
        `;
    }

    renderLinearStatus(issue) {
        // Check if Linear data exists
        if (!issue.linear_status || !issue.linear_issues || issue.linear_issues.length === 0) {
            return '<span style="color: #adb5bd;">-</span>'
        }

        // Status badge colors
        const statusColors = {
            'Backlog': { bg: '#6c757d', text: '#fff' },
            'In Progress': { bg: '#17a2b8', text: '#fff' },
            'Done': { bg: '#28a745', text: '#fff' }
        }

        const colors = statusColors[issue.linear_status] || { bg: '#6c757d', text: '#fff' }

        // Build Linear issues tooltip content
        const linearIssuesHTML = issue.linear_issues.map((li, idx) => {
            return `
                <div style="margin-bottom: ${idx < issue.linear_issues.length - 1 ? '12px' : '0'}; padding-bottom: ${idx < issue.linear_issues.length - 1 ? '12px' : '0'}; border-bottom: ${idx < issue.linear_issues.length - 1 ? '1px solid rgba(255,255,255,0.1)' : 'none'};">
                    <div style="color: #63b3ed; font-weight: 600; margin-bottom: 4px;">
                        <a href="${this.escapeHtml(li.url)}" target="_blank" rel="noopener noreferrer" style="color: #63b3ed; text-decoration: none;">
                            ${this.escapeHtml(li.id)} ↗
                        </a>
                    </div>
                    <div style="margin-bottom: 4px;">${this.escapeHtml(li.title)}</div>
                    <div style="font-size: 0.8em; color: #94a3b8;">
                        <span style="
                            display: inline-block;
                            padding: 2px 8px;
                            border-radius: 8px;
                            background: rgba(255,255,255,0.1);
                            font-weight: 600;
                        ">
                            ${this.escapeHtml(li.state)}
                        </span>
                    </div>
                </div>
            `
        }).join('')

        // Return status badge with tooltip
        return `
            <span class="cx-linear-status-tooltip" style="position: relative; display: inline-block;">
                <span class="tooltip-trigger" style="
                    display: inline-block;
                    padding: 6px 14px;
                    border-radius: 12px;
                    background: ${colors.bg};
                    color: ${colors.text};
                    font-size: 0.85rem;
                    font-weight: 600;
                    cursor: help;
                    white-space: nowrap;
                ">
                    ${this.escapeHtml(issue.linear_status)}
                </span>
                <span class="tooltip-text" style="
                    position: fixed;
                    visibility: hidden;
                    opacity: 0;
                    width: 400px;
                    background-color: #2d3748;
                    color: #fff;
                    text-align: left;
                    border-radius: 8px;
                    padding: 14px 16px;
                    z-index: 10000;
                    font-size: 13px;
                    line-height: 1.5;
                    transition: opacity 0.3s, visibility 0.3s;
                    pointer-events: auto;
                    top: 0;
                    left: 0;
                ">
                    <div style="font-weight: 600; margin-bottom: 10px; color: #63b3ed;">
                        ${issue.linear_issues.length} Linear Issue${issue.linear_issues.length > 1 ? 's' : ''}
                    </div>
                    ${linearIssuesHTML}
                </span>
            </span>
        `
    }

    renderExamplesTooltip(examples) {
        if (!examples || examples.length === 0) {
            return '-';
        }

        // Build examples content for tooltip (matching Behavioral Drivers style)
        const examplesHTML = examples.map((ex, idx) => {
            const sourceIcon = ex.source === 'zendesk' ? '🎫' : '🐛';
            const userInfo = ex.user_info ? `<div style="font-size: 0.8em; color: #94a3b8; margin-top: 4px;">${this.escapeHtml(ex.user_info)}</div>` : '';

            return `
                <div style="margin-bottom: ${idx < examples.length - 1 ? '12px' : '0'}; padding-bottom: ${idx < examples.length - 1 ? '12px' : '0'}; border-bottom: ${idx < examples.length - 1 ? '1px solid rgba(255,255,255,0.1)' : 'none'};">
                    <div style="color: #63b3ed; font-weight: 600; margin-bottom: 4px;">${sourceIcon} Example ${idx + 1}</div>
                    <div>${this.escapeHtml(ex.excerpt)}</div>
                    ${userInfo}
                </div>
            `;
        }).join('');

        // Use custom tooltip with fixed positioning to escape overflow
        return `
            <span class="cx-examples-tooltip" style="position: relative; display: inline-block;">
                <span class="tooltip-trigger" style="color: #212529; text-decoration: underline; text-decoration-style: dotted; cursor: help;">
                    See examples
                </span>
                <span class="tooltip-text" style="
                    position: fixed;
                    visibility: hidden;
                    opacity: 0;
                    width: 400px;
                    background-color: #2d3748;
                    color: #fff;
                    text-align: left;
                    border-radius: 8px;
                    padding: 14px 16px;
                    z-index: 10000;
                    font-size: 13px;
                    line-height: 1.5;
                    transition: opacity 0.3s, visibility 0.3s;
                    pointer-events: auto;
                    top: 0;
                    left: 0;
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
