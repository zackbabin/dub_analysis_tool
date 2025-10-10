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
            avgMonthlyTrades: 2.773859,
            avgMonthlyRebalances: 12,
            tradeVolumeGrowth: 0,
            rebalanceGrowth: 0,
            avgMonthlyPortfolioCreations: 0.048831,
            portfolioCreationGrowth: 0,

            // Monthly baseline (3-month average)
            monthlyInstalls: 157444,
            monthlyFundedAccounts: 9339,

            // Growth assumptions (monthly)
            userGrowthRate: 0.797,

            // Subscription assumptions
            subscriptionConversion: 3,
            subscriptionChurnRate: 25,

            // MODEL A: Transaction Fee Model
            modelA_transactionFee: 0.10,
            modelA_subscriptionPrice: 5,
            modelA_dubRevenueShare: 50,
            modelA_subscriptionConversion: 3,
            modelA_subscriptionChurnRate: 25,

            // MODEL B: Monthly Maintenance Fee Model
            modelB_maintenanceFee: 5.00,
            modelB_waivedFeesPercent: 0,
            modelB_subscriptionPrice: 10,
            modelB_dubRevenueShare: 50,
            modelB_subscriptionConversion: 3,
            modelB_subscriptionChurnRate: 25,
        };

        this.render();
        this.loadCurrentValues(); // Load synced values from Supabase
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
                    rebalancesPerUser: data.rebalances_per_user,
                    tradesPerUser: data.trades_per_user,
                    portfoliosCreatedPerUser: data.portfolios_created_per_user,
                    syncedAt: data.synced_at
                };
                this.updateCurrentValueDisplays();
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

        if (tradesEl) {
            tradesEl.textContent = `Current: ${this.currentValues.tradesPerUser.toFixed(2)}`;
        }
        if (rebalancesEl) {
            rebalancesEl.textContent = `Current: ${this.currentValues.rebalancesPerUser.toFixed(2)}`;
        }
        if (portfoliosEl) {
            portfoliosEl.textContent = `Current: ${this.currentValues.portfoliosCreatedPerUser.toFixed(2)}`;
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
        let cumulativeFundedAccounts = 0;

        months.forEach(month => {
            // User growth (compound monthly)
            const monthlyUserGrowth = Math.pow(1 + this.assumptions.userGrowthRate / 100, month);
            const installs = this.assumptions.monthlyInstalls * monthlyUserGrowth;

            // Conversion funnel
            const kycApproved = installs * (this.assumptions.installToKYC / 100);
            const linkedBankAccounts = kycApproved * (this.assumptions.kycToLinkedBank / 100);
            const fundedAccounts = linkedBankAccounts * (this.assumptions.linkedBankToACH / 100);

            // Track cumulative funded accounts
            cumulativeFundedAccounts += fundedAccounts;

            // Trading activity - based on funded accounts with growth multipliers
            const tradeVolumeMultiplier = Math.pow(1 + this.assumptions.tradeVolumeGrowth / 100, month);
            const rebalanceMultiplier = Math.pow(1 + this.assumptions.rebalanceGrowth / 100, month);
            const portfolioCreationMultiplier = Math.pow(1 + this.assumptions.portfolioCreationGrowth / 100, month);

            const trades = cumulativeFundedAccounts * this.assumptions.avgMonthlyTrades * tradeVolumeMultiplier;
            const rebalances = cumulativeFundedAccounts * this.assumptions.avgMonthlyRebalances * rebalanceMultiplier;
            const portfoliosCreated = cumulativeFundedAccounts * this.assumptions.avgMonthlyPortfolioCreations * portfolioCreationMultiplier;
            const totalTradingEvents = trades + rebalances + portfoliosCreated;

            // Subscription calculations with churn - separate for each model based on KYC Approved
            const newSubscribersA = kycApproved * (this.assumptions.modelA_subscriptionConversion / 100);
            const newSubscribersB = kycApproved * (this.assumptions.modelB_subscriptionConversion / 100);

            cumulativeSubscribersA = (cumulativeSubscribersA * (1 - this.assumptions.modelA_subscriptionChurnRate / 100)) + newSubscribersA;
            cumulativeSubscribersB = (cumulativeSubscribersB * (1 - this.assumptions.modelB_subscriptionChurnRate / 100)) + newSubscribersB;

            // MODEL A: Transaction Fee Model
            const modelA_transactionRevenue = totalTradingEvents * this.assumptions.modelA_transactionFee;
            const modelA_subscriptionRevenue = cumulativeSubscribersA * this.assumptions.modelA_subscriptionPrice * (this.assumptions.modelA_dubRevenueShare / 100);
            const modelA_totalRevenue = modelA_transactionRevenue + modelA_subscriptionRevenue;

            // MODEL B: Monthly Maintenance Fee Model
            const accountsPayingFees = cumulativeFundedAccounts * (1 - this.assumptions.modelB_waivedFeesPercent / 100);
            const modelB_maintenanceRevenue = accountsPayingFees * this.assumptions.modelB_maintenanceFee;
            const modelB_subscriptionRevenue = cumulativeSubscribersB * this.assumptions.modelB_subscriptionPrice * (this.assumptions.modelB_dubRevenueShare / 100);
            const modelB_totalRevenue = modelB_maintenanceRevenue + modelB_subscriptionRevenue;

            results.push({
                month,
                installs,
                kycApproved,
                linkedBankAccounts,
                fundedAccounts,
                cumulativeFundedAccounts,
                trades,
                rebalances,
                portfoliosCreated,
                totalTradingEvents,
                cumulativeSubscribersA,
                cumulativeSubscribersB,
                modelA_transactionRevenue,
                modelA_subscriptionRevenue,
                modelA_totalRevenue,
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
            <div style="width: 100%; max-width: 1400px; margin: 0 auto; padding: 24px; box-sizing: border-box;">
                <div style="text-align: center; margin-bottom: 32px;">
                    <h1 style="font-size: 28px; font-weight: bold; margin: 0 0 8px 0;">Business Model Analysis</h1>
                    <p style="color: #6c757d; margin: 0;">Transaction Fee Model vs. Monthly Maintenance Fee Model</p>
                </div>

                ${this.renderAssumptions()}
                <div id="monthlyComparisonContainer">
                    ${this.renderMonthlyComparison(projections)}
                </div>
                <div id="yearComparisonContainer">
                    ${this.renderYearComparisonContent(yearlyProjections)}
                </div>
            </div>
        `;

        this.attachEventListeners();
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
                    ${this.renderInput('Monthly Rebalances', 'avgMonthlyRebalances')}
                    ${this.renderInput('Rebalance Growth (% monthly)', 'rebalanceGrowth')}
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
                </div>
            </div>
        `;
    }

    renderInput(label, key) {
        // Check if this field should show current value
        const showCurrent = ['avgMonthlyTrades', 'avgMonthlyRebalances', 'avgMonthlyPortfolioCreations'].includes(key);

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
                            ${this.renderMetricRow('USER METRICS', null, projections, true)}
                            ${this.renderMetricRow('Installs', 'installs', projections)}
                            ${this.renderMetricRow('KYC Approved', 'kycApproved', projections)}
                            ${this.renderMetricRow('Linked Bank Accounts', 'linkedBankAccounts', projections)}
                            ${this.renderMetricRow('Funded Accounts', 'fundedAccounts', projections)}
                            ${this.renderMetricRow('Cumulative Funded Accounts', 'cumulativeFundedAccounts', projections)}
                            ${this.renderMetricRow('Total Trades', 'trades', projections)}
                            ${this.renderMetricRow('Total Rebalances', 'rebalances', projections)}
                            ${this.renderMetricRow('Total Portfolios Created', 'portfoliosCreated', projections)}
                            ${this.renderMetricRow('Total Trading Events', 'totalTradingEvents', projections)}

                            ${this.renderMetricRow('MODEL A: TRANSACTION FEE', null, projections, true, '#e7f3ff')}
                            ${this.renderMetricRow('Transaction Revenue', 'modelA_transactionRevenue', projections, false, null, true)}
                            ${this.renderMetricRow('Subscription Revenue', 'modelA_subscriptionRevenue', projections, false, null, true)}
                            ${this.renderMetricRow('Total Revenue', 'modelA_totalRevenue', projections, false, '#cfe2ff', true, true)}

                            ${this.renderMetricRow('MODEL B: MAINTENANCE FEE', null, projections, true, '#e8f5e9')}
                            ${this.renderMetricRow('Maintenance Revenue', 'modelB_maintenanceRevenue', projections, false, null, true)}
                            ${this.renderMetricRow('Subscription Revenue', 'modelB_subscriptionRevenue', projections, false, null, true)}
                            ${this.renderMetricRow('Total Revenue', 'modelB_totalRevenue', projections, false, '#c8e6c9', true, true)}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    renderMetricRow(label, key, projections, isHeader = false, bgColor = null, isCurrency = false, isBold = false) {
        if (isHeader) {
            return `
                <tr style="background: ${bgColor || '#f8f9fa'};">
                    <td style="padding: 8px; font-weight: bold; position: sticky; left: 0; background: ${bgColor || '#f8f9fa'}; z-index: 1; min-width: 200px; white-space: nowrap;">${label}</td>
                    ${projections.map(() => '<td></td>').join('')}
                </tr>
            `;
        }

        return `
            <tr>
                <td style="padding: 8px; ${isBold ? 'font-weight: bold;' : ''} position: sticky; left: 0; background: white; z-index: 1; min-width: 200px; white-space: nowrap;">${label}</td>
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
        const year3 = yearlyProjections[2];
        const diffAmount = year3.modelB_totalRevenue - year3.modelA_totalRevenue;
        const diffPercent = ((year3.modelB_totalRevenue - year3.modelA_totalRevenue) / year3.modelA_totalRevenue) * 100;

        return `
            <div style="background: white; border: 1px solid #dee2e6; border-radius: 10px; padding: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <h3 style="margin: 0 0 16px 0; font-size: 18px; font-weight: bold;">Year 3 Comparison</h3>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px;">
                    <div style="padding: 20px; background: #e7f3ff; border-radius: 8px; border: 2px solid #90caf9;">
                        <div style="font-size: 13px; color: #495057; margin-bottom: 8px;">Model A: Transaction Fee</div>
                        <div style="font-size: 24px; font-weight: bold; color: #0d47a1; margin-bottom: 8px;">${this.formatCurrency(year3.modelA_totalRevenue)}</div>
                        <div style="font-size: 11px; color: #6c757d;">$${this.assumptions.modelA_transactionFee.toFixed(2)} per trade + $${this.assumptions.modelA_subscriptionPrice.toFixed(2)}/mo subscription</div>
                    </div>
                    <div style="padding: 20px; background: #e8f5e9; border-radius: 8px; border: 2px solid #81c784;">
                        <div style="font-size: 13px; color: #495057; margin-bottom: 8px;">Model B: Maintenance Fee</div>
                        <div style="font-size: 24px; font-weight: bold; color: #1b5e20; margin-bottom: 8px;">${this.formatCurrency(year3.modelB_totalRevenue)}</div>
                        <div style="font-size: 11px; color: #6c757d;">$${this.assumptions.modelB_maintenanceFee.toFixed(2)}/mo per account + $${this.assumptions.modelB_subscriptionPrice.toFixed(2)}/mo subscription</div>
                    </div>
                    <div style="padding: 20px; background: #f3e5f5; border-radius: 8px; border: 2px solid #ce93d8;">
                        <div style="font-size: 13px; color: #495057; margin-bottom: 8px;">Difference (B - A)</div>
                        <div style="font-size: 24px; font-weight: bold; color: #6a1b9a; margin-bottom: 8px;">${this.formatCurrency(diffAmount)}</div>
                        <div style="font-size: 11px; color: #6c757d;">${this.formatPercent(diffPercent)} higher</div>
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
    }
}

// Initialize on page load
if (typeof window !== 'undefined') {
    window.BusinessModelAnalysis = BusinessModelAnalysis;
}
