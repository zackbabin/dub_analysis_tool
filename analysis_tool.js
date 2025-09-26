// Widget creation using DOM methods - supports both inline and floating display
function createWidget(targetContainer = null) {
    const widget = document.createElement('div');
    
    if (targetContainer) {
        // Inline display
        widget.className = 'qda-inline-widget';
    } else {
        // Original floating display
        widget.className = 'qda-widget';
    }
    
    // Header
    const header = document.createElement('div');
    header.className = 'qda-header';
    
    const title = document.createElement('h3');
    title.style.margin = '0';
    title.textContent = 'Enhanced QDA - Fixed Personas';
    header.appendChild(title);
    
    // Content
    const content = document.createElement('div');
    content.className = 'qda-content';
    
    const description = document.createElement('p');
    description.textContent = 'Upload your CSV file to perform comprehensive statistical analysis with FIXED persona logic (no overlaps).';
    content.appendChild(description);
    
    // Upload section with 3 columns
    const uploadSection = document.createElement('div');
    uploadSection.className = 'qda-upload-section';
    
    // Main Analysis File (required)
    const mainColumn = document.createElement('div');
    mainColumn.className = 'qda-upload-column';
    
    const mainLabel = document.createElement('div');
    mainLabel.className = 'qda-file-label';
    mainLabel.textContent = 'Main Analysis File';
    mainColumn.appendChild(mainLabel);
    
    const mainFileInput = document.createElement('input');
    mainFileInput.type = 'file';
    mainFileInput.id = 'qdaMainFileInline';
    mainFileInput.accept = '.csv';
    mainFileInput.className = 'qda-file-input';
    mainColumn.appendChild(mainFileInput);
    
    const mainDesc = document.createElement('div');
    mainDesc.className = 'qda-file-description';
    mainDesc.textContent = 'Required: User behavior, demographics, and conversion data';
    mainColumn.appendChild(mainDesc);
    
    // Portfolio Detail File (optional)
    const portfolioColumn = document.createElement('div');
    portfolioColumn.className = 'qda-upload-column';
    
    const portfolioLabel = document.createElement('div');
    portfolioLabel.className = 'qda-file-label';
    portfolioLabel.textContent = 'Portfolio Detail File';
    portfolioColumn.appendChild(portfolioLabel);
    
    const portfolioFileInput = document.createElement('input');
    portfolioFileInput.type = 'file';
    portfolioFileInput.id = 'qdaPortfolioFileInline';
    portfolioFileInput.accept = '.csv';
    portfolioFileInput.className = 'qda-file-input';
    portfolioColumn.appendChild(portfolioFileInput);
    
    const portfolioDesc = document.createElement('div');
    portfolioDesc.className = 'qda-file-description';
    portfolioDesc.textContent = 'Optional: Portfolio views, copy starts, and performance metrics';
    portfolioColumn.appendChild(portfolioDesc);
    
    // Creator Detail File (optional)
    const creatorColumn = document.createElement('div');
    creatorColumn.className = 'qda-upload-column';
    
    const creatorLabel = document.createElement('div');
    creatorLabel.className = 'qda-file-label';
    creatorLabel.textContent = 'Creator Detail File';
    creatorColumn.appendChild(creatorLabel);
    
    const creatorFileInput = document.createElement('input');
    creatorFileInput.type = 'file';
    creatorFileInput.id = 'qdaCreatorFileInline';
    creatorFileInput.accept = '.csv';
    creatorFileInput.className = 'qda-file-input';
    creatorColumn.appendChild(creatorFileInput);
    
    const creatorDesc = document.createElement('div');
    creatorDesc.className = 'qda-file-description';
    creatorDesc.textContent = 'Optional: Creator paywall views, subscriptions, and monetization data';
    creatorColumn.appendChild(creatorDesc);
    
    uploadSection.appendChild(mainColumn);
    uploadSection.appendChild(portfolioColumn);
    uploadSection.appendChild(creatorColumn);
    
    const analyzeRow = document.createElement('div');
    analyzeRow.className = 'qda-analyze-row';
    
    const analyzeBtn = document.createElement('button');
    analyzeBtn.className = 'qda-btn';
    analyzeBtn.id = 'qdaAnalyzeBtnInline';
    analyzeBtn.textContent = 'Analyze Data';
    analyzeBtn.addEventListener('click', () => analyzeDataInline(widget));
    
    analyzeRow.appendChild(analyzeBtn);
    uploadSection.appendChild(analyzeRow);
    content.appendChild(uploadSection);
    
    // Results
    const resultsDiv = document.createElement('div');
    resultsDiv.id = 'qdaAnalysisResultsInline';
    resultsDiv.className = 'qda-analysis-results';
    
    const summaryDiv = document.createElement('div');
    summaryDiv.id = 'qdaSummaryStatsInline';
    resultsDiv.appendChild(summaryDiv);

    // Demographic Breakdown Section
    const demographicDiv = document.createElement('div');
    demographicDiv.id = 'qdaDemographicBreakdownInline';
    resultsDiv.appendChild(demographicDiv);
    
    // Persona Breakdown Section
    const personaDiv = document.createElement('div');
    personaDiv.id = 'qdaPersonaBreakdownInline';
    resultsDiv.appendChild(personaDiv);
    
    const combinedDiv = document.createElement('div');
    combinedDiv.id = 'qdaCombinedResultsInline';
    resultsDiv.appendChild(combinedDiv);
    
    const portfolioDiv = document.createElement('div');
    portfolioDiv.id = 'qdaPortfolioResultsInline';
    resultsDiv.appendChild(portfolioDiv);
    
    const creatorDiv = document.createElement('div');
    creatorDiv.id = 'qdaCreatorResultsInline';
    resultsDiv.appendChild(creatorDiv);
    
    const crossAnalysisDiv = document.createElement('div');
    crossAnalysisDiv.id = 'qdaCrossAnalysisResultsInline';
    resultsDiv.appendChild(crossAnalysisDiv);
    
    content.appendChild(resultsDiv);
    
    widget.appendChild(header);
    widget.appendChild(content);
    
    if (targetContainer) {
        // Clear container and append widget inline
        targetContainer.innerHTML = '';
        targetContainer.appendChild(widget);
    } else {
        // Original floating behavior
        document.body.appendChild(widget);
        // Make draggable only for floating version
        makeDraggable(widget);
    }
}

async function analyzeDataInline(widget) {
    const mainFileInput = document.getElementById('qdaMainFileInline');
    const portfolioFileInput = document.getElementById('qdaPortfolioFileInline');
    const creatorFileInput = document.getElementById('qdaCreatorFileInline');
    
    if (!mainFileInput.files[0]) {
        alert('Please select the Main Analysis CSV file');
        return;
    }

    const analyzeBtn = document.getElementById('qdaAnalyzeBtnInline');
    analyzeBtn.textContent = 'Analyzing...';
    analyzeBtn.disabled = true;

    try {
        const mainCsvText = await readFile(mainFileInput.files[0]);
        const portfolioCsvText = portfolioFileInput.files[0] ? await readFile(portfolioFileInput.files[0]) : null;
        const creatorCsvText = creatorFileInput.files[0] ? await readFile(creatorFileInput.files[0]) : null;
        
        console.log('Starting FIXED persona analysis with no overlaps...');
        const results = performQuantitativeAnalysis(mainCsvText, portfolioCsvText, creatorCsvText);
        
        // Store ALL results for export - including behavioral analysis
        sessionStorage.setItem('qdaSummaryStats', JSON.stringify(results.summaryStats));
        sessionStorage.setItem('qdaCorrelationResults', JSON.stringify(results.correlationResults));
        sessionStorage.setItem('qdaRegressionResults', JSON.stringify(results.regressionResults));
        
        if (results.portfolioAnalysis) {
            sessionStorage.setItem('qdaPortfolioAnalysis', JSON.stringify(results.portfolioAnalysis));
        }
        if (results.creatorAnalysis) {
            sessionStorage.setItem('qdaCreatorAnalysis', JSON.stringify(results.creatorAnalysis));
        }
        if (results.crossAnalysis) {
            sessionStorage.setItem('qdaCrossAnalysis', JSON.stringify(results.crossAnalysis));
        }
        
        // Display all results using inline versions
        displaySummaryStatsInline(results.summaryStats);
        displayDemographicBreakdownInline(results.summaryStats);
        displayPersonaBreakdownInline(results.summaryStats);
        displayCombinedAnalysisInline(results.correlationResults, results.regressionResults, results.cleanData);
        
        // Display enhanced sections if data available
        if (results.portfolioAnalysis) {
            displayPortfolioAnalysisInline(results.portfolioAnalysis);
        }
        if (results.creatorAnalysis) {
            displayCreatorAnalysisInline(results.creatorAnalysis);
        }
        if (results.crossAnalysis) {
            displayCrossAnalysisInline(results.crossAnalysis);
        }
        
        document.getElementById('qdaAnalysisResultsInline').style.display = 'block';
        console.log('FIXED Quantitative Driver Analysis completed - No persona overlaps!');
    } catch (error) {
        alert('Error analyzing data: ' + error.message);
        console.error('Full error:', error);
    } finally {
        analyzeBtn.textContent = 'Analyze Data';
        analyzeBtn.disabled = false;
    }
}

// Inline display functions (modified from original functions)
function displaySummaryStatsInline(stats) {
    const container = document.getElementById('qdaSummaryStatsInline');
    container.textContent = '';
    
    const resultSection = document.createElement('div');
    resultSection.className = 'qda-result-section';
    
    const title = document.createElement('h1');
    title.textContent = 'Summary Statistics';
    resultSection.appendChild(title);
    
    // Export button positioned in top right
    const exportBtn = document.createElement('button');
    exportBtn.className = 'qda-export-btn';
    exportBtn.textContent = 'Export PDF';
    exportBtn.addEventListener('click', exportReport);
    resultSection.appendChild(exportBtn);
    
    const metricSummary = document.createElement('div');
    metricSummary.className = 'qda-metric-summary';
    
    const metrics = [
        ['Total Users', stats.totalUsers.toLocaleString(), '18px'],
        ['Link Bank Rate', `${stats.linkBankConversion.toFixed(1)}%`, '18px'],
        ['Copy Rate', `${stats.firstCopyConversion.toFixed(1)}%`, '18px'],
        ['Deposit Rate', `${stats.depositConversion.toFixed(1)}%`, '18px'],
        ['Subscription Rate', `${stats.subscriptionConversion.toFixed(1)}%`, '18px']
    ];
    
    metrics.forEach(([title, content, size]) => {
        metricSummary.appendChild(createMetricCard(title, content, size));
    });
    
    resultSection.appendChild(metricSummary);
    container.appendChild(resultSection);
}

function displayDemographicBreakdownInline(stats) {
    const container = document.getElementById('qdaDemographicBreakdownInline');
    container.textContent = '';
    
    const resultSection = document.createElement('div');
    resultSection.className = 'qda-result-section';
    
    const title = document.createElement('h1');
    title.textContent = 'Demographic Breakdown';    
    resultSection.appendChild(title);

    const grid = document.createElement('div');
    grid.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px;';

    // Helper function to create a breakdown table
    const createBreakdownTable = (titleText, data, totalResponses) => {
        const tableContainer = document.createElement('div');
        tableContainer.style.maxWidth = '320px';    
        const tableTitle = document.createElement('h4');
        tableTitle.textContent = titleText;
        tableTitle.style.cssText = 'margin: 0 0 10px 0; font-size: 14px;';
        tableContainer.appendChild(tableTitle);

        const table = document.createElement('table');
        table.className = 'qda-regression-table';
        table.style.fontSize = '12px';
        table.style.width = '100%';

        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        ['Category', 'Percentage'].forEach(header => {
            const th = document.createElement('th');
            th.textContent = header;
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');

        // Convert to array of objects for easier sorting
        let dataArray = Object.keys(data)
            .filter(k => k.trim() !== '')
            .map(category => ({
                category,
                count: data[category],
                percentage: totalResponses > 0 ? (data[category] / totalResponses) * 100 : 0
            }));

        // Sort by percentage descending
        dataArray.sort((a, b) => b.percentage - a.percentage);

        dataArray.forEach(item => {
            const percentageFormatted = item.percentage.toFixed(1) + '%';
            tbody.appendChild(createTableRow([item.category, percentageFormatted]));
        });
        
        table.appendChild(tbody);
        tableContainer.appendChild(table);
        grid.appendChild(tableContainer);
    };

    const demographicConfigs = [
        { key: 'income', title: 'Income' },
        { key: 'netWorth', title: 'Net Worth' },
        { key: 'investingExperienceYears', title: 'Investing Experience Years' },
        { key: 'investingActivity', title: 'Investing Activity' },
        { key: 'investmentType', title: 'Investment Type' },
        { key: 'investingObjective', title: 'Investing Objective' }
    ];

    demographicConfigs.forEach(config => {
        createBreakdownTable(
            config.title,    
            stats[config.key + 'Breakdown'],    
            stats[config.key + 'TotalResponses']
        );
    });
    
    resultSection.appendChild(grid);
    container.appendChild(resultSection);
}

function displayPersonaBreakdownInline(stats) {
    const container = document.getElementById('qdaPersonaBreakdownInline');
    container.textContent = '';
    
    const resultSection = document.createElement('div');
    resultSection.className = 'qda-result-section';
    
    const title = document.createElement('h1');
    title.textContent = 'Fixed Persona Breakdown - No Overlaps';
    resultSection.appendChild(title);

    const grid = document.createElement('div');
    grid.style.cssText = 'display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px;';

    // FIXED PERSONA ORDER (by business priority)
    const personas = [
        {
            name: 'Premium',
            subtitle: 'Active subscriptions - highest revenue users',
            data: stats.personaStats.premium,
            priority: 1
        },
        {
            name: 'Aspiring Premium',
            subtitle: '$1000+ deposits, copies, higher income - premium conversion targets',
            data: stats.personaStats.aspiringPremium,
            priority: 2
        },
        {
            name: 'Core',
            subtitle: '$200-1000 deposits with banking OR active engagement - main user base',
            data: stats.personaStats.core,
            priority: 3
        },
        {
            name: 'Activation Targets',
            subtitle: 'Higher income prospects browsing creators but not converting',
            data: stats.personaStats.activationTargets,
            priority: 4
        },
        {
            name: 'Lower Income',
            subtitle: '≤$200 deposits, lower demographics, minimal engagement',
            data: stats.personaStats.lowerIncome,
            priority: 5
        },
        {
            name: 'Non-activated',
            subtitle: 'Zero banking, deposits, and platform engagement',
            data: stats.personaStats.nonActivated,
            priority: 6
        }
    ];

    personas.forEach(p => {
        const card = document.createElement('div');
        card.style.cssText = 'background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 8px; padding: 15px;';
        
        const nameEl = document.createElement('div');
        nameEl.style.cssText = 'font-weight: bold; color: #007bff; margin-bottom: 5px; font-size: 16px;';
        nameEl.textContent = `${p.priority}. ${p.name}`;
        card.appendChild(nameEl);

        const subtitleEl = document.createElement('div');
        subtitleEl.style.cssText = 'font-size: 12px; color: #6c757d; margin-bottom: 10px;';
        subtitleEl.textContent = p.subtitle;
        card.appendChild(subtitleEl);

        const percentageEl = document.createElement('div');
        percentageEl.style.cssText = 'font-size: 24px; font-weight: bold; color: #28a745; margin-bottom: 5px;';
        percentageEl.textContent = `${p.data.percentage.toFixed(1)}%`;
        card.appendChild(percentageEl);

        const countEl = document.createElement('div');
        countEl.style.cssText = 'font-size: 13px; color: #333;';
        countEl.textContent = `(N=${p.data.count.toLocaleString()})`;
        card.appendChild(countEl);

        grid.appendChild(card);
    });
    
    resultSection.appendChild(grid);
    container.appendChild(resultSection);
}

function displayCombinedAnalysisInline(correlationResults, regressionResults, cleanData) {
    const container = document.getElementById('qdaCombinedResultsInline');
    container.textContent = '';
    
    const resultSection = document.createElement('div');
    resultSection.className = 'qda-result-section';
    
    const title = document.createElement('h1');
    title.textContent = 'Behavioral Analysis';
    resultSection.appendChild(title);

    // Define the custom order of subsections
    const orderedOutcomes = [
        { outcome: 'totalDeposits', label: 'Deposit Funds' },
        { outcome: 'totalCopies', label: 'Portfolio Copies' },
        { outcome: 'totalSubscriptions', label: 'Subscriptions' }
    ];
    
    orderedOutcomes.forEach((config) => {
        const outcome = config.outcome;
        const outcomeLabel = config.label;
        
        const outcomeTitle = document.createElement('h4');
        outcomeTitle.textContent = outcomeLabel;
        resultSection.appendChild(outcomeTitle);
        
        const allVariables = Object.keys(correlationResults[outcome]);
        const regressionData = regressionResults[outcome.replace('total', '').toLowerCase()];
        
        // Apply section-specific exclusions
        const excludedVars = SECTION_EXCLUSIONS[outcome] || [];
        const filteredVariables = allVariables.filter(variable => !excludedVars.includes(variable));
        
        const combinedData = filteredVariables.map(variable => {
            const correlation = correlationResults[outcome][variable];
            const regressionItem = regressionData.find(item => item.variable === variable);
            const tippingPoint = calculateTippingPoint(cleanData, variable, outcome);
            
            return {
                variable: variable,
                correlation: correlation,
                tStat: regressionItem ? regressionItem.tStat : 0,
                tippingPoint: tippingPoint
            };
        }).sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
        
        // Calculate relative thresholds for T-statistics only
        const tStatThresholds = calculateRelativeStrengths(combinedData, 'tStat');
        
        // Apply relative strengths
        combinedData.forEach(item => {
            const absTStat = Math.abs(item.tStat);
            
            // Predictive strength (relative with 7 categories)
            if (absTStat >= tStatThresholds.strongThreshold) {
                item.predictiveStrength = 'Very Strong';
                item.predictiveClass = 'qda-strength-very-strong';
            } else if (absTStat >= tStatThresholds.moderateStrongThreshold) {
                item.predictiveStrength = 'Strong';
                item.predictiveClass = 'qda-strength-strong';
            } else if (absTStat >= tStatThresholds.moderateThreshold) {
                item.predictiveStrength = 'Moderate - Strong';
                item.predictiveClass = 'qda-strength-moderate-strong';
            } else if (absTStat >= tStatThresholds.weakModerateThreshold) {
                item.predictiveStrength = 'Moderate';
                item.predictiveClass = 'qda-strength-moderate';
            } else if (absTStat >= tStatThresholds.weakThreshold) {
                item.predictiveStrength = 'Weak - Moderate';
                item.predictiveClass = 'qda-strength-weak-moderate';
            } else if (absTStat >= tStatThresholds.veryWeakThreshold) {
                item.predictiveStrength = 'Weak';
                item.predictiveClass = 'qda-strength-weak';
            } else {
                item.predictiveStrength = 'Very Weak';
                item.predictiveClass = 'qda-strength-very-weak';
            }
        });
        
        const table = document.createElement('table');
        table.className = 'qda-regression-table';
        
        // Create header with 5 columns (removed Correlation Strength)
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        ['Variable', 'Correlation', 'T-Statistic', 'Predictive Strength', 'Tipping Point'].forEach(header => {
            const th = document.createElement('th');
            th.textContent = header;
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);
        
        // Create body - show top 25 variables (increased from 20)
        const tbody = document.createElement('tbody');
        combinedData.slice(0, 25).forEach(item => {
            const rowData = [
                getVariableLabel(item.variable),
                item.correlation.toFixed(3),
                item.tStat.toFixed(3),
                { text: item.predictiveStrength, className: item.predictiveClass, html: true },
                item.tippingPoint !== 'N/A' ?    
                    (typeof item.tippingPoint === 'number' ? item.tippingPoint.toFixed(1) : item.tippingPoint) :
                    'N/A'
            ];
            tbody.appendChild(createTableRow(rowData));
        });
        table.appendChild(tbody);
        
        resultSection.appendChild(table);
    });
    
    container.appendChild(resultSection);
}

function displayPortfolioAnalysisInline(portfolioAnalysis) {
    const container = document.getElementById('qdaPortfolioResultsInline');
    container.textContent = '';
    
    if (!portfolioAnalysis) return;
    
    const resultSection = document.createElement('div');
    resultSection.className = 'qda-result-section';
    
    const title = document.createElement('h1');
    title.textContent = 'Portfolio Performance Analysis';
    resultSection.appendChild(title);
    
    // Summary metrics
    const summaryGrid = document.createElement('div');
    summaryGrid.className = 'qda-metric-summary';
    
    summaryGrid.appendChild(createMetricCard('Total Portfolios', portfolioAnalysis.totalPortfolios.toLocaleString(), '16px'));
    summaryGrid.appendChild(createMetricCard('Avg View-to-Copy Rate', `${portfolioAnalysis.avgViewToCopyRate.toFixed(2)}%`, '16px'));
    
    resultSection.appendChild(summaryGrid);
    
    // Top performing portfolios
    const performanceTitle = document.createElement('h4');
    performanceTitle.textContent = 'Top Performing Portfolios';
    resultSection.appendChild(performanceTitle);
    
    const performanceGrid = document.createElement('div');
    performanceGrid.className = 'qda-performance-grid';
    performanceGrid.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin: 20px 0;';
    
    portfolioAnalysis.topPerformers.slice(0, 6).forEach(portfolio => {
        const card = document.createElement('div');
        card.style.cssText = 'background: white; border: 1px solid #ddd; border-radius: 8px; padding: 15px;';
        
        const titleDiv = document.createElement('div');
        titleDiv.style.cssText = 'font-weight: bold; margin-bottom: 8px; color: #007bff;';
        titleDiv.textContent = portfolio.ticker;
        card.appendChild(titleDiv);
        
        const metrics = [
            `Total Copies: ${portfolio.totalCopies}`,
            `Views: ${portfolio.totalViews.toLocaleString()}`,
            `Conversion: ${portfolio.viewToCopyRate.toFixed(2)}%`,
            `Unique Users: ${portfolio.uniqueUsers}`
        ];
        
        metrics.forEach(metric => {
            const metricDiv = document.createElement('div');
            metricDiv.style.cssText = 'margin: 4px 0; font-size: 13px;';
            metricDiv.textContent = metric;
            card.appendChild(metricDiv);
        });
        
        performanceGrid.appendChild(card);
    });
    
    resultSection.appendChild(performanceGrid);
    container.appendChild(resultSection);
}

function displayCreatorAnalysisInline(creatorAnalysis) {
    const container = document.getElementById('qdaCreatorResultsInline');
    container.textContent = '';
    
    if (!creatorAnalysis) return;
    
    const resultSection = document.createElement('div');
    resultSection.className = 'qda-result-section';
    
    const title = document.createElement('h1');
    title.textContent = 'Creator Performance Analysis';
    resultSection.appendChild(title);
    
    // Summary metrics
    const summaryGrid = document.createElement('div');
    summaryGrid.className = 'qda-metric-summary';
    
    summaryGrid.appendChild(createMetricCard('Total Creators', creatorAnalysis.totalCreators.toLocaleString(), '16px'));
    summaryGrid.appendChild(createMetricCard('Avg Subscription Rate', `${creatorAnalysis.avgSubscriptionRate.toFixed(2)}%`, '16px'));
    
    resultSection.appendChild(summaryGrid);
    
    // Top performing creators
    const performanceTitle = document.createElement('h4');
    performanceTitle.textContent = 'Top Performing Creators';
    resultSection.appendChild(performanceTitle);
    
    const performanceGrid = document.createElement('div');
    performanceGrid.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin: 20px 0;';
    
    creatorAnalysis.topPerformers.slice(0, 6).forEach(creator => {
        const card = document.createElement('div');
        card.style.cssText = 'background: white; border: 1px solid #ddd; border-radius: 8px; padding: 15px;';
        
        const titleDiv = document.createElement('div');
        titleDiv.style.cssText = 'font-weight: bold; margin-bottom: 8px; color: #007bff;';
        titleDiv.textContent = creator.username;
        card.appendChild(titleDiv);
        
        const metrics = [
            `Subscriptions: ${creator.totalSubscriptions}`,
            `Paywall Views: ${creator.totalPaywallViews.toLocaleString()}`,
            `Sub Rate: ${creator.subscriptionConversionRate.toFixed(2)}%`,
            `Portfolio Views: ${creator.totalPortfolioViews.toLocaleString()}`
        ];
        
        metrics.forEach(metric => {
            const metricDiv = document.createElement('div');
            metricDiv.style.cssText = 'margin: 4px 0; font-size: 13px;';
            metricDiv.textContent = metric;
            card.appendChild(metricDiv);
        });
        
        performanceGrid.appendChild(card);
    });
    
    resultSection.appendChild(performanceGrid);
    container.appendChild(resultSection);
}

function displayCrossAnalysisInline(crossAnalysis) {
    const container = document.getElementById('qdaCrossAnalysisResultsInline');
    container.textContent = '';
    
    if (!crossAnalysis) return;
    
    const resultSection = document.createElement('div');
    resultSection.className = 'qda-result-section';
    
    const title = document.createElement('h1');
    title.textContent = 'Additional Analysis';
    resultSection.appendChild(title);
    
    const analysisGrid = document.createElement('div');
    analysisGrid.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin: 20px 0;';
    
    // Portfolio diversity analysis
    if (crossAnalysis.portfolioDiversity) {
        const portfolioCard = document.createElement('div');
        portfolioCard.style.cssText = 'background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 8px; padding: 15px;';
        
        const portfolioTitle = document.createElement('div');
        portfolioTitle.style.cssText = 'font-weight: bold; color: #007bff; margin-bottom: 10px;';
        portfolioTitle.textContent = 'Portfolio Diversity';
        portfolioCard.appendChild(portfolioTitle);
        
        const portfolioMetrics = [
            `Avg portfolios per user: ${crossAnalysis.portfolioDiversity.avgPortfoliosPerUser.toFixed(1)}`,
            `Multi-portfolio users: ${crossAnalysis.portfolioDiversity.usersWithMultiplePortfolios.toLocaleString()}`
        ];
        
        portfolioMetrics.forEach(metric => {
            const metricDiv = document.createElement('div');
            metricDiv.style.cssText = 'margin: 6px 0; font-size: 13px;';
            metricDiv.textContent = metric;
            portfolioCard.appendChild(metricDiv);
        });
        
        analysisGrid.appendChild(portfolioCard);
    }
    
    // Creator diversity analysis
    if (crossAnalysis.creatorDiversity) {
        const creatorCard = document.createElement('div');
        creatorCard.style.cssText = 'background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 8px; padding: 15px;';
        
        creatorTitle.style.cssText = 'font-weight: bold; color: #007bff; margin-bottom: 10px;';
        creatorTitle.textContent = 'Creator Engagement';
        creatorCard.appendChild(creatorTitle);
        
        const creatorMetrics = [
            `Avg creators per user: ${crossAnalysis.creatorDiversity.avgCreatorsPerUser.toFixed(1)}`,
            `Multi-creator users: ${crossAnalysis.creatorDiversity.usersWithMultipleCreators.toLocaleString()}`
        ];
        
        creatorMetrics.forEach(metric => {
            const metricDiv = document.createElement('div');
            metricDiv.style.cssText = 'margin: 6px 0; font-size: 13px;';
            metricDiv.textContent = metric;
            creatorCard.appendChild(metricDiv);
        });
        
        analysisGrid.appendChild(creatorCard);
    }
    
    if (crossAnalysis.powerUserSegment) {
        const powerUserCard = document.createElement('div');
        powerUserCard.style.cssText = 'background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 8px; padding: 15px;';
        
        const powerUserTitle = document.createElement('div');
        powerUserTitle.style.cssText = 'font-weight: bold; color: #007bff; margin-bottom: 10px;';
        powerUserTitle.textContent = 'Power Users';
        powerUserCard.appendChild(powerUserTitle);
        
        const powerUserMetrics = [
            `Count: ${crossAnalysis.powerUserSegment.count.toLocaleString()}`,
            `Percentage: ${crossAnalysis.powerUserSegment.percentage.toFixed(1)}%`
        ];
        
        powerUserMetrics.forEach(metric => {
            const metricDiv = document.createElement('div');
            metricDiv.style.cssText = 'margin: 6px 0; font-size: 13px;';
            metricDiv.textContent = metric;
            powerUserCard.appendChild(metricDiv);
        });
        
        // Add help text definition
        const helpText = document.createElement('div');
        helpText.style.cssText = 'margin-top: 10px; font-size: 11px; color: #6c757d; font-style: italic;';
        helpText.textContent = 'Defined as $1,000+ deposits, 1+ subscription or 2+ copies';
        powerUserCard.appendChild(helpText);
        
        analysisGrid.appendChild(powerUserCard);
    }
    
    resultSection.appendChild(analysisGrid);
    container.appendChild(resultSection);
}

// Keep original floating widget functions for backwards compatibility
function createWidget() {// Enhanced Quantitative Driver Analysis - FIXED Persona Logic
'use strict';

// --- 1. CANONICAL VARIABLE LIST (STANDARDISATION) ---
// Define a single list for all variables used in both correlation and regression
const ALL_VARIABLES = [
    'hasLinkedBank', 'totalCopyStarts', 'totalStripeViews', 'paywallViews',
    'regularPDPViews', 'premiumPDPViews', 'uniqueCreatorsInteracted',
    'uniquePortfoliosInteracted', 'timeToFirstCopy', 'timeToDeposit', 'timeToLinkedBank',
    'incomeEnum', 'netWorthEnum', 'availableCopyCredits', 'buyingPower',
    'activeCreatedPortfolios', 'lifetimeCreatedPortfolios', 'totalBuys', 'totalSells',
    'totalTrades', 'totalWithdrawalCount', 'totalWithdrawals', 'totalOfUserProfiles',
    'totalDepositCount', 'subscribedWithin7Days', 'totalRegularCopies',
    'regularCreatorProfileViews', 'premiumCreatorProfileViews', 'appSessions',
    'discoverTabViews', 'leaderboardViews', 'premiumTabViews'
];

// Section-specific exclusions for display only
const SECTION_EXCLUSIONS = {
    'totalDeposits': ['totalDepositCount'], // Remove from Deposit Funds section
    'totalCopies': ['totalBuys', 'totalTrades', 'totalRegularCopies'] // Remove from Portfolio Copies section
};

// Updated styles for inline display
const styles = `
    .qda-inline-widget {
        background: white;
        border: 2px solid #007bff;
        border-radius: 10px;
        font-family: Arial, sans-serif;
        font-size: 14px;
        max-width: 1200px;
        margin: 0 auto;
        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    }
    
    .qda-header {
        background: #007bff;
        color: white;
        padding: 15px;
        border-radius: 8px 8px 0 0;
        text-align: center;
    }
    
    .qda-content {
        padding: 20px;
        background: white;
    }
    
    .qda-upload-section {
        border: 2px dashed #007bff;
        border-radius: 8px;
        padding: 20px;
        margin-bottom: 40px;
        background: #f8f9fa;
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 20px;
    }
    
    .qda-upload-column {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        padding: 15px;
        background: white;
        border-radius: 8px;
        border: 1px solid #dee2e6;
    }
    
    .qda-file-label {
        font-weight: bold;
        color: #333;
        margin-bottom: 10px;
        font-size: 14px;
    }
    
    .qda-file-input {
        padding: 8px;
        border: 1px solid #ddd;
        border-radius: 4px;
        width: 100%;
        margin-bottom: 8px;
    }
    
    .qda-file-description {
        font-size: 12px;
        color: #666;
        margin-top: 5px;
        line-height: 1.3;
    }
    
    .qda-btn {
        background: #007bff;
        color: white;
        padding: 8px 20px;
        border: none;
        border-radius: 5px;
        cursor: pointer;
        font-size: 14px;
        white-space: nowrap;
    }
    
    .qda-btn:hover {
        background: #0056b3;
    }
    
    .qda-btn:disabled {
        background: #ccc;
        cursor: not-allowed;
    }
    
    .qda-analyze-row {
        margin-top: 20px;
        text-align: center;
        grid-column: 1 / -1;
    }
    
    .qda-analysis-results {
        display: none;
        background: white;
    }
    
    .qda-result-section {
        margin: 30px 0;
        position: relative;
    }
    
    .qda-result-section h1 {
        margin: 0 0 20px 0;
        padding: 10px 0 10px 15px;
        border-left: 4px solid #007bff;
        font-size: 28px;
        font-weight: bold;
    }
    
    .qda-result-section h4 {
        font-size: 18px;
        font-weight: bold;
        margin: 20px 0 15px 0;
        color: #333;
    }
    
    .qda-export-btn {
        position: absolute;
        top: 0;
        right: 0;
        background: #007bff;
        color: white;
        border: none;
        padding: 8px 12px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
    }
    
    .qda-export-btn:hover {
        background: #0056b3;
    }
    
    .qda-regression-table {
        width: 100%;
        border-collapse: collapse;
        margin: 15px 0;
        font-size: 12px;
    }
    
    .qda-regression-table th, .qda-regression-table td {
        border: 1px solid #ddd;
        padding: 6px;
        text-align: left;
    }
    
    .qda-regression-table th {
        background-color: #f2f2f2;
        font-weight: bold;
    }
    
    .qda-insight-box {
        background: #e7f3ff;
        border: 1px solid #007bff;
        border-radius: 5px;
        padding: 15px;
        margin: 10px 0;
        font-size: 13px;
    }
    
    .qda-metric-summary {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 10px;
        margin: 20px 0;
    }
    
    .qda-metric-card {
        background: white;
        border: 1px solid #ddd;
        border-radius: 5px;
        padding: 10px;
        text-align: center;
        font-size: 12px;
    }
    
    .qda-strength-very-weak {
        background-color: #D9D9D9;
        color: #333333;
        padding: 4px 8px;
        border-radius: 4px;
        font-weight: bold;
    }
    
    .qda-strength-weak {
        background-color: #E8E5A3;
        color: #333333;
        padding: 4px 8px;
        border-radius: 4px;
        font-weight: bold;
    }
    
    .qda-strength-weak-moderate {
        background-color: #F6F16E;
        color: #333333;
        padding: 4px 8px;
        border-radius: 4px;
        font-weight: bold;
    }
    
    .qda-strength-moderate {
        background-color: #FFE787;
        color: #333333;
        padding: 4px 8px;
        border-radius: 4px;
        font-weight: bold;
    }
    
    .qda-strength-moderate-strong {
        background-color: #B3E4A1;
        color: #333333;
        padding: 4px 8px;
        border-radius: 4px;
        font-weight: bold;
    }
    
    .qda-strength-strong {
        background-color: #66E1BB;
        color: #333333;
        padding: 4px 8px;
        border-radius: 4px;
        font-weight: bold;
    }
    
    .qda-strength-very-strong {
        background-color: #00CF84;
        color: white;
        padding: 4px 8px;
        border-radius: 4px;
        font-weight: bold;
    }
`;

// Inject styles
const styleSheet = document.createElement('style');
styleSheet.textContent = styles;
document.head.appendChild(styleSheet);

// CSV parsing
function parseCSV(text) {
    const lines = text.split('\n');
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const data = [];
    
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim()) {
            const values = lines[i].split(',');
            const row = {};
            headers.forEach((header, index) => {
                let value = values[index] ? values[index].trim().replace(/"/g, '') : '';
                if (value === 'TRUE' || value === 'true') value = true;
                else if (value === 'FALSE' || value === 'false') value = false;
                else if (!isNaN(value) && value !== '') value = parseFloat(value);
                row[header] = value;
            });
            data.push(row);
        }
    }
    
    return { data };
}

// Helper functions
function cleanNumeric(value) {
    if (value === null || value === undefined || value === '' || isNaN(value)) return 0;
    return parseFloat(value) || 0;
}

function convertIncomeToEnum(income) {
    const incomeMap = {
        'Less than $25,000': 1, '$25,000-$49,999': 2, '$50,000-$74,999': 3,
        '$75,000-$99,999': 4, '$100,000-$149,999': 5, '$150,000-$199,999': 6, '$200,000+': 7
    };
    return incomeMap[income] || 0;
}

function convertNetWorthToEnum(netWorth) {
    const netWorthMap = {
        'Less than $10,000': 1, '$10,000-$49,999': 2, '$50,000-$99,999': 3,
        '$100,000-$249,999': 4, '$250,000-$499,999': 5, '$500,000-$999,999': 6, '$1,000,000+': 7
    };
    return netWorthMap[netWorth] || 0;
}

function calculateDemographicBreakdown(data, key) {
    let totalResponses = 0;
    const counts = data.reduce((acc, d) => {
        const value = d[key];
        if (value && typeof value === 'string' && value.trim() !== '') {
            acc[value] = (acc[value] || 0) + 1;
            totalResponses++;
        }
        return acc;
    }, {});
    return { counts, totalResponses };
}

function calculateTippingPoint(data, variable, outcome) {
    // Group users by variable value and calculate conversion rates
    const groups = {};
    data.forEach(user => {
        const value = Math.floor(user[variable]) || 0; // Round down to nearest integer
        const converted = user[outcome] > 0 ? 1 : 0;
        
        if (!groups[value]) {
            groups[value] = { total: 0, converted: 0 };
        }
        groups[value].total++;
        groups[value].converted += converted;
    });
    
    // Calculate conversion rates for each value
    const conversionRates = Object.keys(groups)
        .map(value => ({
            value: parseInt(value),
            rate: groups[value].converted / groups[value].total,
            total: groups[value].total
        }))
        .filter(item => item.total >= 10) // Only include groups with at least 10 users
        .sort((a, b) => a.value - b.value);
    
    if (conversionRates.length < 2) return 'N/A';
    
    // Find the point where conversion rate significantly increases
    let maxIncrease = 0;
    let tippingPoint = 'N/A';
    
    for (let i = 1; i < conversionRates.length; i++) {
        const increase = conversionRates[i].rate - conversionRates[i-1].rate;
        if (increase > maxIncrease && conversionRates[i].rate > 0.1) { // At least 10% conversion rate
            maxIncrease = increase;
            tippingPoint = conversionRates[i].value;
        }
    }
    
    return tippingPoint;
}

// FIXED PERSONA CLASSIFICATION - Hierarchical Priority Approach
function classifyPersona(user) {
    // Helper functions
    function isLowerOrUnknownIncome(income) {
        const lowerIncomes = ['<25k', '25k–50k', '50k–100k'];
        return !income || income.trim() === '' || lowerIncomes.includes(income);
    }
    
    function isLowerOrUnknownNetWorth(netWorth) {
        return !netWorth || netWorth.trim() === '' || netWorth === '<100k';
    }
    
    function isHigherOrUnknownIncome(income) {
        const lowerIncomes = ['<25k', '25k–50k', '50k–100k'];
        return !income || income.trim() === '' || !lowerIncomes.includes(income);
    }
    
    const totalPDPViews = (user.regularPDPViews || 0) + (user.premiumPDPViews || 0);
    const totalCreatorViews = (user.regularCreatorProfileViews || 0) + (user.premiumCreatorProfileViews || 0);
    const hasCopied = user.totalCopies >= 1;
    
    // HIERARCHICAL PRIORITY ORDER (highest value first)
    
    // 1. PREMIUM: Active subscriptions (highest priority)
    if (user.totalSubscriptions >= 1 || user.subscribedWithin7Days === 1) {
        return 'premium';
    }
    
    // 2. ASPIRING PREMIUM: High deposits + copies + higher income (second priority)
    if (user.totalSubscriptions === 0 &&
        hasCopied &&
        isHigherOrUnknownIncome(user.income) &&
        user.totalDeposits >= 1000) {
        return 'aspiringPremium';
    }
    
    // 3. CORE: Moderate deposits with banking OR engagement (third priority)
    if (user.totalSubscriptions === 0) {
        const depositQualifies = (user.totalDeposits >= 200 && user.totalDeposits <= 1000 && user.hasLinkedBank === 1);
        const engagementQualifies = (hasCopied || totalPDPViews >= 2);
        
        if (depositQualifies || engagementQualifies) {
            return 'core';
        }
    }
    
    // 4. ACTIVATION TARGETS: Higher income prospects browsing
    if (isHigherOrUnknownIncome(user.income) &&
        user.hasLinkedBank === 0 &&
        user.totalDeposits === 0 &&
        user.totalCopies === 0 &&
        totalCreatorViews > 0 &&
        totalPDPViews < 2) {
        return 'activationTargets';
    }
    
    // 5. LOWER INCOME: Small depositors with lower demographics
    const hasEngagement = hasCopied || totalPDPViews >= 1;
    if (user.totalDeposits <= 200 &&
        isLowerOrUnknownIncome(user.income) &&
        isLowerOrUnknownNetWorth(user.netWorth) &&
        user.totalSubscriptions === 0 &&
        user.hasLinkedBank === 1 &&
        !hasEngagement) {
        return 'lowerIncome';
    }
    
    // 6. NON-ACTIVATED: Completely inactive (lowest priority)
    if (user.hasLinkedBank === 0 &&
        user.totalDeposits === 0 &&
        totalPDPViews === 0 &&
        totalCreatorViews === 0) {
        return 'nonActivated';
    }
    
    // Default: Unclassified (shouldn't happen with good data)
    return 'unclassified';
}

// COMPLETE export function with ALL analysis sections - FIXED SYNTAX
function exportReport() {
    try {
        const summaryStats = JSON.parse(sessionStorage.getItem('qdaSummaryStats') || '{}');
        const portfolioAnalysis = JSON.parse(sessionStorage.getItem('qdaPortfolioAnalysis') || 'null');
        const creatorAnalysis = JSON.parse(sessionStorage.getItem('qdaCreatorAnalysis') || 'null');
        const crossAnalysis = JSON.parse(sessionStorage.getItem('qdaCrossAnalysis') || 'null');
        const correlationResults = JSON.parse(sessionStorage.getItem('qdaCorrelationResults') || '{}');
        const regressionResults = JSON.parse(sessionStorage.getItem('qdaRegressionResults') || '{}');
        
        let htmlContent = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Complete QDA Report - FIXED Personas</title>';
        
        // Add CSS styles
        htmlContent += '<style>';
        htmlContent += '@media print { @page { margin: 0.5in; size: A4; } body { font-family: Arial, sans-serif; font-size: 9px; line-height: 1.2; color: #333; margin: 0; } .no-print { display: none !important; } .keep-together { page-break-inside: avoid; } .behavioral-section { page-break-inside: avoid; margin-bottom: 15px; } .behavioral-page-break { page-break-before: always; } }';
        htmlContent += '@media screen { body { font-family: Arial, sans-serif; margin: 20px; background: white; } .print-btn { position: fixed; top: 20px; right: 20px; background: #007bff; color: white; border: none; padding: 12px 24px; border-radius: 5px; cursor: pointer; z-index: 1000; } }';
        htmlContent += 'h1 { color: #007bff; font-size: 20px; border-bottom: 2px solid #007bff; padding-bottom: 8px; margin: 20px 0 15px 0; }';
        htmlContent += 'h2 { color: #007bff; font-size: 16px; border-left: 4px solid #007bff; padding-left: 8px; margin: 20px 0 10px 0; }';
        htmlContent += 'table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 8px; }';
        htmlContent += 'th, td { border: 1px solid #ddd; padding: 3px; text-align: left; vertical-align: top; }';
        htmlContent += 'th { background-color: #f8f9fa !important; font-weight: bold; }';
        htmlContent += '.summary-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; margin: 10px 0; }';
        htmlContent += '.summary-card { border: 1px solid #ddd; padding: 6px; text-align: center; background: #f8f9fa; font-size: 8px; }';
        htmlContent += '.persona-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin: 10px 0; }';
        htmlContent += '.persona-card { border: 1px solid #ddd; padding: 8px; background: #f8f9fa; font-size: 8px; }';
        htmlContent += '.persona-name { font-weight: bold; color: #007bff; font-size: 10px; margin-bottom: 2px; }';
        htmlContent += '.persona-subtitle { font-size: 7px; color: #666; margin-bottom: 4px; }';
        htmlContent += '.persona-percentage { font-size: 14px; font-weight: bold; color: #28a745; }';
        htmlContent += '.strength-very-weak { background-color: #D9D9D9; color: #333; }';
        htmlContent += '.strength-weak { background-color: #E8E5A3; color: #333; }';
        htmlContent += '.strength-weak-moderate { background-color: #F6F16E; color: #333; }';
        htmlContent += '.strength-moderate { background-color: #FFE787; color: #333; }';
        htmlContent += '.strength-moderate-strong { background-color: #B3E4A1; color: #333; }';
        htmlContent += '.strength-strong { background-color: #66E1BB; color: #333; }';
        htmlContent += '.strength-very-strong { background-color: #00CF84; color: white; }';
        htmlContent += '</style></head><body>';
        
        // Add print button
        htmlContent += '<button class="print-btn no-print" onclick="window.print()">Save as PDF</button>';
        
        // Add header
        htmlContent += '<h1>Complete Quantitative Driver Analysis Report - FIXED Personas</h1>';
        htmlContent += '<p><strong>Generated:</strong> ' + new Date().toLocaleString() + '</p>';
        htmlContent += '<p><strong>Version:</strong> Hierarchical Priority - No Overlap - Complete Export</p>';
        
        // Summary Statistics
        htmlContent += '<h1>Summary Statistics</h1>';
        htmlContent += '<div class="summary-grid">';
        htmlContent += '<div class="summary-card"><strong>Total Users</strong><br><span style="font-size: 12px; font-weight: bold;">' + (summaryStats.totalUsers ? summaryStats.totalUsers.toLocaleString() : 'N/A') + '</span></div>';
        htmlContent += '<div class="summary-card"><strong>Link Bank Rate</strong><br><span style="font-size: 12px; font-weight: bold;">' + (summaryStats.linkBankConversion ? summaryStats.linkBankConversion.toFixed(1) + '%' : 'N/A') + '</span></div>';
        htmlContent += '<div class="summary-card"><strong>Copy Rate</strong><br><span style="font-size: 12px; font-weight: bold;">' + (summaryStats.firstCopyConversion ? summaryStats.firstCopyConversion.toFixed(1) + '%' : 'N/A') + '</span></div>';
        htmlContent += '<div class="summary-card"><strong>Deposit Rate</strong><br><span style="font-size: 12px; font-weight: bold;">' + (summaryStats.depositConversion ? summaryStats.depositConversion.toFixed(1) + '%' : 'N/A') + '</span></div>';
        htmlContent += '<div class="summary-card"><strong>Subscription Rate</strong><br><span style="font-size: 12px; font-weight: bold;">' + (summaryStats.subscriptionConversion ? summaryStats.subscriptionConversion.toFixed(1) + '%' : 'N/A') + '</span></div>';
        htmlContent += '</div>';
        
        // Persona Breakdown
        htmlContent += '<h1>Fixed Persona Breakdown - No Overlaps</h1>';
        htmlContent += '<div class="persona-grid">';
        if (summaryStats.personaStats) {
            htmlContent += '<div class="persona-card"><div class="persona-name">1. Premium</div><div class="persona-subtitle">Active subscriptions - highest revenue users</div><div class="persona-percentage">' + summaryStats.personaStats.premium.percentage.toFixed(1) + '%</div><div>(N=' + summaryStats.personaStats.premium.count.toLocaleString() + ')</div></div>';
            htmlContent += '<div class="persona-card"><div class="persona-name">2. Aspiring Premium</div><div class="persona-subtitle">$1000+ deposits, copies, higher income - premium conversion targets</div><div class="persona-percentage">' + summaryStats.personaStats.aspiringPremium.percentage.toFixed(1) + '%</div><div>(N=' + summaryStats.personaStats.aspiringPremium.count.toLocaleString() + ')</div></div>';
            htmlContent += '<div class="persona-card"><div class="persona-name">3. Core</div><div class="persona-subtitle">$200-1000 deposits with banking OR active engagement - main user base</div><div class="persona-percentage">' + summaryStats.personaStats.core.percentage.toFixed(1) + '%</div><div>(N=' + summaryStats.personaStats.core.count.toLocaleString() + ')</div></div>';
            htmlContent += '<div class="persona-card"><div class="persona-name">4. Activation Targets</div><div class="persona-subtitle">Higher income prospects browsing creators but not converting</div><div class="persona-percentage">' + summaryStats.personaStats.activationTargets.percentage.toFixed(1) + '%</div><div>(N=' + summaryStats.personaStats.activationTargets.count.toLocaleString() + ')</div></div>';
            htmlContent += '<div class="persona-card"><div class="persona-name">5. Lower Income</div><div class="persona-subtitle">≤$200 deposits, lower demographics, minimal engagement</div><div class="persona-percentage">' + summaryStats.personaStats.lowerIncome.percentage.toFixed(1) + '%</div><div>(N=' + summaryStats.personaStats.lowerIncome.count.toLocaleString() + ')</div></div>';
            htmlContent += '<div class="persona-card"><div class="persona-name">6. Non-activated</div><div class="persona-subtitle">Zero banking, deposits, and platform engagement</div><div class="persona-percentage">' + summaryStats.personaStats.nonActivated.percentage.toFixed(1) + '%</div><div>(N=' + summaryStats.personaStats.nonActivated.count.toLocaleString() + ')</div></div>';
        }
        htmlContent += '</div>';
        
        // Demographic Breakdown - 3x2 table
        htmlContent += '<h1>Demographic Breakdown</h1>';
        htmlContent += '<table style="width: 100%; border-collapse: collapse; margin: 10px 0; table-layout: fixed;">';
        
        // First row
        htmlContent += '<tr>';
        const firstRowDemographics = [
            { key: 'income', title: 'Income' },
            { key: 'netWorth', title: 'Net Worth' },
            { key: 'investingExperienceYears', title: 'Investing Experience Years' }
        ];
        
        firstRowDemographics.forEach(config => {
            const breakdownData = summaryStats[config.key + 'Breakdown'] || {};
            const totalResponses = summaryStats[config.key + 'TotalResponses'] || 0;
            
            htmlContent += '<td style="width: 33.33%; vertical-align: top; padding: 4px; border: 1px solid #ddd;">';
            htmlContent += '<div style="background: #f8f9fa; border-radius: 4px; padding: 4px; height: 100%;">';
            htmlContent += '<h4 style="margin: 0 0 4px 0; font-size: 9px; color: #007bff; font-weight: bold; text-align: center;">' + config.title + '</h4>';
            htmlContent += '<table style="width: 100%; font-size: 6px; border-collapse: collapse;">';
            htmlContent += '<thead><tr><th style="background: #e9ecef; padding: 1px; border: 1px solid #ccc; font-size: 6px;">Category</th><th style="background: #e9ecef; padding: 1px; border: 1px solid #ccc; font-size: 6px;">%</th></tr></thead>';
            htmlContent += '<tbody>';
            
            const sortedData = Object.keys(breakdownData)
                .filter(k => k.trim() !== '')
                .map(category => ({
                    category: category.length > 15 ? category.substring(0, 15) + '...' : category,
                    percentage: totalResponses > 0 ? (breakdownData[category] / totalResponses) * 100 : 0
                }))
                .sort((a, b) => b.percentage - a.percentage)
                .slice(0, 4);
            
            sortedData.forEach(item => {
                htmlContent += '<tr><td style="padding: 1px; border: 1px solid #ccc; font-size: 5px;">' + item.category + '</td><td style="padding: 1px; border: 1px solid #ccc; text-align: center; font-size: 6px;">' + item.percentage.toFixed(1) + '%</td></tr>';
            });
            
            htmlContent += '</tbody></table></div></td>';
        });
        htmlContent += '</tr>';
        
        // Second row
        htmlContent += '<tr>';
        const secondRowDemographics = [
            { key: 'investingActivity', title: 'Investing Activity' },
            { key: 'investmentType', title: 'Investment Type' },
            { key: 'investingObjective', title: 'Investing Objective' }
        ];
        
        secondRowDemographics.forEach(config => {
            const breakdownData = summaryStats[config.key + 'Breakdown'] || {};
            const totalResponses = summaryStats[config.key + 'TotalResponses'] || 0;
            
            htmlContent += '<td style="width: 33.33%; vertical-align: top; padding: 4px; border: 1px solid #ddd;">';
            htmlContent += '<div style="background: #f8f9fa; border-radius: 4px; padding: 4px; height: 100%;">';
            htmlContent += '<h4 style="margin: 0 0 4px 0; font-size: 9px; color: #007bff; font-weight: bold; text-align: center;">' + config.title + '</h4>';
            htmlContent += '<table style="width: 100%; font-size: 6px; border-collapse: collapse;">';
            htmlContent += '<thead><tr><th style="background: #e9ecef; padding: 1px; border: 1px solid #ccc; font-size: 6px;">Category</th><th style="background: #e9ecef; padding: 1px; border: 1px solid #ccc; font-size: 6px;">%</th></tr></thead>';
            htmlContent += '<tbody>';
            
            const sortedData = Object.keys(breakdownData)
                .filter(k => k.trim() !== '')
                .map(category => ({
                    category: category.length > 15 ? category.substring(0, 15) + '...' : category,
                    percentage: totalResponses > 0 ? (breakdownData[category] / totalResponses) * 100 : 0
                }))
                .sort((a, b) => b.percentage - a.percentage)
                .slice(0, 4);
            
            sortedData.forEach(item => {
                htmlContent += '<tr><td style="padding: 1px; border: 1px solid #ccc; font-size: 5px;">' + item.category + '</td><td style="padding: 1px; border: 1px solid #ccc; text-align: center; font-size: 6px;">' + item.percentage.toFixed(1) + '%</td></tr>';
            });
            
            htmlContent += '</tbody></table></div></td>';
        });
        htmlContent += '</tr></table>';
        
        // Behavioral Analysis - with page break
        htmlContent += '<div class="behavioral-page-break"><h1>Behavioral Analysis - Complete Driver Tables</h1></div>';
        
        if (correlationResults.totalDeposits) {
            const outcomes = [
                { key: 'totalDeposits', label: 'Deposit Funds', regKey: 'deposits' },
                { key: 'totalCopies', label: 'Portfolio Copies', regKey: 'copies' },
                { key: 'totalSubscriptions', label: 'Subscriptions', regKey: 'subscriptions' }
            ];
            
            outcomes.forEach(outcome => {
                const allVariables = Object.keys(correlationResults[outcome.key] || {});
                const regressionData = regressionResults[outcome.regKey] || [];
                
                // Apply section-specific exclusions
                const excludedVars = SECTION_EXCLUSIONS[outcome.key] || [];
                const filteredVariables = allVariables.filter(variable => !excludedVars.includes(variable));
                
                const combinedData = filteredVariables.map(variable => {
                    const correlation = correlationResults[outcome.key][variable];
                    const regressionItem = regressionData.find(item => item.variable === variable);
                    
                    return {
                        variable: variable,
                        correlation: correlation,
                        tStat: regressionItem ? regressionItem.tStat : 0
                    };
                }).sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
                
                htmlContent += '<div class="behavioral-section">';
                htmlContent += '<h2>' + outcome.label + ' - All ' + combinedData.length + ' Variables</h2>';
                htmlContent += '<table style="width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 7px;">';
                htmlContent += '<thead><tr style="background: #f8f9fa;"><th style="border: 1px solid #ddd; padding: 3px; font-weight: bold;">Variable</th><th style="border: 1px solid #ddd; padding: 3px; font-weight: bold;">Correlation</th><th style="border: 1px solid #ddd; padding: 3px; font-weight: bold;">T-Statistic</th><th style="border: 1px solid #ddd; padding: 3px; font-weight: bold;">Predictive Strength</th></tr></thead>';
                htmlContent += '<tbody>';
                
                // Include ALL variables with proper labels
                combinedData.forEach(item => {
                    const variableLabels = {
                        'hasLinkedBank': 'Has Linked Bank',
                        'totalCopyStarts': 'Total Copy Starts',
                        'totalStripeViews': 'Total Stripe Views',
                        'paywallViews': 'Paywall Views',
                        'regularPDPViews': 'Regular PDP Views',
                        'premiumPDPViews': 'Premium PDP Views',
                        'uniqueCreatorsInteracted': 'Unique Creators Interacted',
                        'uniquePortfoliosInteracted': 'Unique Portfolios Interacted',
                        'timeToFirstCopy': 'Time To First Copy',
                        'timeToDeposit': 'Time To Deposit',
                        'timeToLinkedBank': 'Time To Linked Bank',
                        'incomeEnum': 'Income Level',
                        'netWorthEnum': 'Net Worth Level',
                        'availableCopyCredits': 'Available Copy Credits',
                        'buyingPower': 'Buying Power',
                        'activeCreatedPortfolios': 'Active Created Portfolios',
                        'lifetimeCreatedPortfolios': 'Lifetime Created Portfolios',
                        'totalBuys': 'Total Buys',
                        'totalSells': 'Total Sells',
                        'totalTrades': 'Total Trades',
                        'totalWithdrawalCount': 'Total Withdrawal Count',
                        'totalWithdrawals': 'Total Withdrawals',
                        'totalOfUserProfiles': 'Total User Profiles',
                        'totalDepositCount': 'Total Deposit Count',
                        'subscribedWithin7Days': 'Subscribed Within 7 Days',
                        'totalRegularCopies': 'Total Regular Copies',
                        'regularCreatorProfileViews': 'Regular Creator Profile Views',
                        'premiumCreatorProfileViews': 'Premium Creator Profile Views',
                        'appSessions': 'App Sessions',
                        'discoverTabViews': 'Discover Tab Views',
                        'leaderboardViews': 'Leaderboard Views',
                        'premiumTabViews': 'Premium Tab Views'
                    };
                    
                    const variableLabel = variableLabels[item.variable] || item.variable.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
                    
                    // Simple strength classification
                    const absTStat = Math.abs(item.tStat);
                    let strengthText = 'Very Weak';
                    let strengthClass = 'strength-very-weak';
                    
                    if (absTStat >= 3.0) {
                        strengthText = 'Very Strong';
                        strengthClass = 'strength-very-strong';
                    } else if (absTStat >= 2.5) {
                        strengthText = 'Strong';
                        strengthClass = 'strength-strong';
                    } else if (absTStat >= 2.0) {
                        strengthText = 'Moderate-Strong';
                        strengthClass = 'strength-moderate-strong';
                    } else if (absTStat >= 1.5) {
                        strengthText = 'Moderate';
                        strengthClass = 'strength-moderate';
                    } else if (absTStat >= 1.0) {
                        strengthText = 'Weak-Moderate';
                        strengthClass = 'strength-weak-moderate';
                    } else if (absTStat >= 0.5) {
                        strengthText = 'Weak';
                        strengthClass = 'strength-weak';
                    }
                    
                    htmlContent += '<tr>';
                    htmlContent += '<td style="border: 1px solid #ddd; padding: 2px; font-size: 6px;">' + variableLabel + '</td>';
                    htmlContent += '<td style="border: 1px solid #ddd; padding: 2px; text-align: center;">' + item.correlation.toFixed(3) + '</td>';
                    htmlContent += '<td style="border: 1px solid #ddd; padding: 2px; text-align: center;">' + item.tStat.toFixed(3) + '</td>';
                    htmlContent += '<td style="border: 1px solid #ddd; padding: 2px; text-align: center;"><span class="' + strengthClass + '" style="font-size: 6px; padding: 1px 2px;">' + strengthText + '</span></td>';
                    htmlContent += '</tr>';
                });
                
                htmlContent += '</tbody></table></div>';
            });
        } else {
            htmlContent += '<p><em>Behavioral analysis data not available. Please run analysis first.</em></p>';
        }
        
        // Add remaining sections (Portfolio, Creator, Additional Analysis)
        if (portfolioAnalysis) {
            htmlContent += '<h1>Portfolio Performance Analysis</h1>';
            htmlContent += '<p>Total Portfolios: ' + portfolioAnalysis.totalPortfolios + '</p>';
            htmlContent += '<p>Avg View-to-Copy Rate: ' + portfolioAnalysis.avgViewToCopyRate.toFixed(2) + '%</p>';
        }
        
        if (creatorAnalysis) {
            htmlContent += '<h1>Creator Performance Analysis</h1>';
            htmlContent += '<p>Total Creators: ' + creatorAnalysis.totalCreators + '</p>';
            htmlContent += '<p>Avg Subscription Rate: ' + creatorAnalysis.avgSubscriptionRate.toFixed(2) + '%</p>';
        }
        
        htmlContent += '</body></html>';
        
        // Create blob and download
        const blob = new Blob([htmlContent], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        
        const downloadLink = document.createElement('a');
        downloadLink.href = url;
        downloadLink.download = 'QDA_Complete_Fixed_Personas_Report_' + new Date().toISOString().split('T')[0] + '.html';
        downloadLink.style.display = 'none';
        
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
        
        URL.revokeObjectURL(url);
        
    } catch (error) {
        console.error('Export error:', error);
        alert('Error generating export: ' + error.message);
    }
}

function calculateCorrelation(x, y) {
    const n = x.length;
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
    const sumY2 = y.reduce((sum, yi) => sum + yi * yi, 0);

    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
    
    return denominator === 0 ? 0 : numerator / denominator;
}

function calculateCorrelations(data) {
    const variables = ALL_VARIABLES;    

    const correlations = {};
    
    ['totalCopies', 'totalDeposits', 'totalSubscriptions'].forEach(outcome => {
        correlations[outcome] = {};
        variables.forEach(variable => {
            if (variable !== outcome) {
                correlations[outcome][variable] = calculateCorrelation(
                    data.map(d => d[outcome]),
                    data.map(d => d[variable])
                );
            }
        });
    });

    return correlations;
}

function performRegression(data, outcome) {
    const predictors = ALL_VARIABLES;    

    const results = predictors.filter(predictor => predictor !== outcome).map(predictor => {
        const correlation = calculateCorrelation(
            data.map(d => d[outcome]),
            data.map(d => d[predictor])
        );
        
        const n = data.length;
        let tStat = 0;
        if (Math.abs(correlation) > 0.001 && n > 2) {
            const denominator = 1 - (correlation * correlation);
            if (denominator > 0.001) {
                tStat = correlation * Math.sqrt((n - 2) / denominator);
            }
        }

        return {
            variable: predictor,
            correlation: correlation,
            tStat: tStat,
            significant: Math.abs(tStat) > 1.96
        };
    });

    return results.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
}

// FIXED SUMMARY STATS WITH HIERARCHICAL PERSONAS
function calculateSummaryStats(data) {
    const usersWithLinkedBank = data.filter(d => d.hasLinkedBank === 1).length;
    const usersWithCopies = data.filter(d => d.totalCopies > 0).length;
    const usersWithDeposits = data.filter(d => d.totalDeposits > 0).length;
    const usersWithSubscriptions = data.filter(d => d.totalSubscriptions > 0).length;
    
    // Demographic counts for six required fields
    const demographicKeys = [
        'income', 'netWorth', 'investingExperienceYears',    
        'investingActivity', 'investmentType', 'investingObjective'
    ];

    const demographics = {};
    demographicKeys.forEach(key => {
        const breakdown = calculateDemographicBreakdown(data, key);
        demographics[key + 'Breakdown'] = breakdown.counts;
        demographics[key + 'TotalResponses'] = breakdown.totalResponses;
    });

    // FIXED PERSONA ANALYSIS - HIERARCHICAL WITH NO OVERLAPS
    const totalUsers = data.length;
    const personaCounts = {
        premium: 0,
        aspiringPremium: 0,
        core: 0,
        activationTargets: 0,
        lowerIncome: 0,
        nonActivated: 0,
        unclassified: 0
    };
    
    // Classify each user using hierarchical approach
    data.forEach(user => {
        const persona = classifyPersona(user);
        personaCounts[persona] = (personaCounts[persona] || 0) + 1;
    });
    
    const personaStats = {
        premium: {
            count: personaCounts.premium,
            percentage: totalUsers > 0 ? (personaCounts.premium / totalUsers) * 100 : 0
        },
        aspiringPremium: {
            count: personaCounts.aspiringPremium,
            percentage: totalUsers > 0 ? (personaCounts.aspiringPremium / totalUsers) * 100 : 0
        },
        core: {
            count: personaCounts.core,
            percentage: totalUsers > 0 ? (personaCounts.core / totalUsers) * 100 : 0
        },
        activationTargets: {
            count: personaCounts.activationTargets,
            percentage: totalUsers > 0 ? (personaCounts.activationTargets / totalUsers) * 100 : 0
        },
        lowerIncome: {
            count: personaCounts.lowerIncome,
            percentage: totalUsers > 0 ? (personaCounts.lowerIncome / totalUsers) * 100 : 0
        },
        nonActivated: {
            count: personaCounts.nonActivated,
            percentage: totalUsers > 0 ? (personaCounts.nonActivated / totalUsers) * 100 : 0
        }
    };
    
    return {
        totalUsers: totalUsers,
        linkBankConversion: (usersWithLinkedBank / totalUsers) * 100,
        firstCopyConversion: (usersWithCopies / totalUsers) * 100,
        depositConversion: (usersWithDeposits / totalUsers) * 100,
        subscriptionConversion: (usersWithSubscriptions / totalUsers) * 100,
        
        ...demographics,
        personaStats
    };
}

// Enhanced analysis functions for portfolio and creator data
function analyzePortfolioData(portfolioData) {
    const portfolioMetrics = portfolioData.reduce((acc, row) => {
        const ticker = row.portfolioTicker || row.portfolio_ticker || row.ticker;
        if (!acc[ticker]) {
            acc[ticker] = {
                totalViews: 0,
                totalCopyStarts: 0,
                totalCopies: 0,
                uniqueUsers: new Set()
            };
        }
        
        acc[ticker].totalViews += cleanNumeric(row.portfolio_views || row.views || 0);
        acc[ticker].totalCopyStarts += cleanNumeric(row.copy_starts || 0);
        acc[ticker].totalCopies += cleanNumeric(row.copies || 0);
        acc[ticker].uniqueUsers.add(row.distinct_id || row.user_id);
        
        return acc;
    }, {});
    
    const portfolioArray = Object.entries(portfolioMetrics).map(([ticker, metrics]) => ({
        ticker,
        totalViews: metrics.totalViews,
        totalCopyStarts: metrics.totalCopyStarts,
        totalCopies: metrics.totalCopies,
        uniqueUsers: metrics.uniqueUsers.size,
        viewToCopyRate: metrics.totalViews > 0 ? (metrics.totalCopies / metrics.totalViews) * 100 : 0
    }));
    
    portfolioArray.sort((a, b) => b.totalCopies - a.totalCopies);
    
    return {
        portfolios: portfolioArray,
        totalPortfolios: portfolioArray.length,
        avgViewToCopyRate: portfolioArray.reduce((sum, p) => sum + p.viewToCopyRate, 0) / portfolioArray.length || 0,
        topPerformers: portfolioArray.slice(0, 10)
    };
}

function analyzeCreatorData(creatorData) {
    const creatorMetrics = creatorData.reduce((acc, row) => {
        const username = row.creatorUsername || row.creator_username || row.username;
        if (!acc[username]) {
            acc[username] = {
                totalPaywallViews: 0,
                totalStripeViews: 0,
                totalSubscriptions: 0,
                totalPortfolioViews: 0,
                uniqueUsers: new Set()
            };
        }
        
        acc[username].totalPaywallViews += cleanNumeric(row.paywall_views || 0);
        acc[username].totalStripeViews += cleanNumeric(row.stripe_views || 0);
        acc[username].totalSubscriptions += cleanNumeric(row.subscriptions || 0);
        acc[username].totalPortfolioViews += cleanNumeric(row.portfolio_views || 0);
        acc[username].uniqueUsers.add(row.distinct_id || row.user_id);
        
        return acc;
    }, {});
    
    const creatorArray = Object.entries(creatorMetrics).map(([username, metrics]) => ({
        username,
        totalPaywallViews: metrics.totalPaywallViews,
        totalStripeViews: metrics.totalStripeViews,
        totalSubscriptions: metrics.totalSubscriptions,
        totalPortfolioViews: metrics.totalPortfolioViews,
        uniqueUsers: metrics.uniqueUsers.size,
        subscriptionConversionRate: metrics.totalPaywallViews > 0 ? (metrics.totalSubscriptions / metrics.totalPaywallViews) * 100 : 0,
        portfolioToCopyRate: metrics.totalPortfolioViews > 0 ? (metrics.totalSubscriptions / metrics.totalPortfolioViews) * 100 : 0
    }));
    
    creatorArray.sort((a, b) => b.totalSubscriptions - b.totalSubscriptions);
    
    return {
        creators: creatorArray,
        totalCreators: creatorArray.length,
        avgSubscriptionRate: creatorArray.reduce((sum, c) => sum + c.subscriptionConversionRate, 0) / creatorArray.length || 0,
        topPerformers: creatorArray.slice(0, 10)
    };
}

function performCrossFileAnalysis(mainData, portfolioData, creatorData) {
    const results = {};
    
    if (portfolioData && portfolioData.length > 0) {
        const userPortfolioCount = {};
        portfolioData.forEach(row => {
            const userId = row.distinct_id || row.user_id;
            const ticker = row.portfolioTicker || row.portfolio_ticker || row.ticker;
            if (userId && ticker) {
                if (!userPortfolioCount[userId]) {
                    userPortfolioCount[userId] = new Set();
                }
                userPortfolioCount[userId].add(ticker);
            }
        });
        
        const totalPortfolioInteractions = Object.values(userPortfolioCount).reduce((sum, portfolios) => sum + portfolios.size, 0);
        const avgPortfoliosPerUser = mainData.length > 0 ? totalPortfolioInteractions / mainData.length : 0;
        
        results.portfolioDiversity = {
            avgPortfoliosPerUser: avgPortfoliosPerUser,
            usersWithMultiplePortfolios: Object.values(userPortfolioCount).filter(portfolios => portfolios.size > 1).length,
            totalEngagedUsers: Object.keys(userPortfolioCount).length
        };
    }
    
    if (creatorData && creatorData.length > 0) {
        const userCreatorCount = {};
        creatorData.forEach(row => {
            const userId = row.distinct_id || row.user_id;
            const username = row.creatorUsername || row.creator_username || row.username;
            if (userId && username) {
                if (!userCreatorCount[userId]) {
                    userCreatorCount[userId] = new Set();
                }
                userCreatorCount[userId].add(username);
            }
        });
        
        const totalCreatorInteractions = Object.values(userCreatorCount).reduce((sum, creators) => sum + creators.size, 0);
        const avgCreatorsPerUser = mainData.length > 0 ? totalCreatorInteractions / mainData.length : 0;
        
        results.creatorDiversity = {
            avgCreatorsPerUser: avgCreatorsPerUser,
            usersWithMultipleCreators: Object.values(userCreatorCount).filter(creators => creators.size > 1).length,
            totalEngagedUsers: Object.keys(userCreatorCount).length
        };
    }
    
    if (mainData && (portfolioData || creatorData)) {
        const powerUsers = mainData.filter(user => 
            user.totalDeposits >= 1000 && 
            (user.totalSubscriptions >= 1 || user.totalCopies >= 2)
        );
        
        if (powerUsers.length > 0) {
            results.powerUserSegment = {
                count: powerUsers.length,
                percentage: (powerUsers.length / mainData.length) * 100,
                avgIncome: powerUsers.reduce((sum, user) => sum + (user.incomeEnum || 0), 0) / powerUsers.length,
                avgNetWorth: powerUsers.reduce((sum, user) => sum + (user.netWorthEnum || 0), 0) / powerUsers.length
            };
        }
    }
    
    return results;
}

function performQuantitativeAnalysis(csvText, portfolioCsvText = null, creatorCsvText = null) {
    const parsed = parseCSV(csvText);
    const data = parsed.data;

    const cleanData = data.map(row => ({
        // Primary outcome variables
        totalCopies: cleanNumeric(row['Total Copies']),
        totalDeposits: cleanNumeric(row['Total Deposits']),
        totalSubscriptions: cleanNumeric(row['Total Subscriptions']),
        
        // Banking and financial variables
        hasLinkedBank: (row['Has Linked Bank'] === true || row['Has Linked Bank'] === 'true' || 
                        row['Has Linked Bank'] === 1 || row['Has Linked Bank'] === '1' ||
                        row['Linked Bank Account'] === 1) ? 1 : 0,
        availableCopyCredits: cleanNumeric(row['Available Copy Credits']),
        buyingPower: cleanNumeric(row['Buying Power']),
        totalDepositCount: cleanNumeric(row['Total Deposit Count']),
        totalWithdrawals: cleanNumeric(row['Total Withdrawals']),
        totalWithdrawalCount: cleanNumeric(row['Total Withdrawal Count']),
        
        // Portfolio creation and trading activity
        activeCreatedPortfolios: cleanNumeric(row['Active Created Portfolios']),
        lifetimeCreatedPortfolios: cleanNumeric(row['Lifetime Created Portfolios']),
        totalBuys: cleanNumeric(row['Total Buys']),
        totalSells: cleanNumeric(row['Total Sells']),
        totalTrades: cleanNumeric(row['Total Trades']),
        
        // Copying behavior variables
        totalCopyStarts: cleanNumeric(row['Total Copy Starts']),
        totalRegularCopies: cleanNumeric(row['Total Regular Copies']),
        uniqueCreatorsInteracted: cleanNumeric(row['Unique Creators Interacted']),
        uniquePortfoliosInteracted: cleanNumeric(row['Unique Portfolios Interacted']),
        
        // Platform engagement variables
        regularPDPViews: cleanNumeric(row['Regular PDP Views']),
        premiumPDPViews: cleanNumeric(row['Premium PDP Views']),
        paywallViews: cleanNumeric(row['Paywall Views']),
        totalStripeViews: cleanNumeric(row['Total Stripe Views']),
        regularCreatorProfileViews: cleanNumeric(row['Regular Creator Profile Views']),
        premiumCreatorProfileViews: cleanNumeric(row['Premium Creator Profile Views']),
        
        // App usage and navigation
        appSessions: cleanNumeric(row['App Sessions']),
        discoverTabViews: cleanNumeric(row['Discover Tab Views']),
        leaderboardViews: cleanNumeric(row['Leaderboard Views']),
        premiumTabViews: cleanNumeric(row['Premium Tab Views']),
        totalOfUserProfiles: cleanNumeric(row['Total Of User Profiles']),
        
        // Subscription behavior
        subscribedWithin7Days: cleanNumeric(row['Subscribed Within 7 Days']),
        
        // Time-based metrics
        timeToFirstCopy: cleanNumeric(row['Time To First Copy']),
        timeToDeposit: cleanNumeric(row['Time To Deposit']),
        timeToLinkedBank: cleanNumeric(row['Time To Linked Bank']),
        
        // Demographic variables - Retained as strings for accurate breakdown
        income: row['Income'] || '',
        netWorth: row['Net Worth'] || '',
        incomeEnum: convertIncomeToEnum(row['Income'] || ''),
        netWorthEnum: convertNetWorthToEnum(row['Net Worth'] || ''),
        investingExperienceYears: row['Investing Experience Years'] || '',
        investingActivity: row['Investing Activity'] || '',
        investingObjective: row['Investing Objective'] || '',
        investmentType: row['Investment Type'] || ''
    }));

    const summaryStats = calculateSummaryStats(cleanData);
    const correlationResults = calculateCorrelations(cleanData);
    const regressionResults = {
        copies: performRegression(cleanData, 'totalCopies'),
        deposits: performRegression(cleanData, 'totalDeposits'),
        subscriptions: performRegression(cleanData, 'totalSubscriptions')
    };
    
    // Enhanced analysis for additional files
    let portfolioAnalysis = null;
    let creatorAnalysis = null;
    let crossAnalysis = null;
    
    if (portfolioCsvText) {
        const portfolioData = parseCSV(portfolioCsvText).data;
        console.log('Loaded portfolio dataset:', portfolioData.length, 'rows');
        portfolioAnalysis = analyzePortfolioData(portfolioData);
    }
    
    if (creatorCsvText) {
        const creatorData = parseCSV(creatorCsvText).data;
        console.log('Loaded creator dataset:', creatorData.length, 'rows');
        creatorAnalysis = analyzeCreatorData(creatorData);
    }
    
    if (portfolioCsvText || creatorCsvText) {
        crossAnalysis = performCrossFileAnalysis(
            cleanData, 
            portfolioCsvText ? parseCSV(portfolioCsvText).data : null,
            creatorCsvText ? parseCSV(creatorCsvText).data : null
        );
    }
    
    return {    
        summaryStats,    
        correlationResults,    
        regressionResults,
        portfolioAnalysis,
        creatorAnalysis,
        crossAnalysis,
        cleanData
    };
}

// Safe DOM creation functions - NO innerHTML usage
function createMetricCard(title, content, size = null) {
    const card = document.createElement('div');
    card.className = 'qda-metric-card';
    
    const titleEl = document.createElement('strong');
    titleEl.textContent = title;
    card.appendChild(titleEl);
    
    card.appendChild(document.createElement('br'));
    
    const contentEl = document.createElement('span');
    if (size) {
        contentEl.style.fontSize = size;
        contentEl.style.fontWeight = 'bold';
    }
    contentEl.textContent = content;
    card.appendChild(contentEl);
    
    return card;
}

function displayDemographicBreakdown(stats) {
    const container = document.getElementById('qdaDemographicBreakdown');
    container.textContent = '';
    
    const resultSection = document.createElement('div');
    resultSection.className = 'qda-result-section';
    
    const title = document.createElement('h1');
    title.textContent = 'Demographic Breakdown';    
    resultSection.appendChild(title);

    const grid = document.createElement('div');
    grid.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px;';

    // Helper function to create a breakdown table
    const createBreakdownTable = (titleText, data, totalResponses) => {
        const tableContainer = document.createElement('div');
        tableContainer.style.maxWidth = '320px';    
        const tableTitle = document.createElement('h4');
        tableTitle.textContent = titleText;
        tableTitle.style.cssText = 'margin: 0 0 10px 0; font-size: 14px;';
        tableContainer.appendChild(tableTitle);

        const table = document.createElement('table');
        table.className = 'qda-regression-table';
        table.style.fontSize = '12px';
        table.style.width = '100%';

        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        ['Category', 'Percentage'].forEach(header => {
            const th = document.createElement('th');
            th.textContent = header;
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');

        // Convert to array of objects for easier sorting
        let dataArray = Object.keys(data)
            .filter(k => k.trim() !== '')
            .map(category => ({
                category,
                count: data[category],
                percentage: totalResponses > 0 ? (data[category] / totalResponses) * 100 : 0
            }));

        // Sort by percentage descending
        dataArray.sort((a, b) => b.percentage - a.percentage);

        dataArray.forEach(item => {
            const percentageFormatted = item.percentage.toFixed(1) + '%';
            tbody.appendChild(createTableRow([item.category, percentageFormatted]));
        });
        
        table.appendChild(tbody);
        tableContainer.appendChild(table);
        grid.appendChild(tableContainer);
    };

    const demographicConfigs = [
        { key: 'income', title: 'Income' },
        { key: 'netWorth', title: 'Net Worth' },
        { key: 'investingExperienceYears', title: 'Investing Experience Years' },
        { key: 'investingActivity', title: 'Investing Activity' },
        { key: 'investmentType', title: 'Investment Type' },
        { key: 'investingObjective', title: 'Investing Objective' }
    ];

    demographicConfigs.forEach(config => {
        createBreakdownTable(
            config.title,    
            stats[config.key + 'Breakdown'],    
            stats[config.key + 'TotalResponses']
        );
    });
    
    resultSection.appendChild(grid);
    container.appendChild(resultSection);
}

function displaySummaryStats(stats) {
    const container = document.getElementById('qdaSummaryStats');
    container.textContent = '';
    
    const resultSection = document.createElement('div');
    resultSection.className = 'qda-result-section';
    
    const title = document.createElement('h1');
    title.textContent = 'Summary Statistics';
    resultSection.appendChild(title);
    
    // Export button positioned in top right
    const exportBtn = document.createElement('button');
    exportBtn.className = 'qda-export-btn';
    exportBtn.textContent = 'Export PDF';
    exportBtn.addEventListener('click', exportReport);
    resultSection.appendChild(exportBtn);
    
    const metricSummary = document.createElement('div');
    metricSummary.className = 'qda-metric-summary';
    
    const metrics = [
        ['Total Users', stats.totalUsers.toLocaleString(), '18px'],
        ['Link Bank Rate', `${stats.linkBankConversion.toFixed(1)}%`, '18px'],
        ['Copy Rate', `${stats.firstCopyConversion.toFixed(1)}%`, '18px'],
        ['Deposit Rate', `${stats.depositConversion.toFixed(1)}%`, '18px'],
        ['Subscription Rate', `${stats.subscriptionConversion.toFixed(1)}%`, '18px']
    ];
    
    metrics.forEach(([title, content, size]) => {
        metricSummary.appendChild(createMetricCard(title, content, size));
    });
    
    resultSection.appendChild(metricSummary);
    container.appendChild(resultSection);
}

// UPDATED PERSONA BREAKDOWN DISPLAY - Fixed Order and Descriptions
function displayPersonaBreakdown(stats) {
    const container = document.getElementById('qdaPersonaBreakdown');
    container.textContent = '';
    
    const resultSection = document.createElement('div');
    resultSection.className = 'qda-result-section';
    
    const title = document.createElement('h1');
    title.textContent = 'Fixed Persona Breakdown - No Overlaps';
    resultSection.appendChild(title);

    const grid = document.createElement('div');
    grid.style.cssText = 'display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px;';

    // FIXED PERSONA ORDER (by business priority)
    const personas = [
        {
            name: 'Premium',
            subtitle: 'Active subscriptions - highest revenue users',
            data: stats.personaStats.premium,
            priority: 1
        },
        {
            name: 'Aspiring Premium',
            subtitle: '$1000+ deposits, copies, higher income - premium conversion targets',
            data: stats.personaStats.aspiringPremium,
            priority: 2
        },
        {
            name: 'Core',
            subtitle: '$200-1000 deposits with banking OR active engagement - main user base',
            data: stats.personaStats.core,
            priority: 3
        },
        {
            name: 'Activation Targets',
            subtitle: 'Higher income prospects browsing creators but not converting',
            data: stats.personaStats.activationTargets,
            priority: 4
        },
        {
            name: 'Lower Income',
            subtitle: '≤$200 deposits, lower demographics, minimal engagement',
            data: stats.personaStats.lowerIncome,
            priority: 5
        },
        {
            name: 'Non-activated',
            subtitle: 'Zero banking, deposits, and platform engagement',
            data: stats.personaStats.nonActivated,
            priority: 6
        }
    ];

    personas.forEach(p => {
        const card = document.createElement('div');
        card.style.cssText = 'background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 8px; padding: 15px;';
        
        const nameEl = document.createElement('div');
        nameEl.style.cssText = 'font-weight: bold; color: #007bff; margin-bottom: 5px; font-size: 16px;';
        nameEl.textContent = `${p.priority}. ${p.name}`;
        card.appendChild(nameEl);

        const subtitleEl = document.createElement('div');
        subtitleEl.style.cssText = 'font-size: 12px; color: #6c757d; margin-bottom: 10px;';
        subtitleEl.textContent = p.subtitle;
        card.appendChild(subtitleEl);

        const percentageEl = document.createElement('div');
        percentageEl.style.cssText = 'font-size: 24px; font-weight: bold; color: #28a745; margin-bottom: 5px;';
        percentageEl.textContent = `${p.data.percentage.toFixed(1)}%`;
        card.appendChild(percentageEl);

        const countEl = document.createElement('div');
        countEl.style.cssText = 'font-size: 13px; color: #333;';
        countEl.textContent = `(N=${p.data.count.toLocaleString()})`;
        card.appendChild(countEl);

        grid.appendChild(card);
    });
    
    resultSection.appendChild(grid);
    container.appendChild(resultSection);
}

function displayPortfolioAnalysis(portfolioAnalysis) {
    const container = document.getElementById('qdaPortfolioResults');
    container.textContent = '';
    
    if (!portfolioAnalysis) return;
    
    const resultSection = document.createElement('div');
    resultSection.className = 'qda-result-section';
    
    const title = document.createElement('h1');
    title.textContent = 'Portfolio Performance Analysis';
    resultSection.appendChild(title);
    
    // Summary metrics
    const summaryGrid = document.createElement('div');
    summaryGrid.className = 'qda-metric-summary';
    
    summaryGrid.appendChild(createMetricCard('Total Portfolios', portfolioAnalysis.totalPortfolios.toLocaleString(), '16px'));
    summaryGrid.appendChild(createMetricCard('Avg View-to-Copy Rate', `${portfolioAnalysis.avgViewToCopyRate.toFixed(2)}%`, '16px'));
    
    resultSection.appendChild(summaryGrid);
    
    // Top performing portfolios
    const performanceTitle = document.createElement('h4');
    performanceTitle.textContent = 'Top Performing Portfolios';
    resultSection.appendChild(performanceTitle);
    
    const performanceGrid = document.createElement('div');
    performanceGrid.className = 'qda-performance-grid';
    performanceGrid.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin: 20px 0;';
    
    portfolioAnalysis.topPerformers.slice(0, 6).forEach(portfolio => {
        const card = document.createElement('div');
        card.style.cssText = 'background: white; border: 1px solid #ddd; border-radius: 8px; padding: 15px;';
        
        const titleDiv = document.createElement('div');
        titleDiv.style.cssText = 'font-weight: bold; margin-bottom: 8px; color: #007bff;';
        titleDiv.textContent = portfolio.ticker;
        card.appendChild(titleDiv);
        
        const metrics = [
            `Total Copies: ${portfolio.totalCopies}`,
            `Views: ${portfolio.totalViews.toLocaleString()}`,
            `Conversion: ${portfolio.viewToCopyRate.toFixed(2)}%`,
            `Unique Users: ${portfolio.uniqueUsers}`
        ];
        
        metrics.forEach(metric => {
            const metricDiv = document.createElement('div');
            metricDiv.style.cssText = 'margin: 4px 0; font-size: 13px;';
            metricDiv.textContent = metric;
            card.appendChild(metricDiv);
        });
        
        performanceGrid.appendChild(card);
    });
    
    resultSection.appendChild(performanceGrid);
    container.appendChild(resultSection);
}

function displayCreatorAnalysis(creatorAnalysis) {
    const container = document.getElementById('qdaCreatorResults');
    container.textContent = '';
    
    if (!creatorAnalysis) return;
    
    const resultSection = document.createElement('div');
    resultSection.className = 'qda-result-section';
    
    const title = document.createElement('h1');
    title.textContent = 'Creator Performance Analysis';
    resultSection.appendChild(title);
    
    // Summary metrics
    const summaryGrid = document.createElement('div');
    summaryGrid.className = 'qda-metric-summary';
    
    summaryGrid.appendChild(createMetricCard('Total Creators', creatorAnalysis.totalCreators.toLocaleString(), '16px'));
    summaryGrid.appendChild(createMetricCard('Avg Subscription Rate', `${creatorAnalysis.avgSubscriptionRate.toFixed(2)}%`, '16px'));
    
    resultSection.appendChild(summaryGrid);
    
    // Top performing creators
    const performanceTitle = document.createElement('h4');
    performanceTitle.textContent = 'Top Performing Creators';
    resultSection.appendChild(performanceTitle);
    
    const performanceGrid = document.createElement('div');
    performanceGrid.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin: 20px 0;';
    
    creatorAnalysis.topPerformers.slice(0, 6).forEach(creator => {
        const card = document.createElement('div');
        card.style.cssText = 'background: white; border: 1px solid #ddd; border-radius: 8px; padding: 15px;';
        
        const titleDiv = document.createElement('div');
        titleDiv.style.cssText = 'font-weight: bold; margin-bottom: 8px; color: #007bff;';
        titleDiv.textContent = creator.username;
        card.appendChild(titleDiv);
        
        const metrics = [
            `Subscriptions: ${creator.totalSubscriptions}`,
            `Paywall Views: ${creator.totalPaywallViews.toLocaleString()}`,
            `Sub Rate: ${creator.subscriptionConversionRate.toFixed(2)}%`,
            `Portfolio Views: ${creator.totalPortfolioViews.toLocaleString()}`
        ];
        
        metrics.forEach(metric => {
            const metricDiv = document.createElement('div');
            metricDiv.style.cssText = 'margin: 4px 0; font-size: 13px;';
            metricDiv.textContent = metric;
            card.appendChild(metricDiv);
        });
        
        performanceGrid.appendChild(card);
    });
    
    resultSection.appendChild(performanceGrid);
    container.appendChild(resultSection);
}

function displayCrossAnalysis(crossAnalysis) {
    const container = document.getElementById('qdaCrossAnalysisResults');
    container.textContent = '';
    
    if (!crossAnalysis) return;
    
    const resultSection = document.createElement('div');
    resultSection.className = 'qda-result-section';
    
    const title = document.createElement('h1');
    title.textContent = 'Additional Analysis';
    resultSection.appendChild(title);
    
    const analysisGrid = document.createElement('div');
    analysisGrid.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin: 20px 0;';
    
    // Portfolio diversity analysis
    if (crossAnalysis.portfolioDiversity) {
        const portfolioCard = document.createElement('div');
        portfolioCard.style.cssText = 'background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 8px; padding: 15px;';
        
        const portfolioTitle = document.createElement('div');
        portfolioTitle.style.cssText = 'font-weight: bold; color: #007bff; margin-bottom: 10px;';
        portfolioTitle.textContent = 'Portfolio Diversity';
        portfolioCard.appendChild(portfolioTitle);
        
        const portfolioMetrics = [
            `Avg portfolios per user: ${crossAnalysis.portfolioDiversity.avgPortfoliosPerUser.toFixed(1)}`,
            `Multi-portfolio users: ${crossAnalysis.portfolioDiversity.usersWithMultiplePortfolios.toLocaleString()}`
        ];
        
        portfolioMetrics.forEach(metric => {
            const metricDiv = document.createElement('div');
            metricDiv.style.cssText = 'margin: 6px 0; font-size: 13px;';
            metricDiv.textContent = metric;
            portfolioCard.appendChild(metricDiv);
        });
        
        analysisGrid.appendChild(portfolioCard);
    }
    
    // Creator diversity analysis
    if (crossAnalysis.creatorDiversity) {
        const creatorCard = document.createElement('div');
        creatorCard.style.cssText = 'background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 8px; padding: 15px;';
        
        const creatorTitle = document.createElement('div');
        creatorTitle.style.cssText = 'font-weight: bold; color: #007bff; margin-bottom: 10px;';
        creatorTitle.textContent = 'Creator Engagement';
        creatorCard.appendChild(creatorTitle);
        
        const creatorMetrics = [
            `Avg creators per user: ${crossAnalysis.creatorDiversity.avgCreatorsPerUser.toFixed(1)}`,
            `Multi-creator users: ${crossAnalysis.creatorDiversity.usersWithMultipleCreators.toLocaleString()}`
        ];
        
        creatorMetrics.forEach(metric => {
            const metricDiv = document.createElement('div');
            metricDiv.style.cssText = 'margin: 6px 0; font-size: 13px;';
            metricDiv.textContent = metric;
            creatorCard.appendChild(metricDiv);
        });
        
        analysisGrid.appendChild(creatorCard);
    }
    
    if (crossAnalysis.powerUserSegment) {
        const powerUserCard = document.createElement('div');
        powerUserCard.style.cssText = 'background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 8px; padding: 15px;';
        
        const powerUserTitle = document.createElement('div');
        powerUserTitle.style.cssText = 'font-weight: bold; color: #007bff; margin-bottom: 10px;';
        powerUserTitle.textContent = 'Power Users';
        powerUserCard.appendChild(powerUserTitle);
        
        const powerUserMetrics = [
            `Count: ${crossAnalysis.powerUserSegment.count.toLocaleString()}`,
            `Percentage: ${crossAnalysis.powerUserSegment.percentage.toFixed(1)}%`
        ];
        
        powerUserMetrics.forEach(metric => {
            const metricDiv = document.createElement('div');
            metricDiv.style.cssText = 'margin: 6px 0; font-size: 13px;';
            metricDiv.textContent = metric;
            powerUserCard.appendChild(metricDiv);
        });
        
        // Add help text definition
        const helpText = document.createElement('div');
        helpText.style.cssText = 'margin-top: 10px; font-size: 11px; color: #6c757d; font-style: italic;';
        helpText.textContent = 'Defined as $1,000+ deposits, 1+ subscription or 2+ copies';
        powerUserCard.appendChild(helpText);
        
        analysisGrid.appendChild(powerUserCard);
    }
    
    resultSection.appendChild(analysisGrid);
    container.appendChild(resultSection);
}

function getVariableLabel(variable) {
    const variableLabels = {
        // Outcome variables
        'totalCopies': 'Total Copies',
        'totalDeposits': 'Total Deposits',
        'totalSubscriptions': 'Total Subscriptions',
        
        // Financial variables
        'hasLinkedBank': 'Has Linked Bank',
        'availableCopyCredits': 'Available Copy Credits',
        'buyingPower': 'Buying Power',
        'totalDepositCount': 'Total Deposit Count',
        'totalWithdrawals': 'Total Withdrawals',
        'totalWithdrawalCount': 'Total Withdrawal Count',
        
        // Portfolio and trading
        'activeCreatedPortfolios': 'Active Created Portfolios',
        'lifetimeCreatedPortfolios': 'Lifetime Created Portfolios',
        'totalBuys': 'Total Buys',
        'totalSells': 'Total Sells',
        'totalTrades': 'Total Trades',
        
        // Copying behavior
        'totalCopyStarts': 'Total Copy Starts',
        'totalRegularCopies': 'Total Regular Copies',
        'uniqueCreatorsInteracted': 'Unique Creators Interacted',
        'uniquePortfoliosInteracted': 'Unique Portfolios Interacted',
        
        // Platform engagement
        'regularPDPViews': 'Regular PDP Views',
        'premiumPDPViews': 'Premium PDP Views',
        'paywallViews': 'Paywall Views',
        'totalStripeViews': 'Total Stripe Views',
        'regularCreatorProfileViews': 'Regular Creator Profile Views',
        'premiumCreatorProfileViews': 'Premium Creator Profile Views',
        
        // App usage
        'appSessions': 'App Sessions',
        'discoverTabViews': 'Discover Tab Views',
        'leaderboardViews': 'Leaderboard Views',
        'premiumTabViews': 'Premium Tab Views',
        'totalOfUserProfiles': 'Total User Profiles',
        
        // Subscription behavior
        'subscribedWithin7Days': 'Subscribed Within 7 Days',
        
        // Time metrics
        'timeToFirstCopy': 'Time To First Copy',
        'timeToDeposit': 'Time To Deposit',
        'timeToLinkedBank': 'Time To Linked Bank',
        
        // Demographics
        'incomeEnum': 'Income Level',
        'netWorthEnum': 'Net Worth Level',
        'income': 'Income',
        'netWorth': 'Net Worth',
        'investingExperienceYears': 'Investing Experience Years',
        'investingActivity': 'Investing Activity',
        'investingObjective': 'Investing Objective',
        'investmentType': 'Investment Type'
    };
    
    return variableLabels[variable] || variable.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
}

function createTableRow(data) {
    const row = document.createElement('tr');
    
    data.forEach(cellData => {
        const cell = document.createElement('td');
        if (typeof cellData === 'object' && cellData.html) {
            const span = document.createElement('span');
            span.className = cellData.className || '';
            span.textContent = cellData.text;
            cell.appendChild(span);
        } else {
            cell.textContent = cellData;
        }
        row.appendChild(cell);
    });
    
    return row;
}

function calculateRelativeStrengths(dataArray, valueKey) {
    // Sort by absolute values to get percentiles
    const sortedValues = dataArray.map(item => Math.abs(item[valueKey])).sort((a, b) => a - b);
    const total = sortedValues.length;
    
    // Calculate 7 category thresholds (approximately 14.3% each)
    const veryWeakThreshold = sortedValues[Math.floor(total * 0.143)];
    const weakThreshold = sortedValues[Math.floor(total * 0.286)];
    const weakModerateThreshold = sortedValues[Math.floor(total * 0.429)];
    const moderateThreshold = sortedValues[Math.floor(total * 0.571)];
    const moderateStrongThreshold = sortedValues[Math.floor(total * 0.714)];
    const strongThreshold = sortedValues[Math.floor(total * 0.857)];
    
    return {    
        veryWeakThreshold,    
        weakThreshold,    
        weakModerateThreshold,    
        moderateThreshold,
        moderateStrongThreshold,
        strongThreshold    
    };
}

function displayCombinedAnalysis(correlationResults, regressionResults, cleanData) {
    const container = document.getElementById('qdaCombinedResults');
    container.textContent = '';
    
    const resultSection = document.createElement('div');
    resultSection.className = 'qda-result-section';
    
    const title = document.createElement('h1');
    title.textContent = 'Behavioral Analysis';
    resultSection.appendChild(title);

    // Define the custom order of subsections
    const orderedOutcomes = [
        { outcome: 'totalDeposits', label: 'Deposit Funds' },
        { outcome: 'totalCopies', label: 'Portfolio Copies' },
        { outcome: 'totalSubscriptions', label: 'Subscriptions' }
    ];
    
    orderedOutcomes.forEach((config) => {
        const outcome = config.outcome;
        const outcomeLabel = config.label;
        
        const outcomeTitle = document.createElement('h4');
        outcomeTitle.textContent = outcomeLabel;
        resultSection.appendChild(outcomeTitle);
        
        const allVariables = Object.keys(correlationResults[outcome]);
        const regressionData = regressionResults[outcome.replace('total', '').toLowerCase()];
        
        // Apply section-specific exclusions
        const excludedVars = SECTION_EXCLUSIONS[outcome] || [];
        const filteredVariables = allVariables.filter(variable => !excludedVars.includes(variable));
        
        const combinedData = filteredVariables.map(variable => {
            const correlation = correlationResults[outcome][variable];
            const regressionItem = regressionData.find(item => item.variable === variable);
            const tippingPoint = calculateTippingPoint(cleanData, variable, outcome);
            
            return {
                variable: variable,
                correlation: correlation,
                tStat: regressionItem ? regressionItem.tStat : 0,
                tippingPoint: tippingPoint
            };
        }).sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
        
        // Calculate relative thresholds for T-statistics only
        const tStatThresholds = calculateRelativeStrengths(combinedData, 'tStat');
        
        // Apply relative strengths
        combinedData.forEach(item => {
            const absTStat = Math.abs(item.tStat);
            
            // Predictive strength (relative with 7 categories)
            if (absTStat >= tStatThresholds.strongThreshold) {
                item.predictiveStrength = 'Very Strong';
                item.predictiveClass = 'qda-strength-very-strong';
            } else if (absTStat >= tStatThresholds.moderateStrongThreshold) {
                item.predictiveStrength = 'Strong';
                item.predictiveClass = 'qda-strength-strong';
            } else if (absTStat >= tStatThresholds.moderateThreshold) {
                item.predictiveStrength = 'Moderate - Strong';
                item.predictiveClass = 'qda-strength-moderate-strong';
            } else if (absTStat >= tStatThresholds.weakModerateThreshold) {
                item.predictiveStrength = 'Moderate';
                item.predictiveClass = 'qda-strength-moderate';
            } else if (absTStat >= tStatThresholds.weakThreshold) {
                item.predictiveStrength = 'Weak - Moderate';
                item.predictiveClass = 'qda-strength-weak-moderate';
            } else if (absTStat >= tStatThresholds.veryWeakThreshold) {
                item.predictiveStrength = 'Weak';
                item.predictiveClass = 'qda-strength-weak';
            } else {
                item.predictiveStrength = 'Very Weak';
                item.predictiveClass = 'qda-strength-very-weak';
            }
        });
        
        const table = document.createElement('table');
        table.className = 'qda-regression-table';
        
        // Create header with 5 columns (removed Correlation Strength)
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        ['Variable', 'Correlation', 'T-Statistic', 'Predictive Strength', 'Tipping Point'].forEach(header => {
            const th = document.createElement('th');
            th.textContent = header;
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);
        
        // Create body - show top 25 variables (increased from 20)
        const tbody = document.createElement('tbody');
        combinedData.slice(0, 25).forEach(item => {
            const rowData = [
                getVariableLabel(item.variable),
                item.correlation.toFixed(3),
                item.tStat.toFixed(3),
                { text: item.predictiveStrength, className: item.predictiveClass, html: true },
                item.tippingPoint !== 'N/A' ?    
                    (typeof item.tippingPoint === 'number' ? item.tippingPoint.toFixed(1) : item.tippingPoint) :
                    'N/A'
            ];
            tbody.appendChild(createTableRow(rowData));
        });
        table.appendChild(tbody);
        
        resultSection.appendChild(table);
    });
    
    container.appendChild(resultSection);
}

// Widget creation using DOM methods only - NO innerHTML
function createWidget() {
    const widget = document.createElement('div');
    widget.className = 'qda-widget';
    
    // Header
    const header = document.createElement('div');
    header.className = 'qda-header';
    
    const title = document.createElement('h3');
    title.style.margin = '0';
    title.textContent = 'Enhanced QDA - Fixed Personas';
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'qda-close';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => widget.remove());
    
    header.appendChild(title);
    header.appendChild(closeBtn);
    
    // Content
    const content = document.createElement('div');
    content.className = 'qda-content';
    
    const description = document.createElement('p');
    description.textContent = 'Upload your CSV file to perform comprehensive statistical analysis with FIXED persona logic (no overlaps).';
    content.appendChild(description);
    
    // Upload section with 3 columns
    const uploadSection = document.createElement('div');
    uploadSection.className = 'qda-upload-section';
    
    // Main Analysis File (required)
    const mainColumn = document.createElement('div');
    mainColumn.className = 'qda-upload-column';
    
    const mainLabel = document.createElement('div');
    mainLabel.className = 'qda-file-label';
    mainLabel.textContent = 'Main Analysis File';
    mainColumn.appendChild(mainLabel);
    
    const mainFileInput = document.createElement('input');
    mainFileInput.type = 'file';
    mainFileInput.id = 'qdaMainFile';
    mainFileInput.accept = '.csv';
    mainFileInput.className = 'qda-file-input';
    mainColumn.appendChild(mainFileInput);
    
    const mainDesc = document.createElement('div');
    mainDesc.className = 'qda-file-description';
    mainDesc.textContent = 'Required: User behavior, demographics, and conversion data';
    mainColumn.appendChild(mainDesc);
    
    // Portfolio Detail File (optional)
    const portfolioColumn = document.createElement('div');
    portfolioColumn.className = 'qda-upload-column';
    
    const portfolioLabel = document.createElement('div');
    portfolioLabel.className = 'qda-file-label';
    portfolioLabel.textContent = 'Portfolio Detail File';
    portfolioColumn.appendChild(portfolioLabel);
    
    const portfolioFileInput = document.createElement('input');
    portfolioFileInput.type = 'file';
    portfolioFileInput.id = 'qdaPortfolioFile';
    portfolioFileInput.accept = '.csv';
    portfolioFileInput.className = 'qda-file-input';
    portfolioColumn.appendChild(portfolioFileInput);
    
    const portfolioDesc = document.createElement('div');
    portfolioDesc.className = 'qda-file-description';
    portfolioDesc.textContent = 'Optional: Portfolio views, copy starts, and performance metrics';
    portfolioColumn.appendChild(portfolioDesc);
    
    // Creator Detail File (optional)
    const creatorColumn = document.createElement('div');
    creatorColumn.className = 'qda-upload-column';
    
    const creatorLabel = document.createElement('div');
    creatorLabel.className = 'qda-file-label';
    creatorLabel.textContent = 'Creator Detail File';
    creatorColumn.appendChild(creatorLabel);
    
    const creatorFileInput = document.createElement('input');
    creatorFileInput.type = 'file';
    creatorFileInput.id = 'qdaCreatorFile';
    creatorFileInput.accept = '.csv';
    creatorFileInput.className = 'qda-file-input';
    creatorColumn.appendChild(creatorFileInput);
    
    const creatorDesc = document.createElement('div');
    creatorDesc.className = 'qda-file-description';
    creatorDesc.textContent = 'Optional: Creator paywall views, subscriptions, and monetization data';
    creatorColumn.appendChild(creatorDesc);
    
    uploadSection.appendChild(mainColumn);
    uploadSection.appendChild(portfolioColumn);
    uploadSection.appendChild(creatorColumn);
    
    const analyzeRow = document.createElement('div');
    analyzeRow.className = 'qda-analyze-row';
    
    const analyzeBtn = document.createElement('button');
    analyzeBtn.className = 'qda-btn';
    analyzeBtn.id = 'qdaAnalyzeBtn';
    analyzeBtn.textContent = 'Analyze Data';
    analyzeBtn.addEventListener('click', analyzeData);
    
    analyzeRow.appendChild(analyzeBtn);
    uploadSection.appendChild(analyzeRow);
    content.appendChild(uploadSection);
    
    // Results
    const resultsDiv = document.createElement('div');
    resultsDiv.id = 'qdaAnalysisResults';
    resultsDiv.className = 'qda-analysis-results';
    
    const summaryDiv = document.createElement('div');
    summaryDiv.id = 'qdaSummaryStats';
    resultsDiv.appendChild(summaryDiv);

    // Demographic Breakdown Section
    const demographicDiv = document.createElement('div');
    demographicDiv.id = 'qdaDemographicBreakdown';
    resultsDiv.appendChild(demographicDiv);
    
    // Persona Breakdown Section
    const personaDiv = document.createElement('div');
    personaDiv.id = 'qdaPersonaBreakdown';
    resultsDiv.appendChild(personaDiv);
    
    const combinedDiv = document.createElement('div');
    combinedDiv.id = 'qdaCombinedResults';
    resultsDiv.appendChild(combinedDiv);
    
    const portfolioDiv = document.createElement('div');
    portfolioDiv.id = 'qdaPortfolioResults';
    resultsDiv.appendChild(portfolioDiv);
    
    const creatorDiv = document.createElement('div');
    creatorDiv.id = 'qdaCreatorResults';
    resultsDiv.appendChild(creatorDiv);
    
    const crossAnalysisDiv = document.createElement('div');
    crossAnalysisDiv.id = 'qdaCrossAnalysisResults';
    resultsDiv.appendChild(crossAnalysisDiv);
    
    content.appendChild(resultsDiv);
    
    widget.appendChild(header);
    widget.appendChild(content);
    
    document.body.appendChild(widget);
    
    // Make draggable
    makeDraggable(widget);
}

function makeDraggable(element) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    const header = element.querySelector('.qda-header');
    
    header.onmousedown = function(e) {
        e = e || window.event;
        e.preventDefault();
        pos3 = e.clientX;
        pos4 = e.clientY;
        document.onmouseup = function() {
            document.onmouseup = null;
            document.onmousemove = null;
        };
        document.onmousemove = function(e) {
            e = e || window.event;
            e.preventDefault();
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;
            element.style.top = (element.offsetTop - pos2) + "px";
            element.style.left = (element.offsetLeft - pos1) + "px";
            element.style.right = 'auto';
        };
    };
}

async function analyzeData() {
    const mainFileInput = document.getElementById('qdaMainFile');
    const portfolioFileInput = document.getElementById('qdaPortfolioFile');
    const creatorFileInput = document.getElementById('qdaCreatorFile');
    
    if (!mainFileInput.files[0]) {
        alert('Please select the Main Analysis CSV file');
        return;
    }

    const analyzeBtn = document.getElementById('qdaAnalyzeBtn');
    analyzeBtn.textContent = 'Analyzing...';
    analyzeBtn.disabled = true;

    try {
        const mainCsvText = await readFile(mainFileInput.files[0]);
        const portfolioCsvText = portfolioFileInput.files[0] ? await readFile(portfolioFileInput.files[0]) : null;
        const creatorCsvText = creatorFileInput.files[0] ? await readFile(creatorFileInput.files[0]) : null;
        
        console.log('Starting FIXED persona analysis with no overlaps...');
        const results = performQuantitativeAnalysis(mainCsvText, portfolioCsvText, creatorCsvText);
        
        // Store ALL results for export - including behavioral analysis
        sessionStorage.setItem('qdaSummaryStats', JSON.stringify(results.summaryStats));
        sessionStorage.setItem('qdaCorrelationResults', JSON.stringify(results.correlationResults));
        sessionStorage.setItem('qdaRegressionResults', JSON.stringify(results.regressionResults));
        
        if (results.portfolioAnalysis) {
            sessionStorage.setItem('qdaPortfolioAnalysis', JSON.stringify(results.portfolioAnalysis));
        }
        if (results.creatorAnalysis) {
            sessionStorage.setItem('qdaCreatorAnalysis', JSON.stringify(results.creatorAnalysis));
        }
        if (results.crossAnalysis) {
            sessionStorage.setItem('qdaCrossAnalysis', JSON.stringify(results.crossAnalysis));
        }
        
        // Display all results
        displaySummaryStats(results.summaryStats);
        displayDemographicBreakdown(results.summaryStats);
        displayPersonaBreakdown(results.summaryStats);
        displayCombinedAnalysis(results.correlationResults, results.regressionResults, results.cleanData);
        
        // Display enhanced sections if data available
        if (results.portfolioAnalysis) {
            displayPortfolioAnalysis(results.portfolioAnalysis);
        }
        if (results.creatorAnalysis) {
            displayCreatorAnalysis(results.creatorAnalysis);
        }
        if (results.crossAnalysis) {
            displayCrossAnalysis(results.crossAnalysis);
        }
        
        document.getElementById('qdaAnalysisResults').style.display = 'block';
        console.log('FIXED Quantitative Driver Analysis completed - No persona overlaps!');
    } catch (error) {
        alert('Error analyzing data: ' + error.message);
        console.error('Full error:', error);
    } finally {
        analyzeBtn.textContent = 'Analyze Data';
        analyzeBtn.disabled = false;
    }
}

function readFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsText(file);
    });
}

// Widget is ready to be launched manually
console.log('Enhanced Quantitative Driver Analysis widget loaded - FIXED personas with hierarchical priority!');
