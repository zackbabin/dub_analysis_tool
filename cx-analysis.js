// CX Analysis Tool - Displays support feedback analysis from Claude
// Fetches top issues from support_analysis_results table

class CXAnalysis {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.supabase = null;
        this.supabaseIntegration = null;

        this.init();
    }

    async init() {
        // Wait for Supabase to be available
        if (window.supabaseIntegration) {
            this.supabaseIntegration = window.supabaseIntegration;
            this.supabase = window.supabaseIntegration.supabase;
            await this.loadAndDisplayResults();
        } else {
            // Retry after a short delay
            setTimeout(() => this.init(), 500);
        }
    }

    async loadAndDisplayResults() {
        try {
            // Fetch most recent analysis - use limit(1) without .single() to handle empty results
            const { data, error } = await this.supabase
                .from('support_analysis_results')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(1);

            if (error) {
                console.error('❌ Error loading CX analysis:', error);
                this.displayError(`Database error: ${error.message || 'Unknown error'}. Check console for details.`);
                return;
            }

            // Check if we got any results
            if (!data || data.length === 0) {
                console.warn('⚠️ No CX analysis results found');
                this.displayError('No analysis results available yet. Run the support analysis pipeline first.');
                return;
            }

            // Get the first (most recent) result
            const analysisResult = data[0];

            // Validate data structure
            if (!analysisResult.top_issues || !Array.isArray(analysisResult.top_issues)) {
                console.error('❌ Invalid data structure - top_issues missing or not an array:', analysisResult);
                this.displayError('Invalid analysis data format. Please re-run the analysis pipeline.');
                return;
            }

            // Debug: Check if avg_message_count exists in the data
            console.log('🔍 Checking avg_message_count in top_issues:');
            analysisResult.top_issues.forEach((issue, idx) => {
                console.log(`  Issue ${idx + 1}: avg_message_count = ${issue.avg_message_count}`);
            });

            this.displayResults(analysisResult);

        } catch (error) {
            console.error('❌ Exception in loadAndDisplayResults:', error);
            console.error('Stack trace:', error.stack);
            this.displayError(`Failed to load analysis results: ${error.message}`);
        }
    }

    async refresh() {
        // Clear query cache to ensure fresh data (same as user/creator tools)
        if (this.supabaseIntegration) {
            this.supabaseIntegration.invalidateCache();
        }

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
        // Use current time to show when the data was last refreshed (similar to User/Creator tools)
        const currentTime = new Date();
        const formattedTimestamp = currentTime.toLocaleString('en-US', {
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

        // Add data scope (top left) - shows conversation count analyzed by Claude
        const dataScope = document.createElement('div');
        dataScope.className = 'qda-data-scope';

        // Format week_start_date as MM/DD/YYYY
        const weekStartDate = new Date(data.week_start_date);
        const formattedWeekStart = weekStartDate.toLocaleDateString('en-US', {
            month: '2-digit',
            day: '2-digit',
            year: 'numeric'
        });

        // Get total conversations analyzed from Claude's response
        const totalAnalyzed = data.analysis_summary?.total_conversations_analyzed || data.conversation_count || 'N/A';
        dataScope.textContent = `Analysis of ${totalAnalyzed} Zendesk tickets since ${formattedWeekStart}`;
        resultsDiv.insertBefore(dataScope, timestamp);

        // Add H1 title (using qda-result-section for consistent spacing)
        const titleSection = document.createElement('div');
        titleSection.className = 'qda-result-section';
        titleSection.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem;">
                <h1 style="margin: 0;"><span class="info-tooltip">CX Analysis<span class="info-icon">i</span>
                    <span class="tooltip-text">
                        <strong>CX Analysis</strong>
                        AI-driven support ticket analysis identifying top product issues and customer feedback themes.
                        <ul>
                            <li><strong>Data Source:</strong> Zendesk support tickets (last 30 days)</li>
                            <li><strong>AI Analysis:</strong> Claude Sonnet 4 categorizes tickets by issue type and priority</li>
                            <li><strong>Categories (by priority):</strong>
                                <ul style="margin-top: 4px;">
                                    <li>Money Movement - user cannot deposit or withdraw money</li>
                                    <li>Trading - user unable to trade or sell</li>
                                    <li>App Functionality - user cannot access app or faces broken functionality</li>
                                    <li>Feedback - user frustration or feedback about app experience/features</li>
                                </ul>
                            </li>
                            <li><strong>Ranking Formula:</strong> Priority Score = (Category Weight × 0.4) + (Percentage × 3 × 0.3) + (Volume/50 × 100 × 0.3)
                                <ul style="margin-top: 4px;">
                                    <li>Category weights: Money Movement=100, Trading=80, App=60, Feedback=40</li>
                                    <li>Percentage = % of total conversations affected</li>
                                    <li>Volume = weekly ticket count (capped at 50)</li>
                                </ul>
                            </li>
                            <li><strong>Automation:</strong> Runs weekly (Sundays at 3:30 AM UTC via cron)</li>
                            <li><strong>Privacy:</strong> PII automatically redacted at ingestion
                                <ul style="margin-top: 4px;">
                                    <li>Types: SSN, credit cards, phone numbers, emails, bank accounts, addresses</li>
                                    <li>Applied to: ticket titles, descriptions, comments, custom fields</li>
                                </ul>
                            </li>
                        </ul>
                    </span>
                </span></h1>
                <button onclick="window.refreshAllTabs(event)" style="padding: 8px 16px; background: #17a2b8; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500; transition: background 0.2s;" onmouseover="this.style.background='#138496'" onmouseout="this.style.background='#17a2b8'">Refresh</button>
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
                            <th style="padding: 12px 16px; text-align: left; font-weight: 600; width: 400px; position: sticky; left: 50px; background: #f8f9fa; z-index: 2;">Summarized Feedback</th>
                            <th style="padding: 12px 16px; text-align: left; font-weight: 600; width: 160px;">Category</th>
                            <th style="padding: 12px 16px; text-align: center; font-weight: 600; width: 170px; white-space: nowrap;">Percent of Feedback</th>
                            <th style="padding: 12px 16px; text-align: center; font-weight: 600; width: 150px; white-space: nowrap;">Weekly Volume</th>
                            <th style="padding: 12px 16px; text-align: center; font-weight: 600; width: 120px; white-space: nowrap;">Avg Messages</th>
                            <th style="padding: 12px 16px; text-align: center; font-weight: 600; width: 140px;">Examples</th>
                            <th style="padding: 12px 16px; text-align: left; font-weight: 600; width: 200px;">Linear Tickets</th>
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
            this.initializeLinearTicketTooltips();
            this.initializeHeaderTooltips();
        }, 0);

        return section;
    }

    initializeHeaderTooltips() {
        // Initialize table header tooltips (like Linear Status) with fixed positioning
        const headerTooltips = document.querySelectorAll('.cx-table-header-tooltip');

        headerTooltips.forEach(tooltipWrapper => {
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

    initializeLinearTicketTooltips() {
        const tooltips = document.querySelectorAll('.cx-linear-ticket-tooltip');

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
                const tooltipWidth = 350;
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
                tooltipBox.style.visibility = 'hidden';
                tooltipBox.style.opacity = '0';
            });
        });
    }

    renderIssueRow(issue, index) {
        // Determine category color/badge
        const categoryColors = {
            'Money Movement': '#dc3545',
            'Trading': '#fd7e14',
            'App Functionality': '#ffc107',
            'Feedback': '#17a2b8'
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
                <td style="padding: 12px 16px; text-align: center; font-weight: 600; color: #495057;">
                    ${issue.avg_message_count ? issue.avg_message_count.toFixed(1) : '-'}
                </td>
                <td style="padding: 12px 16px; text-align: center;">
                    ${examplesContent}
                </td>
                <td style="padding: 12px 16px; text-align: left;">
                    ${this.renderLinearTickets(issue)}
                </td>
            </tr>
        `;
    }

    renderLinearStatus(issue) {
        // Check if Linear data exists
        if (!issue.linear_issues || issue.linear_issues.length === 0) {
            // Return "Not Started" badge when no Linear tickets mapped
            return `
                <span style="
                    display: inline-block;
                    padding: 6px 14px;
                    border-radius: 12px;
                    background: #e9ecef;
                    color: #495057;
                    font-size: 0.85rem;
                    font-weight: 600;
                    white-space: nowrap;
                ">
                    Not Started
                </span>
            `
        }

        // Calculate status based on state_name aggregation
        const backlogStates = ['Backlog', 'Todo', 'Triage']
        const doneStates = ['Done', 'Canceled']

        let status
        const allBacklog = issue.linear_issues.every(li =>
            backlogStates.includes(li.state_name)
        )
        const anyInProgress = issue.linear_issues.some(li =>
            !backlogStates.includes(li.state_name) &&
            !doneStates.includes(li.state_name)
        )
        const allDone = issue.linear_issues.every(li =>
            doneStates.includes(li.state_name)
        )

        if (allDone) {
            status = 'Done'
        } else if (anyInProgress) {
            status = 'In Progress'
        } else if (allBacklog) {
            status = 'Backlog'
        } else {
            // Fallback to Backlog if no clear state
            status = 'Backlog'
        }

        // Status badge colors
        const statusColors = {
            'Backlog': { bg: '#6c757d', text: '#fff' },
            'In Progress': { bg: '#17a2b8', text: '#fff' },
            'Done': { bg: '#28a745', text: '#fff' }
        }

        const colors = statusColors[status] || { bg: '#6c757d', text: '#fff' }

        // Return status badge without tooltip
        return `
            <span style="
                display: inline-block;
                padding: 6px 14px;
                border-radius: 12px;
                background: ${colors.bg};
                color: ${colors.text};
                font-size: 0.85rem;
                font-weight: 600;
                white-space: nowrap;
            ">
                ${this.escapeHtml(status)}
            </span>
        `
    }

    renderLinearTickets(issue) {
        // Check if Linear data exists
        if (!issue.linear_issues || issue.linear_issues.length === 0) {
            return '<span style="color: #adb5bd;">-</span>'
        }
        // Display first 3 issues
        const displayIssues = issue.linear_issues.slice(0, 3)

        // Build issue links with tooltips
        const issueHTML = displayIssues.map(li => {
            // Truncate description to 140 characters
            const description = li.description ?
                (li.description.length > 140 ? li.description.substring(0, 140) + '...' : li.description) :
                'No description'

            return `
                <span class="cx-linear-ticket-tooltip" style="position: relative; display: inline-block; margin-right: 12px;">
                    <a href="${this.escapeHtml(li.url)}" target="_blank" rel="noopener noreferrer"
                       class="tooltip-trigger"
                       style="
                        color: #1976d2;
                        font-size: 0.9rem;
                        font-weight: 500;
                        text-decoration: underline;
                        white-space: nowrap;
                        cursor: pointer;
                    ">
                        ${this.escapeHtml(li.identifier)}
                    </a>
                    <span class="tooltip-text" style="
                        position: fixed;
                        visibility: hidden;
                        opacity: 0;
                        width: 350px;
                        background-color: #2d3748;
                        color: #fff;
                        text-align: left;
                        border-radius: 8px;
                        padding: 12px 14px;
                        z-index: 10000;
                        font-size: 12px;
                        line-height: 1.5;
                        transition: opacity 0.3s, visibility 0.3s;
                        pointer-events: none;
                        top: 0;
                        left: 0;
                    ">
                        <div style="font-weight: 600; margin-bottom: 6px; color: #63b3ed;">
                            ${this.escapeHtml(li.identifier)}: ${this.escapeHtml(li.title)}
                        </div>
                        <div style="margin-bottom: 6px; color: #cbd5e0; font-size: 11px;">
                            ${this.escapeHtml(description)}
                        </div>
                        <div style="font-size: 11px;">
                            <span style="
                                display: inline-block;
                                padding: 2px 6px;
                                border-radius: 6px;
                                background: rgba(255,255,255,0.1);
                                font-weight: 600;
                                color: #94a3b8;
                            ">
                                ${this.escapeHtml(li.state_name)}
                            </span>
                        </div>
                    </span>
                </span>
            `
        }).join('')

        return issueHTML
    }

    renderExamplesTooltip(examples) {
        if (!examples || examples.length === 0) {
            return '-';
        }

        // Build examples content for tooltip - showing ticket IDs, titles, and descriptions
        const examplesHTML = examples.map((ex, idx) => {
            // Truncate description to 140 characters if needed
            const description = ex.description ?
                (ex.description.length > 140 ? ex.description.substring(0, 140) + '...' : ex.description) :
                '';

            return `
                <div style="margin-bottom: ${idx < examples.length - 1 ? '12px' : '0'}; padding-bottom: ${idx < examples.length - 1 ? '12px' : '0'}; border-bottom: ${idx < examples.length - 1 ? '1px solid rgba(255,255,255,0.1)' : 'none'};">
                    <div style="color: #63b3ed; font-weight: 600; margin-bottom: 4px;">🎫 ${this.escapeHtml(ex.conversation_id)}</div>
                    <div style="margin-bottom: 4px; font-weight: 500;">${this.escapeHtml(ex.title)}</div>
                    ${description ? `<div style="color: #cbd5e0; font-size: 11px;">${this.escapeHtml(description)}</div>` : ''}
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
