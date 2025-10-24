// Crypto Analysis Tool - Vanilla JavaScript Implementation
// Single business model calculator without sync functionality

class CryptoAnalysis {
    constructor(containerId) {
        this.container = document.getElementById(containerId);

        // Base assumptions
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
            avgTradeValue: 100.00,

            // Monthly baseline (3-month average)
            monthlyInstalls: 157443.98,
            monthlyFundedAccounts: 9339,

            // Growth assumptions (monthly)
            userGrowthRate: 10.00,

            // Revenue model assumptions (maintenance fee model)
            maintenanceFee: 2.00,
            waivedFeesPercent: 30.00,
            subscriptionPrice: 10.00,
            dubRevenueShare: 50.00,
            subscriptionConversion: 3.00,
            subscriptionChurnRate: 25.00,
            accountClosureRate: 5.00,

            // Cost assumptions
            bakktTransactionFee: 0.50,
        };

        this.render();
    }

    updateAssumption(key, value) {
        this.assumptions[key] = parseFloat(value) || 0;
        this.updateCalculations();
    }

    updateCalculations() {
        const projections = this.calculateProjections();
        const yearlyProjections = this.calculateYearlyProjections(projections);

        // Update monthly table
        const monthlyContainer = document.getElementById('cryptoMonthlyContainer');
        if (monthlyContainer) {
            monthlyContainer.innerHTML = this.renderMonthlyTable(projections);
        }

        // Update year comparison
        const yearContainer = document.getElementById('cryptoYearContainer');
        if (yearContainer) {
            yearContainer.innerHTML = this.renderYearComparison(yearlyProjections);
        }
    }

    calculateProjections() {
        const months = Array.from({ length: 36 }, (_, i) => i + 1);
        const results = [];
        let cumulativeSubscribers = 0;
        let cumulativeFundedAccounts = 0;

        months.forEach(month => {
            // User growth (compound monthly)
            const monthlyUserGrowth = Math.pow(1 + this.assumptions.userGrowthRate / 100, month);
            const installs = this.assumptions.monthlyInstalls * monthlyUserGrowth;

            // Conversion funnel
            const kycApproved = installs * (this.assumptions.installToKYC / 100);
            const linkedBankAccounts = kycApproved * (this.assumptions.kycToLinkedBank / 100);
            const fundedAccounts = linkedBankAccounts * (this.assumptions.linkedBankToACH / 100);

            // Apply account closure rates
            const adjustedKycApproved = kycApproved * (1 - this.assumptions.accountClosureRate / 100);
            const adjustedLinkedBankAccounts = linkedBankAccounts * (1 - this.assumptions.accountClosureRate / 100);
            const adjustedFundedAccounts = fundedAccounts * (1 - this.assumptions.accountClosureRate / 100);
            cumulativeFundedAccounts += adjustedFundedAccounts;

            // Trading activity
            const tradeVolumeMultiplier = Math.pow(1 + this.assumptions.tradeVolumeGrowth / 100, month - 1);
            const rebalanceMultiplier = Math.pow(1 + this.assumptions.rebalanceGrowth / 100, month - 1);
            const portfolioCreationMultiplier = Math.pow(1 + this.assumptions.portfolioCreationGrowth / 100, month - 1);

            const trades = cumulativeFundedAccounts * this.assumptions.avgMonthlyTrades * tradeVolumeMultiplier;
            const rebalances = this.assumptions.avgMonthlyRebalances * rebalanceMultiplier;
            const portfoliosCreated = cumulativeFundedAccounts * this.assumptions.avgMonthlyPortfolioCreations * portfolioCreationMultiplier;
            const totalTradingEvents = trades + rebalances + portfoliosCreated;

            // Subscription calculations with churn
            const newSubscribers = adjustedKycApproved * (this.assumptions.subscriptionConversion / 100);
            cumulativeSubscribers = (cumulativeSubscribers * (1 - this.assumptions.subscriptionChurnRate / 100)) + newSubscribers;

            // Revenue calculations (maintenance fee model)
            const accountsPayingFees = cumulativeFundedAccounts * (1 - this.assumptions.waivedFeesPercent / 100);
            const maintenanceRevenue = accountsPayingFees * this.assumptions.maintenanceFee;
            const subscriptionRevenue = cumulativeSubscribers * this.assumptions.subscriptionPrice * (this.assumptions.dubRevenueShare / 100);
            const totalRevenue = maintenanceRevenue + subscriptionRevenue;

            // Cost calculations
            const totalTransactionValue = totalTradingEvents * this.assumptions.avgTradeValue;
            const bakktTransactionCost = totalTransactionValue * (this.assumptions.bakktTransactionFee / 100);

            // Gross profit calculation
            const grossProfit = totalRevenue - bakktTransactionCost;

            results.push({
                month,
                installs,
                kycApproved: adjustedKycApproved,
                linkedBankAccounts: adjustedLinkedBankAccounts,
                fundedAccounts: adjustedFundedAccounts,
                cumulativeFundedAccounts,
                trades,
                rebalances,
                portfoliosCreated,
                totalTradingEvents,
                totalTransactionValue,
                cumulativeSubscribers,
                maintenanceRevenue,
                subscriptionRevenue,
                totalRevenue,
                bakktTransactionCost,
                grossProfit
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
                totalRevenue: yearMonths.reduce((sum, m) => sum + m.totalRevenue, 0),
                endingCumulativeFundedAccounts: lastMonth.cumulativeFundedAccounts,
                endingSubscribers: lastMonth.cumulativeSubscribers,
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

    render() {
        const projections = this.calculateProjections();
        const yearlyProjections = this.calculateYearlyProjections(projections);

        this.container.innerHTML = `
            <div style="width: 100%; max-width: 1400px; margin: 0 auto; padding: 24px; box-sizing: border-box;">
                <div style="text-align: center; margin-bottom: 32px;">
                    <h1 style="font-size: 28px; font-weight: bold; margin: 0 0 8px 0;">Crypto Analysis</h1>
                    <p style="color: #6c757d; margin: 0;">Business model projections for cryptocurrency features</p>
                </div>

                ${this.renderAssumptions()}
                <div id="cryptoYearContainer">
                    ${this.renderYearComparison(yearlyProjections)}
                </div>
                <div id="cryptoMonthlyContainer">
                    ${this.renderMonthlyTable(projections)}
                </div>
            </div>
        `;

        this.attachEventListeners();
    }

    renderAssumptions() {
        return `
            <div style="background: white; border: 1px solid #dee2e6; border-radius: 10px; padding: 20px; margin-bottom: 24px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <h3 style="margin: 0 0 16px 0; font-size: 18px; font-weight: bold;">Assumptions</h3>
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px;">
                    <div style="display: flex; flex-direction: column; gap: 24px;">
                        ${this.renderConversionRates()}
                        ${this.renderOtherAssumptions()}
                    </div>
                    ${this.renderUserBehavior()}
                    ${this.renderRevenueModel()}
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

    renderRevenueModel() {
        return `
            <div style="background: #e7f3ff; padding: 16px; border-radius: 8px;">
                <h4 style="font-size: 12px; font-weight: bold; color: #0056b3; text-transform: uppercase; margin: 0 0 12px 0;">Revenue & Cost Model</h4>
                <div style="display: flex; flex-direction: column; gap: 12px;">
                    ${this.renderInput('Maintenance Fee ($/mo per funded acct)', 'maintenanceFee')}
                    ${this.renderInput('Waived Fees (% of funded acct)', 'waivedFeesPercent')}
                    ${this.renderInput('Subscription Price ($/mo)', 'subscriptionPrice')}
                    ${this.renderInput('Dub Revenue Share (%)', 'dubRevenueShare')}
                    ${this.renderInput('Subscription Conversion (% of KYC)', 'subscriptionConversion')}
                    ${this.renderInput('Subscription Churn (% monthly)', 'subscriptionChurnRate')}
                    ${this.renderInput('Account Closure Rate (% monthly)', 'accountClosureRate')}
                    ${this.renderInput('Avg Trade Value ($)', 'avgTradeValue')}
                    ${this.renderInput('Bakkt Transaction Fee (%)', 'bakktTransactionFee')}
                </div>
            </div>
        `;
    }

    renderInput(label, key) {
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
            </div>
        `;
    }

    renderYearComparison(yearlyProjections) {
        const year1 = yearlyProjections[0];
        const year2 = yearlyProjections[1];
        const year3 = yearlyProjections[2];

        return `
            <div style="background: white; border: 1px solid #dee2e6; border-radius: 10px; padding: 20px; margin-bottom: 24px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <h3 style="margin: 0 0 24px 0; font-size: 18px; font-weight: bold;">3-Year Revenue Projection</h3>

                <div style="display: grid; grid-template-columns: 180px repeat(3, 1fr); gap: 12px; align-items: start;">
                    <!-- Header Row -->
                    <div></div>
                    <div style="text-align: center; font-weight: 600; font-size: 14px; color: #495057; padding: 8px;">Year 1</div>
                    <div style="text-align: center; font-weight: 600; font-size: 14px; color: #495057; padding: 8px;">Year 2</div>
                    <div style="text-align: center; font-weight: 600; font-size: 14px; color: #495057; padding: 8px;">Year 3</div>

                    <!-- Total Revenue Row -->
                    <div style="display: flex; align-items: center; padding: 16px; background: #e7f3ff; border-radius: 6px; font-weight: 600; font-size: 12px; color: #0d47a1;">
                        Total Revenue
                    </div>
                    <div style="padding: 16px; background: #e7f3ff; border-radius: 6px; border: 1px solid #90caf9; text-align: center;">
                        <div style="font-size: 20px; font-weight: bold; color: #0d47a1;">${this.formatCurrency(year1.totalRevenue)}</div>
                    </div>
                    <div style="padding: 16px; background: #e7f3ff; border-radius: 6px; border: 1px solid #90caf9; text-align: center;">
                        <div style="font-size: 20px; font-weight: bold; color: #0d47a1;">${this.formatCurrency(year2.totalRevenue)}</div>
                    </div>
                    <div style="padding: 16px; background: #e7f3ff; border-radius: 6px; border: 1px solid #90caf9; text-align: center;">
                        <div style="font-size: 20px; font-weight: bold; color: #0d47a1;">${this.formatCurrency(year3.totalRevenue)}</div>
                    </div>
                </div>
            </div>
        `;
    }

    renderMonthlyTable(projections) {
        return `
            <div style="background: white; border: 1px solid #dee2e6; border-radius: 10px; padding: 20px; margin-bottom: 24px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <h3 style="margin: 0 0 16px 0; font-size: 18px; font-weight: bold;">Monthly Projections</h3>
                <div style="overflow-x: auto;">
                    <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
                        <thead>
                            <tr style="border-bottom: 2px solid #dee2e6;">
                                <th style="text-align: left; padding: 8px; font-weight: bold; position: sticky; left: 0; background: white; z-index: 1; min-width: 200px; white-space: nowrap;">Metric</th>
                                ${projections.map(p => `<th style="text-align: right; padding: 8px; font-weight: bold; ${p.month % 12 === 0 ? 'background: #f8f9fa;' : ''}">M${p.month}</th>`).join('')}
                            </tr>
                        </thead>
                        <tbody>
                            ${this.renderMetricRow('Installs', 'installs', projections)}
                            ${this.renderMetricRow('KYC Approved', 'kycApproved', projections)}
                            ${this.renderMetricRow('Linked Bank Accounts', 'linkedBankAccounts', projections)}
                            ${this.renderMetricRow('New Funded Accounts', 'fundedAccounts', projections)}
                            ${this.renderMetricRow('Cumulative Funded Accounts', 'cumulativeFundedAccounts', projections)}
                            ${this.renderMetricRow('Total Trades', 'trades', projections)}
                            ${this.renderMetricRow('Total Rebalances', 'rebalances', projections)}
                            ${this.renderMetricRow('Total Portfolios Created', 'portfoliosCreated', projections)}
                            ${this.renderMetricRow('Total Trading Events', 'totalTradingEvents', projections)}
                            ${this.renderMetricRow('Total Transaction Value', 'totalTransactionValue', projections, false, null, true)}
                            ${this.renderSeparatorRow(projections)}
                            ${this.renderMetricRow('Maintenance Revenue', 'maintenanceRevenue', projections, false, null, true)}
                            ${this.renderMetricRow('Subscription Revenue', 'subscriptionRevenue', projections, false, null, true)}
                            ${this.renderMetricRow('Total Revenue', 'totalRevenue', projections, false, null, true, true)}
                            ${this.renderSeparatorRow(projections)}
                            ${this.renderMetricRow('Bakkt Transaction Cost', 'bakktTransactionCost', projections, false, null, true)}
                            ${this.renderSeparatorRow(projections)}
                            ${this.renderMetricRow('Gross Profit', 'grossProfit', projections, false, '#d4edda', true, true)}
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

    renderMetricRow(label, key, projections, isHeader = false, bgColor = null, isCurrency = false, isBold = false) {
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

    attachEventListeners() {
        const inputs = this.container.querySelectorAll('input[data-key]');
        inputs.forEach(input => {
            input.addEventListener('input', (e) => {
                const key = e.target.getAttribute('data-key');
                this.updateAssumption(key, e.target.value);
            });
        });
    }
}

// Initialize on page load
if (typeof window !== 'undefined') {
    window.CryptoAnalysis = CryptoAnalysis;
}
