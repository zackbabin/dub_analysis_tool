// Business Model Analysis Tool - Vanilla JavaScript Implementation
// Converted from React component to vanilla JS

class BusinessModelAnalysis {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.currentValues = null; // Will hold synced values from Supabase

        // Base assumptions from data
        this.assumptions = {
            // Onboarding conversion rates
            installToKYC: 30.00,
            kycToLinkedBank: 21.98,
            linkedBankToACH: 53.58,
            achToCopy: 54.49,

            // User behavior metrics (per user)
            avgMonthlyTrades: 0.92,
            avgMonthlyRebalances: 3.65,
            tradeVolumeGrowth: 3.00,
            rebalanceGrowth: 10.00,
            avgMonthlyPortfolioCreations: 0.02,
            portfolioCreationGrowth: 3.00,

            // Monthly baseline (3-month average)
            monthlyInstalls: 157443.98,
            monthlyFundedAccounts: 9339,

            // Growth assumptions (monthly)
            userGrowthRate: 10.00,

            // Subscription assumptions
            subscriptionConversion: 3,
            subscriptionChurnRate: 25,

            // MODEL A: Transaction Fee Model
            modelA_transactionFee: 0.25,
            modelA_subscriptionPrice: 5.00,
            modelA_dubRevenueShare: 50.00,
            modelA_subscriptionConversion: 5.00,
            modelA_subscriptionChurnRate: 25.00,
            modelA_accountClosureRate: 1.00,

            // MODEL B: Monthly Maintenance Fee Model
            modelB_maintenanceFee: 2.00,
            modelB_waivedFeesPercent: 30.00,
            modelB_subscriptionPrice: 10.00,
            modelB_dubRevenueShare: 50.00,
            modelB_subscriptionConversion: 3.00,
            modelB_subscriptionChurnRate: 25.00,
            modelB_accountClosureRate: 5.00,
        };

        // Load synced values first, then render
        this.initializeWithData();
    }

    async initializeWithData() {
        await this.loadCurrentValues(); // Wait for synced values from Supabase
        this.render(); // Then render with correct values
        this.updateCurrentValueDisplays(); // Update "Current:" text displays
    }

    async loadCurrentValues() {
        try {
            if (!window.supabaseIntegration) {
                console.warn('Supabase integration not available');
                return;
            }

            const { data, error } = await window.supabaseIntegration.supabase
                .from('business_assumptions')
                .select('*')
                .eq('id', 1)
                .single();

            if (error) {
                console.error('Error loading current values:', error);
                return;
            }

            if (data) {
                this.currentValues = {
                    totalRebalances: data.total_rebalances,
                    tradesPerUser: data.trades_per_user,
                    portfoliosCreatedPerUser: data.portfolios_created_per_user,
                    kycToLinkedBank: data.kyc_to_linked_bank,
                    linkedBankToAch: data.linked_bank_to_ach,
                    achToCopy: data.ach_to_copy,
                    syncedAt: data.synced_at
                };

                // Update assumptions with current values from Mixpanel
                this.assumptions.avgMonthlyTrades = data.trades_per_user;
                this.assumptions.avgMonthlyRebalances = data.total_rebalances;
                this.assumptions.avgMonthlyPortfolioCreations = data.portfolios_created_per_user;

                // Update conversion rates if available
                if (data.kyc_to_linked_bank !== null && data.kyc_to_linked_bank !== undefined) {
                    this.assumptions.kycToLinkedBank = data.kyc_to_linked_bank;
                }
                if (data.linked_bank_to_ach !== null && data.linked_bank_to_ach !== undefined) {
                    this.assumptions.linkedBankToACH = data.linked_bank_to_ach;
                }
            }
        } catch (error) {
            console.error('Error loading current values:', error);
        }
    }

    updateCurrentValueDisplays() {
        if (!this.currentValues) return;

        // Update the "Current:" text below the relevant input fields
        const tradesEl = document.getElementById('current-avgMonthlyTrades');
        const rebalancesEl = document.getElementById('current-avgMonthlyRebalances');
        const portfoliosEl = document.getElementById('current-avgMonthlyPortfolioCreations');
        const kycToLinkedBankEl = document.getElementById('current-kycToLinkedBank');
        const linkedBankToACHEl = document.getElementById('current-linkedBankToACH');

        if (tradesEl) {
            tradesEl.textContent = `Current: ${this.currentValues.tradesPerUser.toFixed(2)}`;
        }
        if (rebalancesEl) {
            rebalancesEl.textContent = `Current: ${this.currentValues.totalRebalances.toFixed(2)}`;
        }
        if (portfoliosEl) {
            portfoliosEl.textContent = `Current: ${this.currentValues.portfoliosCreatedPerUser.toFixed(2)}`;
        }
        if (kycToLinkedBankEl && this.currentValues.kycToLinkedBank !== null && this.currentValues.kycToLinkedBank !== undefined) {
            kycToLinkedBankEl.textContent = `Current: ${this.currentValues.kycToLinkedBank.toFixed(2)}%`;
        }
        if (linkedBankToACHEl && this.currentValues.linkedBankToAch !== null && this.currentValues.linkedBankToAch !== undefined) {
            linkedBankToACHEl.textContent = `Current: ${this.currentValues.linkedBankToAch.toFixed(2)}%`;
        }
    }

    updateAssumption(key, value) {
        this.assumptions[key] = parseFloat(value) || 0;
        // Don't re-render everything, just update the calculations
        this.updateCalculations();
    }

    updateCalculations() {
        const projections = this.calculateProjections();
        const yearlyProjections = this.calculateYearlyProjections(projections);

        // Update monthly comparison table
        const monthlyContainer = document.getElementById('monthlyComparisonContainer');
        if (monthlyContainer) {
            monthlyContainer.innerHTML = this.renderMonthlyComparison(projections);
        }

        // Update year comparison
        const yearContainer = document.getElementById('yearComparisonContainer');
        if (yearContainer) {
            yearContainer.innerHTML = this.renderYearComparisonContent(yearlyProjections);
        }
    }

    calculateProjections() {
        const months = Array.from({ length: 36 }, (_, i) => i + 1);
        const results = [];
        let cumulativeSubscribersA = 0;
        let cumulativeSubscribersB = 0;
        let modelA_cumulativeFundedAccounts = 0;
        let modelB_cumulativeFundedAccounts = 0;

        months.forEach(month => {
            // User growth (compound monthly)
            const monthlyUserGrowth = Math.pow(1 + this.assumptions.userGrowthRate / 100, month);
            const installs = this.assumptions.monthlyInstalls * monthlyUserGrowth;

            // Conversion funnel
            const kycApproved = installs * (this.assumptions.installToKYC / 100);
            const linkedBankAccounts = kycApproved * (this.assumptions.kycToLinkedBank / 100);
            const fundedAccounts = linkedBankAccounts * (this.assumptions.linkedBankToACH / 100);

            // MODEL A metrics with account closure rates applied
            const modelA_kycApproved = kycApproved * (1 - this.assumptions.modelA_accountClosureRate / 100);
            const modelA_linkedBankAccounts = linkedBankAccounts * (1 - this.assumptions.modelA_accountClosureRate / 100);
            const modelA_fundedAccounts = fundedAccounts * (1 - this.assumptions.modelA_accountClosureRate / 100);
            modelA_cumulativeFundedAccounts += modelA_fundedAccounts;

            // MODEL B metrics with account closure rates applied
            const modelB_kycApproved = kycApproved * (1 - this.assumptions.modelB_accountClosureRate / 100);
            const modelB_linkedBankAccounts = linkedBankAccounts * (1 - this.assumptions.modelB_accountClosureRate / 100);
            const modelB_fundedAccounts = fundedAccounts * (1 - this.assumptions.modelB_accountClosureRate / 100);
            modelB_cumulativeFundedAccounts += modelB_fundedAccounts;

            // Trading activity - MODEL A - based on Model A cumulative funded accounts
            const tradeVolumeMultiplier = Math.pow(1 + this.assumptions.tradeVolumeGrowth / 100, month - 1);
            const rebalanceMultiplier = Math.pow(1 + this.assumptions.rebalanceGrowth / 100, month - 1);
            const portfolioCreationMultiplier = Math.pow(1 + this.assumptions.portfolioCreationGrowth / 100, month - 1);

            const modelA_trades = modelA_cumulativeFundedAccounts * this.assumptions.avgMonthlyTrades * tradeVolumeMultiplier;
            const modelA_rebalances = this.assumptions.avgMonthlyRebalances * rebalanceMultiplier; // Use input value directly with growth
            const modelA_portfoliosCreated = modelA_cumulativeFundedAccounts * this.assumptions.avgMonthlyPortfolioCreations * portfolioCreationMultiplier;
            const modelA_totalTradingEvents = modelA_trades + modelA_rebalances + modelA_portfoliosCreated;

            // Trading activity - MODEL B - based on Model B cumulative funded accounts
            const modelB_trades = modelB_cumulativeFundedAccounts * this.assumptions.avgMonthlyTrades * tradeVolumeMultiplier;
            const modelB_rebalances = this.assumptions.avgMonthlyRebalances * rebalanceMultiplier; // Use input value directly with growth
            const modelB_portfoliosCreated = modelB_cumulativeFundedAccounts * this.assumptions.avgMonthlyPortfolioCreations * portfolioCreationMultiplier;
            const modelB_totalTradingEvents = modelB_trades + modelB_rebalances + modelB_portfoliosCreated;

            // Subscription calculations with churn - separate for each model based on KYC Approved (with closure rates)
            const newSubscribersA = modelA_kycApproved * (this.assumptions.modelA_subscriptionConversion / 100);
            const newSubscribersB = modelB_kycApproved * (this.assumptions.modelB_subscriptionConversion / 100);

            cumulativeSubscribersA = (cumulativeSubscribersA * (1 - this.assumptions.modelA_subscriptionChurnRate / 100)) + newSubscribersA;
            cumulativeSubscribersB = (cumulativeSubscribersB * (1 - this.assumptions.modelB_subscriptionChurnRate / 100)) + newSubscribersB;

            // MODEL A: Transaction Fee Model
            const modelA_transactionRevenue = modelA_totalTradingEvents * this.assumptions.modelA_transactionFee;
            const modelA_subscriptionRevenue = cumulativeSubscribersA * this.assumptions.modelA_subscriptionPrice * (this.assumptions.modelA_dubRevenueShare / 100);
            const modelA_totalRevenue = modelA_transactionRevenue + modelA_subscriptionRevenue;

            // MODEL B: Monthly Maintenance Fee Model
            const accountsPayingFees = modelB_cumulativeFundedAccounts * (1 - this.assumptions.modelB_waivedFeesPercent / 100);
            const modelB_maintenanceRevenue = accountsPayingFees * this.assumptions.modelB_maintenanceFee;
            const modelB_subscriptionRevenue = cumulativeSubscribersB * this.assumptions.modelB_subscriptionPrice * (this.assumptions.modelB_dubRevenueShare / 100);
            const modelB_totalRevenue = modelB_maintenanceRevenue + modelB_subscriptionRevenue;

            results.push({
                month,
                installs,
                cumulativeSubscribersA,
                cumulativeSubscribersB,
                // Model A specific metrics
                modelA_kycApproved,
                modelA_linkedBankAccounts,
                modelA_fundedAccounts,
                modelA_cumulativeFundedAccounts,
                modelA_trades,
                modelA_rebalances,
                modelA_portfoliosCreated,
                modelA_totalTradingEvents,
                modelA_transactionRevenue,
                modelA_subscriptionRevenue,
                modelA_totalRevenue,
                // Model B specific metrics
                modelB_kycApproved,
                modelB_linkedBankAccounts,
                modelB_fundedAccounts,
                modelB_cumulativeFundedAccounts,
                modelB_trades,
                modelB_rebalances,
                modelB_portfoliosCreated,
                modelB_totalTradingEvents,
                modelB_maintenanceRevenue,
                modelB_subscriptionRevenue,
                modelB_totalRevenue
            });
        });

        return results;
    }

    calculateYearlyProjections(projections) {
        const years = [1, 2, 3];
        return years.map(year => {
            const startMonth = (year - 1) * 12;
            const endMonth = year * 12;
            const yearMonths = projections.slice(startMonth, endMonth);
            const lastMonth = projections[endMonth - 1];

            return {
                year,
                avgInstalls: yearMonths.reduce((sum, m) => sum + m.installs, 0) / 12,
                totalKYCApproved: yearMonths.reduce((sum, m) => sum + m.kycApproved, 0),
                totalLinkedBankAccounts: yearMonths.reduce((sum, m) => sum + m.linkedBankAccounts, 0),
                totalFundedAccounts: yearMonths.reduce((sum, m) => sum + m.fundedAccounts, 0),
                endingCumulativeFundedAccounts: lastMonth.cumulativeFundedAccounts,
                totalTrades: yearMonths.reduce((sum, m) => sum + m.trades, 0),
                totalRebalances: yearMonths.reduce((sum, m) => sum + m.rebalances, 0),
                totalTradingEvents: yearMonths.reduce((sum, m) => sum + m.totalTradingEvents, 0),
                endingSubscribersA: lastMonth.cumulativeSubscribersA,
                endingSubscribersB: lastMonth.cumulativeSubscribersB,
                modelA_totalRevenue: yearMonths.reduce((sum, m) => sum + m.modelA_totalRevenue, 0),
                modelB_totalRevenue: yearMonths.reduce((sum, m) => sum + m.modelB_totalRevenue, 0),
            };
        });
    }

    formatCurrency(value) {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }).format(value);
    }

    formatNumber(value) {
        return new Intl.NumberFormat('en-US', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }).format(value);
    }

    formatPercent(value) {
        return `${value.toFixed(1)}%`;
    }

    render() {
        const projections = this.calculateProjections();
        const yearlyProjections = this.calculateYearlyProjections(projections);

        this.container.innerHTML = `
            <style>
                .metric-tooltip {
                    position: relative;
                    text-decoration: underline;
                    text-decoration-style: dotted;
                    cursor: help;
                }
                .metric-tooltip .tooltip-text {
                    visibility: hidden;
                    width: 420px;
                    background-color: #2d3748;
                    color: #fff;
                    text-align: left;
                    border-radius: 6px;
                    padding: 14px;
                    position: fixed;
                    z-index: 10000;
                    opacity: 0;
                    transition: opacity 0.3s;
                    font-size: 12px;
                    line-height: 1.6;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                    white-space: normal;
                    pointer-events: none;
                }
                .metric-tooltip .tooltip-text::after {
                    content: "";
                    position: absolute;
                    top: 100%;
                    left: 50%;
                    transform: translateX(-50%);
                    border-width: 6px;
                    border-style: solid;
                    border-color: #2d3748 transparent transparent transparent;
                }
                .metric-tooltip:hover .tooltip-text {
                    visibility: visible;
                    opacity: 1;
                }
            </style>
            <div style="width: 100%; max-width: 1400px; margin: 0 auto; padding: 24px; box-sizing: border-box;">
                <div style="text-align: center; margin-bottom: 32px;">
                    <h1 style="font-size: 28px; font-weight: bold; margin: 0 0 8px 0;">Business Model Analysis</h1>
                    <p style="color: #6c757d; margin: 0;">Transaction Fee Model vs. Monthly Maintenance Fee Model</p>
                </div>

                ${this.renderAssumptions()}
                <div id="yearComparisonContainer">
                    ${this.renderYearComparisonContent(yearlyProjections)}
                </div>
                <div id="monthlyComparisonContainer">
                    ${this.renderMonthlyComparison(projections)}
                </div>
            </div>
        `;

        this.attachEventListeners();

        // Add anchor links to all headers
        if (window.addAnchorLinks) {
            window.addAnchorLinks(this.container);
        }
    }

    renderAssumptions() {
        return `
            <div style="background: white; border: 1px solid #dee2e6; border-radius: 10px; padding: 20px; margin-bottom: 24px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); position: relative;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                    <h3 style="margin: 0; font-size: 18px; font-weight: bold;">Assumptions</h3>
                    <button
                        id="syncBusinessAssumptions"
                        style="padding: 6px 12px; background: #17a2b8; color: white; border: none; border-radius: 4px; font-size: 12px; cursor: pointer; transition: background 0.2s;"
                        onmouseover="this.style.background='#138496'"
                        onmouseout="this.style.background='#17a2b8'"
                    >
                        Sync Data
                    </button>
                </div>
                <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px;">
                    <div style="display: flex; flex-direction: column; gap: 24px;">
                        ${this.renderConversionRates()}
                        ${this.renderOtherAssumptions()}
                    </div>
                    ${this.renderUserBehavior()}
                    ${this.renderModelA()}
                    ${this.renderModelB()}
                </div>
            </div>
        `;
    }

    renderConversionRates() {
        return `
            <div>
                <h4 style="font-size: 12px; font-weight: bold; color: #495057; text-transform: uppercase; margin: 0 0 12px 0;">Conversion Rates</h4>
                <div style="display: flex; flex-direction: column; gap: 12px;">
                    ${this.renderInput('Install → KYC (%)', 'installToKYC')}
                    ${this.renderInput('KYC → Linked Bank (%)', 'kycToLinkedBank')}
                    ${this.renderInput('Linked Bank → ACH (%)', 'linkedBankToACH')}
                </div>
            </div>
        `;
    }

    renderOtherAssumptions() {
        return `
            <div>
                <h4 style="font-size: 12px; font-weight: bold; color: #495057; text-transform: uppercase; margin: 0 0 12px 0;">Other Assumptions</h4>
                <div style="display: flex; flex-direction: column; gap: 12px;">
                    ${this.renderInput('Monthly Installs', 'monthlyInstalls')}
                    ${this.renderInput('User Growth (% monthly)', 'userGrowthRate')}
                    ${this.renderInput('Monthly Rebalances', 'avgMonthlyRebalances')}
                    ${this.renderInput('Rebalance Growth (% monthly)', 'rebalanceGrowth')}
                </div>
            </div>
        `;
    }

    renderUserBehavior() {
        return `
            <div>
                <h4 style="font-size: 12px; font-weight: bold; color: #495057; text-transform: uppercase; margin: 0 0 12px 0;">User Behavior (Per User)</h4>
                <div style="display: flex; flex-direction: column; gap: 12px;">
                    ${this.renderInput('Monthly Trades', 'avgMonthlyTrades')}
                    ${this.renderInput('Trade Volume Growth (% monthly)', 'tradeVolumeGrowth')}
                    ${this.renderInput('Monthly Portfolio Creations', 'avgMonthlyPortfolioCreations')}
                    ${this.renderInput('Portfolio Creation Growth (% monthly)', 'portfolioCreationGrowth')}
                </div>
            </div>
        `;
    }

    renderModelA() {
        return `
            <div style="background: #e7f3ff; padding: 16px; border-radius: 8px;">
                <h4 style="font-size: 12px; font-weight: bold; color: #0056b3; text-transform: uppercase; margin: 0 0 12px 0;">Model A: Transaction Fee</h4>
                <div style="display: flex; flex-direction: column; gap: 12px;">
                    ${this.renderInput('Transaction Fee ($ per trade)', 'modelA_transactionFee')}
                    ${this.renderInput('Subscription Price ($/mo)', 'modelA_subscriptionPrice')}
                    ${this.renderInput('Dub Revenue Share (%)', 'modelA_dubRevenueShare')}
                    ${this.renderInput('Subscription Conversion (% of KYC)', 'modelA_subscriptionConversion')}
                    ${this.renderInput('Subscription Churn (% monthly)', 'modelA_subscriptionChurnRate')}
                    ${this.renderInput('Account Closure Rate (% monthly)', 'modelA_accountClosureRate')}
                </div>
            </div>
        `;
    }

    renderModelB() {
        return `
            <div style="background: #e8f5e9; padding: 16px; border-radius: 8px;">
                <h4 style="font-size: 12px; font-weight: bold; color: #2e7d32; text-transform: uppercase; margin: 0 0 12px 0;">Model B: Maintenance Fee</h4>
                <div style="display: flex; flex-direction: column; gap: 12px;">
                    ${this.renderInput('Maintenance Fee ($/mo per funded acct)', 'modelB_maintenanceFee')}
                    ${this.renderInput('Waived Fees (% of funded acct)', 'modelB_waivedFeesPercent')}
                    ${this.renderInput('Subscription Price ($/mo)', 'modelB_subscriptionPrice')}
                    ${this.renderInput('Dub Revenue Share (%)', 'modelB_dubRevenueShare')}
                    ${this.renderInput('Subscription Conversion (% of KYC)', 'modelB_subscriptionConversion')}
                    ${this.renderInput('Subscription Churn (% monthly)', 'modelB_subscriptionChurnRate')}
                    ${this.renderInput('Account Closure Rate (% monthly)', 'modelB_accountClosureRate')}
                </div>
            </div>
        `;
    }

    renderInput(label, key) {
        // Check if this field should show current value
        const showCurrent = ['avgMonthlyTrades', 'avgMonthlyRebalances', 'avgMonthlyPortfolioCreations', 'kycToLinkedBank', 'linkedBankToACH'].includes(key);

        return `
            <div>
                <label style="display: block; font-size: 11px; color: #6c757d; margin-bottom: 4px;">${label}</label>
                <input
                    type="number"
                    step="0.01"
                    value="${this.assumptions[key].toFixed(2)}"
                    data-key="${key}"
                    style="width: 100%; padding: 8px; border: 1px solid #ced4da; border-radius: 4px; font-size: 13px; box-sizing: border-box;"
                    onblur="this.value = parseFloat(this.value).toFixed(2)"
                />
                ${showCurrent ? `<div id="current-${key}" style="font-size: 10px; color: #17a2b8; margin-top: 4px;">Current: Loading...</div>` : ''}
            </div>
        `;
    }

    renderMonthlyComparison(projections) {
        return `
            <div style="background: white; border: 1px solid #dee2e6; border-radius: 10px; padding: 20px; margin-bottom: 24px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <h3 style="margin: 0 0 16px 0; font-size: 18px; font-weight: bold;">Monthly Revenue Comparison</h3>
                <div style="overflow-x: auto;">
                    <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
                        <thead>
                            <tr style="border-bottom: 2px solid #dee2e6;">
                                <th style="text-align: left; padding: 8px; font-weight: bold; position: sticky; left: 0; background: white; z-index: 1; min-width: 200px; white-space: nowrap;">Metric</th>
                                ${projections.map(p => `<th style="text-align: right; padding: 8px; font-weight: bold; ${p.month % 12 === 0 ? 'background: #f8f9fa;' : ''}">M${p.month}</th>`).join('')}
                            </tr>
                        </thead>
                        <tbody>
                            ${this.renderMetricRow('MODEL A: TRANSACTION FEE', null, projections, true, '#e7f3ff')}
                            ${this.renderMetricRow('Installs', 'installs', projections)}
                            ${this.renderMetricRow('KYC Approved', 'modelA_kycApproved', projections)}
                            ${this.renderMetricRow('Linked Bank Accounts', 'modelA_linkedBankAccounts', projections)}
                            ${this.renderMetricRow('New Funded Accounts', 'modelA_fundedAccounts', projections)}
                            ${this.renderMetricRow('Cumulative Funded Accounts', 'modelA_cumulativeFundedAccounts', projections)}
                            ${this.renderMetricRow('Total Trades', 'modelA_trades', projections)}
                            ${this.renderMetricRow('Total Rebalances', 'modelA_rebalances', projections)}
                            ${this.renderMetricRow('Total Portfolios Created', 'modelA_portfoliosCreated', projections)}
                            ${this.renderMetricRow('Total Trading Events', 'modelA_totalTradingEvents', projections)}
                            ${this.renderSeparatorRow(projections)}
                            ${this.renderMetricRow('Transaction Revenue', 'modelA_transactionRevenue', projections, false, null, true, false, 'Calculated as: Total Trading Events × Transaction Fee per trade<br><br>Total Trading Events = Total Trades + Total Rebalances + Total Portfolios Created<br><br>Each component is calculated based on Cumulative Funded Accounts (which includes account closure rates), multiplied by the respective activity rate per user and growth rate')}
                            ${this.renderMetricRow('Subscription Revenue', 'modelA_subscriptionRevenue', projections, false, null, true, false, 'Calculated as: Active Subscribers × Subscription Price × Dub Revenue Share %<br><br>Active Subscribers = New subscribers added each month minus churned subscribers<br><br>New Subscribers = KYC Approved × (1 - Account Closure Rate) × Subscription Conversion Rate<br><br>Churned Subscribers = Previous Active Subscribers × Subscription Churn Rate')}
                            ${this.renderMetricRow('Total Revenue', 'modelA_totalRevenue', projections, false, '#cfe2ff', true, true)}

                            ${this.renderMetricRow('MODEL B: MAINTENANCE FEE', null, projections, true, '#e8f5e9')}
                            ${this.renderMetricRow('Installs', 'installs', projections)}
                            ${this.renderMetricRow('KYC Approved', 'modelB_kycApproved', projections)}
                            ${this.renderMetricRow('Linked Bank Accounts', 'modelB_linkedBankAccounts', projections)}
                            ${this.renderMetricRow('New Funded Accounts', 'modelB_fundedAccounts', projections)}
                            ${this.renderMetricRow('Cumulative Funded Accounts', 'modelB_cumulativeFundedAccounts', projections)}
                            ${this.renderMetricRow('Total Trades', 'modelB_trades', projections)}
                            ${this.renderMetricRow('Total Rebalances', 'modelB_rebalances', projections)}
                            ${this.renderMetricRow('Total Portfolios Created', 'modelB_portfoliosCreated', projections)}
                            ${this.renderMetricRow('Total Trading Events', 'modelB_totalTradingEvents', projections)}
                            ${this.renderSeparatorRow(projections)}
                            ${this.renderMetricRow('Maintenance Revenue', 'modelB_maintenanceRevenue', projections, false, null, true, false, 'Calculated as: Cumulative Funded Accounts × (1 - Waived Fees %) × Monthly Maintenance Fee per account<br><br>Cumulative Funded Accounts includes account closure rates applied to new funded accounts each month<br><br>Only accounts that have not waived the fee are charged the monthly maintenance fee')}
                            ${this.renderMetricRow('Subscription Revenue', 'modelB_subscriptionRevenue', projections, false, null, true, false, 'Calculated as: Active Subscribers × Subscription Price × Dub Revenue Share %<br><br>Active Subscribers = New subscribers added each month minus churned subscribers<br><br>New Subscribers = KYC Approved × (1 - Account Closure Rate) × Subscription Conversion Rate<br><br>Churned Subscribers = Previous Active Subscribers × Subscription Churn Rate')}
                            ${this.renderMetricRow('Total Revenue', 'modelB_totalRevenue', projections, false, '#c8e6c9', true, true)}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    renderSeparatorRow(projections) {
        return `
            <tr>
                <td colspan="${projections.length + 1}" style="padding: 0; border-top: 1px solid #dee2e6;"></td>
            </tr>
        `;
    }

    renderMetricRow(label, key, projections, isHeader = false, bgColor = null, isCurrency = false, isBold = false, tooltip = null) {
        if (isHeader) {
            return `
                <tr style="background: ${bgColor || '#f8f9fa'};">
                    <td style="padding: 8px; font-weight: bold; position: sticky; left: 0; background: ${bgColor || '#f8f9fa'}; z-index: 1; min-width: 200px; white-space: nowrap;">${label}</td>
                    ${projections.map(() => '<td></td>').join('')}
                </tr>
            `;
        }

        // Render label with optional tooltip
        const labelHtml = tooltip
            ? `<span class="metric-tooltip">${label}<span class="tooltip-text">${tooltip}</span></span>`
            : label;

        return `
            <tr>
                <td style="padding: 8px; ${isBold ? 'font-weight: bold;' : ''} position: sticky; left: 0; background: white; z-index: 1; min-width: 200px; white-space: nowrap;">${labelHtml}</td>
                ${projections.map(p => {
                    const value = p[key];
                    const formatted = isCurrency ? this.formatCurrency(value) : this.formatNumber(value);
                    const bg = p.month % 12 === 0 ? (bgColor || '#f8f9fa') : (bgColor || 'white');
                    return `<td style="text-align: right; padding: 8px; ${isBold ? 'font-weight: bold;' : ''} background: ${bg};">${formatted}</td>`;
                }).join('')}
            </tr>
        `;
    }

    renderYearComparisonContent(yearlyProjections) {
        const year1 = yearlyProjections[0];
        const year2 = yearlyProjections[1];
        const year3 = yearlyProjections[2];

        return `
            <div style="background: white; border: 1px solid #dee2e6; border-radius: 10px; padding: 20px; margin-bottom: 24px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <h3 style="margin: 0 0 24px 0; font-size: 18px; font-weight: bold;">3-Year Revenue Comparison</h3>

                <div style="display: grid; grid-template-columns: 180px repeat(3, 1fr); gap: 12px; align-items: start;">
                    <!-- Header Row -->
                    <div></div>
                    <div style="text-align: center; font-weight: 600; font-size: 14px; color: #495057; padding: 8px;">Year 1</div>
                    <div style="text-align: center; font-weight: 600; font-size: 14px; color: #495057; padding: 8px;">Year 2</div>
                    <div style="text-align: center; font-weight: 600; font-size: 14px; color: #495057; padding: 8px;">Year 3</div>

                    <!-- Model A Row -->
                    <div style="display: flex; align-items: center; padding: 16px; background: #e7f3ff; border-radius: 6px; font-weight: 600; font-size: 12px; color: #0d47a1;">
                        Model A:<br/>Transaction Fee
                    </div>
                    <div style="padding: 16px; background: #e7f3ff; border-radius: 6px; border: 1px solid #90caf9; text-align: center;">
                        <div style="font-size: 20px; font-weight: bold; color: #0d47a1;">${this.formatCurrency(year1.modelA_totalRevenue)}</div>
                    </div>
                    <div style="padding: 16px; background: #e7f3ff; border-radius: 6px; border: 1px solid #90caf9; text-align: center;">
                        <div style="font-size: 20px; font-weight: bold; color: #0d47a1;">${this.formatCurrency(year2.modelA_totalRevenue)}</div>
                    </div>
                    <div style="padding: 16px; background: #e7f3ff; border-radius: 6px; border: 1px solid #90caf9; text-align: center;">
                        <div style="font-size: 20px; font-weight: bold; color: #0d47a1;">${this.formatCurrency(year3.modelA_totalRevenue)}</div>
                    </div>

                    <!-- Model B Row -->
                    <div style="display: flex; align-items: center; padding: 16px; background: #e8f5e9; border-radius: 6px; font-weight: 600; font-size: 12px; color: #1b5e20;">
                        Model B:<br/>Maintenance Fee
                    </div>
                    <div style="padding: 16px; background: #e8f5e9; border-radius: 6px; border: 1px solid #81c784; text-align: center;">
                        <div style="font-size: 20px; font-weight: bold; color: #1b5e20;">${this.formatCurrency(year1.modelB_totalRevenue)}</div>
                    </div>
                    <div style="padding: 16px; background: #e8f5e9; border-radius: 6px; border: 1px solid #81c784; text-align: center;">
                        <div style="font-size: 20px; font-weight: bold; color: #1b5e20;">${this.formatCurrency(year2.modelB_totalRevenue)}</div>
                    </div>
                    <div style="padding: 16px; background: #e8f5e9; border-radius: 6px; border: 1px solid #81c784; text-align: center;">
                        <div style="font-size: 20px; font-weight: bold; color: #1b5e20;">${this.formatCurrency(year3.modelB_totalRevenue)}</div>
                    </div>

                    <!-- Difference Row -->
                    <div style="display: flex; align-items: center; padding: 16px; background: #f3e5f5; border-radius: 6px; font-weight: 600; font-size: 12px; color: #6a1b9a;">
                        Difference<br/>(B - A)
                    </div>
                    <div style="padding: 16px; background: #f3e5f5; border-radius: 6px; border: 1px solid #ce93d8; text-align: center;">
                        <div style="font-size: 20px; font-weight: bold; color: #6a1b9a;">${this.formatCurrency(year1.modelB_totalRevenue - year1.modelA_totalRevenue)}</div>
                    </div>
                    <div style="padding: 16px; background: #f3e5f5; border-radius: 6px; border: 1px solid #ce93d8; text-align: center;">
                        <div style="font-size: 20px; font-weight: bold; color: #6a1b9a;">${this.formatCurrency(year2.modelB_totalRevenue - year2.modelA_totalRevenue)}</div>
                    </div>
                    <div style="padding: 16px; background: #f3e5f5; border-radius: 6px; border: 1px solid #ce93d8; text-align: center;">
                        <div style="font-size: 20px; font-weight: bold; color: #6a1b9a;">${this.formatCurrency(year3.modelB_totalRevenue - year3.modelA_totalRevenue)}</div>
                    </div>
                </div>
            </div>
        `;
    }

    async syncBusinessAssumptions() {
        const button = document.getElementById('syncBusinessAssumptions');
        if (!button) return;

        try {
            // Disable button and show loading state
            button.disabled = true;
            button.textContent = 'Syncing...';
            button.style.background = '#6c757d';

            if (!window.supabaseIntegration) {
                throw new Error('Supabase integration not available');
            }

            // Call the Edge Function
            const { data, error } = await window.supabaseIntegration.supabase.functions.invoke('sync-business-assumptions', {
                body: {}
            });

            if (error) {
                console.error('Edge Function error:', error);
                throw new Error(`Sync failed: ${error.message}`);
            }

            if (!data.success) {
                throw new Error(data.error || 'Unknown error during sync');
            }

            console.log('✅ Business assumptions synced:', data.data);

            // Reload the current values and update displays
            await this.loadCurrentValues();

            // Show success state
            button.textContent = 'Synced!';
            button.style.background = '#28a745';

            setTimeout(() => {
                button.disabled = false;
                button.textContent = 'Sync Data';
                button.style.background = '#17a2b8';
            }, 2000);

        } catch (error) {
            console.error('Error syncing business assumptions:', error);
            button.textContent = 'Sync Failed';
            button.style.background = '#dc3545';

            setTimeout(() => {
                button.disabled = false;
                button.textContent = 'Sync Data';
                button.style.background = '#17a2b8';
            }, 3000);
        }
    }

    attachEventListeners() {
        const inputs = this.container.querySelectorAll('input[data-key]');
        inputs.forEach(input => {
            input.addEventListener('input', (e) => {
                const key = e.target.getAttribute('data-key');
                this.updateAssumption(key, e.target.value);
            });
        });

        // Attach sync button listener
        const syncButton = document.getElementById('syncBusinessAssumptions');
        if (syncButton) {
            syncButton.addEventListener('click', () => this.syncBusinessAssumptions());
        }

        // Attach tooltip positioning listeners
        const tooltips = this.container.querySelectorAll('.metric-tooltip');
        tooltips.forEach(tooltip => {
            tooltip.addEventListener('mouseenter', (e) => {
                const tooltipText = tooltip.querySelector('.tooltip-text');
                if (tooltipText) {
                    const rect = tooltip.getBoundingClientRect();
                    // Center the tooltip horizontally on the trigger element
                    const left = rect.left + (rect.width / 2);
                    tooltipText.style.left = `${left}px`;
                    tooltipText.style.top = `${rect.top}px`;
                    // Adjust to center the tooltip box itself
                    tooltipText.style.transform = 'translate(-50%, calc(-100% - 10px))';
                }
            });
        });
    }
}

// Initialize on page load
if (typeof window !== 'undefined') {
    window.BusinessModelAnalysis = BusinessModelAnalysis;
}
