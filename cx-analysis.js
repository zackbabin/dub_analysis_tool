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

        // Format timestamp
        const analysisDate = new Date(data.created_at);
        const formattedTimestamp = analysisDate.toLocaleString('en-US', {
            month: 'numeric',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });

        // Calculate date range for data scope
        const weekStartDate = new Date(data.week_start_date);
        const weekEndDate = new Date(analysisDate);
        const daysRange = Math.round((weekEndDate - weekStartDate) / (1000 * 60 * 60 * 24));

        // Add timestamp (top right)
        const timestamp = document.createElement('div');
        timestamp.className = 'qda-timestamp';
        timestamp.textContent = `Analysis Date: ${formattedTimestamp}`;
        resultsDiv.appendChild(timestamp);

        // Add data scope (top left)
        const dataScope = document.createElement('div');
        dataScope.className = 'qda-data-scope';
        dataScope.textContent = `Zendesk feedback from last ${daysRange} days (${data.conversation_count} conversations)`;
        resultsDiv.insertBefore(dataScope, timestamp);

        // Add H1 title
        const titleSection = document.createElement('div');
        titleSection.style.marginBottom = '30px';
        titleSection.innerHTML = `
            <h1 style="margin-bottom: 0.25rem;">
                <span class="info-tooltip">CX Analysis
                    <span class="info-icon">i</span>
                    <span class="info-tooltip-text">
                        AI-powered analysis of customer support conversations from Zendesk.
                        Issues are categorized and prioritized using Claude Sonnet 4.
                    </span>
                </span>
            </h1>
            <div style="color: #6c757d; font-size: 0.9rem; margin-bottom: 0.5rem;">
                Top 10 Product Issues & Feedback Themes
            </div>
            <div style="color: #6c757d; font-size: 0.85rem;">
                Analysis Cost: $${data.analysis_cost?.toFixed(4) || '0.00'} | Tokens: ${data.total_tokens_used?.toLocaleString() || '0'}
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

        // Create table HTML
        const tableHTML = `
            <table class="qda-results-table" style="width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 0.9rem;">
                <thead>
                    <tr style="background: #f8f9fa; border-bottom: 2px solid #dee2e6;">
                        <th style="padding: 12px 16px; text-align: left; font-weight: 600; width: 5%;">#</th>
                        <th style="padding: 12px 16px; text-align: left; font-weight: 600; width: 45%;">Summarized Feedback</th>
                        <th style="padding: 12px 16px; text-align: left; font-weight: 600; width: 15%;">Category</th>
                        <th style="padding: 12px 16px; text-align: center; font-weight: 600; width: 13%;">Percent of Feedback</th>
                        <th style="padding: 12px 16px; text-align: center; font-weight: 600; width: 12%;">Weekly Volume</th>
                        <th style="padding: 12px 16px; text-align: center; font-weight: 600; width: 10%;">Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${issues.map((issue, index) => this.renderIssueRow(issue, index)).join('')}
                </tbody>
            </table>
        `;

        section.innerHTML = tableHTML;
        return section;
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

        return `
            <tr style="background: ${rowBg}; border-bottom: 1px solid #dee2e6;">
                <td style="padding: 12px 16px; font-weight: 600; color: #495057;">${issue.rank || index + 1}</td>
                <td style="padding: 12px 16px;">
                    <div style="margin-bottom: 4px; font-weight: 500; color: #212529;">
                        ${this.escapeHtml(issue.issue_summary)}
                    </div>
                    ${this.renderExamples(issue.examples)}
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
                <td style="padding: 12px 16px; text-align: center; color: #adb5bd;">
                    -
                </td>
            </tr>
        `;
    }

    renderExamples(examples) {
        if (!examples || examples.length === 0) {
            return '';
        }

        // Show first example by default, with expand/collapse for others
        const examplesHTML = examples.map((ex, idx) => {
            const sourceIcon = ex.source === 'zendesk' ? '🎫' : '🐛';
            const userInfo = ex.user_info ? ` | ${ex.user_info}` : '';

            return `
                <div style="
                    font-size: 0.8rem;
                    color: #6c757d;
                    margin-top: 6px;
                    padding-left: 12px;
                    border-left: 3px solid #dee2e6;
                ">
                    <span style="font-weight: 600;">${sourceIcon} Example ${idx + 1}:</span> ${this.escapeHtml(ex.excerpt)}${userInfo}
                </div>
            `;
        }).join('');

        return `<div style="margin-top: 8px;">${examplesHTML}</div>`;
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
