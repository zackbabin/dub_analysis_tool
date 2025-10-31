// Crypto Analysis Tool - Vanilla JavaScript Implementation
// Single business model calculator without sync functionality

class CryptoAnalysis {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.activeScenario = null; // 'crypto', 'cryptoNoSub', or 'cryptoPerfFee'

        // Base assumptions
        this.assumptions = {
            // Conversion rates
            monthlyInstalls: 150000.00,
            userGrowthRate: 10.00,
            submittedApplications: 52.00,
            kycApproved: 90.00,
            kycToLinkedBank: 21.98,
            linkedBankToACH: 53.58,
            subscriptionConversion: 3.00,

            // Other assumptions
            maintenanceFee: 2.00,
            portfolioLiquidationRate: 5.00,
            portfolioRebalancedPercent: 20.00,
            subscriptionPrice: 13.70,
            dubRevenueShare: 50.00,
            subscriptionConversionGrowth: 3.00,
            subscriptionsPerSubscriber: 1.00,
            subscriptionGrowthPerSubscriber: 2.00,
            subscriptionChurnRate: 25.00,
            cryptoSubscriptionsPercent: 25.00,
            accountClosureRate: 5.00,
            kycFee: 1.00,
            plaidFeePerLink: 2.00,
            bakktTransactionFee: 0.25,
            avgMonthlyReturns: 1.00,

            // Equities
            equities_avgMonthlyTrades: 1.50,
            equities_assetsPerPortfolio: 4.00,
            equities_tradeVolumeGrowth: 2.00,
            equities_avgMonthlyPortfolioCreations: 0.07,
            equities_portfolioCreationGrowth: 2.00,
            equities_avgMonthlyRebalances: 3.65,
            equities_rebalanceGrowth: 2.00,
            equities_avgTradeValue: 25.00,
            equities_pfofFee: 0.0034,
            equities_apexTransactionFee: 0.04,

            // Crypto
            crypto_avgMonthlyTrades: 0.25,
            crypto_assetsPerPortfolio: 2.00,
            crypto_tradeVolumeGrowth: 2.00,
            crypto_avgMonthlyPortfolioCreations: 0.01,
            crypto_portfolioCreationGrowth: 2.00,
            crypto_avgMonthlyRebalances: 2.00,
            crypto_rebalanceGrowth: 2.00,
            crypto_avgTradeValue: 50.00,
            crypto_bidAskSpread: 0.75,

            // Crypto - no subscriptions
            cryptoNoSub_avgMonthlyTrades: 0.40,
            cryptoNoSub_assetsPerPortfolio: 3.00,
            cryptoNoSub_tradeVolumeGrowth: 3.00,
            cryptoNoSub_avgMonthlyPortfolioCreations: 0.02,
            cryptoNoSub_portfolioCreationGrowth: 3.00,
            cryptoNoSub_avgMonthlyRebalances: 4.00,
            cryptoNoSub_rebalanceGrowth: 3.00,
            cryptoNoSub_avgTradeValue: 50.00,
            cryptoNoSub_bidAskSpread: 0.75,
            cryptoNoSub_dubRevenueShare: 50.00,

            // Crypto - performance fees
            cryptoPerfFee_avgMonthlyTrades: 0.50,
            cryptoPerfFee_assetsPerPortfolio: 3.00,
            cryptoPerfFee_tradeVolumeGrowth: 5.00,
            cryptoPerfFee_avgMonthlyPortfolioCreations: 0.04,
            cryptoPerfFee_portfolioCreationGrowth: 3.00,
            cryptoPerfFee_avgMonthlyRebalances: 5.00,
            cryptoPerfFee_rebalanceGrowth: 4.00,
            cryptoPerfFee_avgTradeValue: 75.00,
            cryptoPerfFee_bidAskSpread: 0.25,
            cryptoPerfFee_performanceFee: 20.00,
            cryptoPerfFee_dubRevenueShare: 50.00,
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
        let totalActiveSubscriptions = 0;
        let cumulativeFundedAccounts = 0;
        let cumulativeEquitiesPortfoliosCreated = 2200;
        let cumulativeCryptoPortfoliosCreated = 2200;
        let previousCumulativeEquitiesPortfoliosCreated = 2200;
        let previousCumulativeCryptoPortfoliosCreated = 2200;
        let currentSubscriptionConversion = this.assumptions.subscriptionConversion;
        let currentSubscriptionsPerSubscriber = this.assumptions.subscriptionsPerSubscriber;

        months.forEach(month => {
            // User growth (compound monthly)
            const monthlyUserGrowth = Math.pow(1 + this.assumptions.userGrowthRate / 100, month);
            const installs = this.assumptions.monthlyInstalls * monthlyUserGrowth;

            // Conversion funnel
            const submittedApps = installs * (this.assumptions.submittedApplications / 100);
            const kycApproved = submittedApps * (this.assumptions.kycApproved / 100);
            const linkedBankAccounts = kycApproved * (this.assumptions.kycToLinkedBank / 100);
            const fundedAccounts = linkedBankAccounts * (this.assumptions.linkedBankToACH / 100);

            // Apply account closure rates to new accounts and cumulative
            const adjustedKycApproved = kycApproved * (1 - this.assumptions.accountClosureRate / 100);
            const adjustedLinkedBankAccounts = linkedBankAccounts * (1 - this.assumptions.accountClosureRate / 100);
            const adjustedFundedAccounts = fundedAccounts * (1 - this.assumptions.accountClosureRate / 100);

            // Apply closure rate to existing cumulative accounts and add new adjusted accounts
            cumulativeFundedAccounts = (cumulativeFundedAccounts * (1 - this.assumptions.accountClosureRate / 100)) + adjustedFundedAccounts;

            // Equities trading activity
            const equities_tradeVolumeMultiplier = Math.pow(1 + this.assumptions.equities_tradeVolumeGrowth / 100, month - 1);
            const equities_rebalanceMultiplier = Math.pow(1 + this.assumptions.equities_rebalanceGrowth / 100, month - 1);
            const equities_portfolioCreationMultiplier = Math.pow(1 + this.assumptions.equities_portfolioCreationGrowth / 100, month - 1);

            const equities_trades = cumulativeFundedAccounts * this.assumptions.equities_avgMonthlyTrades * equities_tradeVolumeMultiplier;
            const equities_portfoliosCreated = cumulativeFundedAccounts * this.assumptions.equities_avgMonthlyPortfolioCreations * equities_portfolioCreationMultiplier;
            const equities_portfoliosLiquidated = previousCumulativeEquitiesPortfoliosCreated * (this.assumptions.portfolioLiquidationRate / 100);
            cumulativeEquitiesPortfoliosCreated += equities_portfoliosCreated - equities_portfoliosLiquidated;
            const equities_rebalances = cumulativeEquitiesPortfoliosCreated * this.assumptions.equities_avgMonthlyRebalances * (this.assumptions.equities_assetsPerPortfolio * (this.assumptions.portfolioRebalancedPercent / 100)) * equities_rebalanceMultiplier;
            const equities_totalTradingEvents = (equities_trades * this.assumptions.equities_assetsPerPortfolio) +
                                                (equities_portfoliosCreated * this.assumptions.equities_assetsPerPortfolio) +
                                                equities_rebalances;
            const equities_totalTransactionValue = equities_totalTradingEvents * this.assumptions.equities_avgTradeValue;

            // Crypto trading activity - use appropriate assumptions based on active scenario
            const cryptoPrefix = this.activeScenario || 'crypto';
            const crypto_tradeVolumeMultiplier = Math.pow(1 + this.assumptions[`${cryptoPrefix}_tradeVolumeGrowth`] / 100, month - 1);
            const crypto_rebalanceMultiplier = Math.pow(1 + this.assumptions[`${cryptoPrefix}_rebalanceGrowth`] / 100, month - 1);
            const crypto_portfolioCreationMultiplier = Math.pow(1 + this.assumptions[`${cryptoPrefix}_portfolioCreationGrowth`] / 100, month - 1);

            const crypto_trades = cumulativeFundedAccounts * this.assumptions[`${cryptoPrefix}_avgMonthlyTrades`] * crypto_tradeVolumeMultiplier;
            const crypto_portfoliosCreated = cumulativeFundedAccounts * this.assumptions[`${cryptoPrefix}_avgMonthlyPortfolioCreations`] * crypto_portfolioCreationMultiplier;
            const crypto_portfoliosLiquidated = previousCumulativeCryptoPortfoliosCreated * (this.assumptions.portfolioLiquidationRate / 100);
            cumulativeCryptoPortfoliosCreated += crypto_portfoliosCreated - crypto_portfoliosLiquidated;
            const crypto_rebalances = cumulativeCryptoPortfoliosCreated * this.assumptions[`${cryptoPrefix}_avgMonthlyRebalances`] * (this.assumptions[`${cryptoPrefix}_assetsPerPortfolio`] * (this.assumptions.portfolioRebalancedPercent / 100)) * crypto_rebalanceMultiplier;
            const crypto_totalTradingEvents = (crypto_trades * this.assumptions[`${cryptoPrefix}_assetsPerPortfolio`]) +
                                                (crypto_portfoliosCreated * this.assumptions[`${cryptoPrefix}_assetsPerPortfolio`]) +
                                                crypto_rebalances;

            // PFOF Revenue
            const pfofRevenue = equities_totalTransactionValue * (this.assumptions.equities_pfofFee / 100);

            // Subscription calculations with churn and conversion growth
            let activeSubscribers = adjustedKycApproved * (currentSubscriptionConversion / 100);

            // Apply scenario-specific subscription modifications
            if (this.activeScenario === 'cryptoNoSub' || this.activeScenario === 'cryptoPerfFee') {
                // No Crypto Subscriptions & Performance Fees: reduce active subscribers by cryptoSubscriptionsPercent
                activeSubscribers = activeSubscribers * (1 - this.assumptions.cryptoSubscriptionsPercent / 100);
            }

            const newSubscriptions = activeSubscribers * currentSubscriptionsPerSubscriber;
            totalActiveSubscriptions = (totalActiveSubscriptions * (1 - this.assumptions.subscriptionChurnRate / 100)) + newSubscriptions;
            const subscriptionRevenue = totalActiveSubscriptions * this.assumptions.subscriptionPrice * (this.assumptions.dubRevenueShare / 100);

            // Maintenance revenue - (Cumulative Funded Accounts - Active Subscribers) * Maintenance Fee
            const accountsPayingFees = cumulativeFundedAccounts - totalActiveSubscriptions;
            const maintenanceRevenue = accountsPayingFees * this.assumptions.maintenanceFee;

            // Increase subscription conversion rate and subscriptions per subscriber for next month
            currentSubscriptionConversion = currentSubscriptionConversion * (1 + this.assumptions.subscriptionConversionGrowth / 100);
            currentSubscriptionsPerSubscriber = currentSubscriptionsPerSubscriber * (1 + this.assumptions.subscriptionGrowthPerSubscriber / 100);

            // Crypto revenue and costs - use appropriate assumptions based on toggle
            const crypto_totalTransactionValue = crypto_totalTradingEvents * this.assumptions[`${cryptoPrefix}_avgTradeValue`];
            let cryptoRevenue = crypto_totalTransactionValue * (this.assumptions[`${cryptoPrefix}_bidAskSpread`] / 100);

            // Apply scenario-specific revenue modifications
            if (this.activeScenario === 'cryptoNoSub') {
                // No Crypto Subscriptions: apply Dub Revenue Share
                cryptoRevenue = cryptoRevenue * (this.assumptions.cryptoNoSub_dubRevenueShare / 100);
            } else if (this.activeScenario === 'cryptoPerfFee') {
                // Performance Fees: Bid-Ask Spread + Performance Fee on Returns
                const bidAskRevenue = crypto_totalTransactionValue * (this.assumptions.cryptoPerfFee_bidAskSpread / 100);
                const performanceFeeRevenue = crypto_totalTransactionValue * (this.assumptions.avgMonthlyReturns / 100) * (this.assumptions.cryptoPerfFee_performanceFee / 100) * (this.assumptions.cryptoPerfFee_dubRevenueShare / 100);
                cryptoRevenue = bidAskRevenue + performanceFeeRevenue;
            }

            const crypto_bakktTransactionCost = crypto_totalTransactionValue * (this.assumptions.bakktTransactionFee / 100);

            const totalRevenue = pfofRevenue + maintenanceRevenue + subscriptionRevenue + cryptoRevenue;

            // Cost calculations
            const plaidLinkFees = adjustedLinkedBankAccounts * this.assumptions.plaidFeePerLink;
            const kycCost = submittedApps * this.assumptions.kycFee;
            const equities_apexTransactionCost = month <= 6 ? equities_totalTradingEvents * this.assumptions.equities_apexTransactionFee : 0;
            const totalCosts = plaidLinkFees + kycCost + equities_apexTransactionCost + crypto_bakktTransactionCost;

            // Gross profit calculation
            const grossProfit = totalRevenue - totalCosts;
            const grossMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

            results.push({
                month,
                installs,
                plaidLinkFees,
                kycCost,
                kycApproved: adjustedKycApproved,
                linkedBankAccounts: adjustedLinkedBankAccounts,
                fundedAccounts: adjustedFundedAccounts,
                cumulativeFundedAccounts,
                pfofRevenue,
                maintenanceRevenue,
                equities_trades,
                equities_rebalances,
                equities_portfoliosCreated,
                cumulativeEquitiesPortfoliosCreated,
                equities_portfoliosLiquidated,
                equities_totalTradingEvents,
                equities_totalTransactionValue,
                equities_apexTransactionCost,
                crypto_trades,
                crypto_rebalances,
                crypto_portfoliosCreated,
                cumulativeCryptoPortfoliosCreated,
                crypto_portfoliosLiquidated,
                crypto_totalTradingEvents,
                crypto_totalTransactionValue,
                cryptoRevenue,
                crypto_bakktTransactionCost,
                activeSubscribers,
                subscriptionsPerSubscriber: currentSubscriptionsPerSubscriber,
                subscriptionConversionRate: currentSubscriptionConversion,
                totalActiveSubscriptions,
                subscriptionRevenue,
                totalCosts,
                totalRevenue,
                grossProfit,
                grossMargin
            });

            // Update previous cumulative portfolios created for next month
            previousCumulativeEquitiesPortfoliosCreated = cumulativeEquitiesPortfoliosCreated;
            previousCumulativeCryptoPortfoliosCreated = cumulativeCryptoPortfoliosCreated;
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

            const totalRevenue = yearMonths.reduce((sum, m) => sum + m.totalRevenue, 0);
            const totalCosts = yearMonths.reduce((sum, m) => sum + m.totalCosts, 0);
            const grossProfit = totalRevenue - totalCosts;
            const grossMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

            // Revenue breakdown by source
            const pfofRevenue = yearMonths.reduce((sum, m) => sum + m.pfofRevenue, 0);
            const maintenanceRevenue = yearMonths.reduce((sum, m) => sum + m.maintenanceRevenue, 0);
            const cryptoRevenue = yearMonths.reduce((sum, m) => sum + m.cryptoRevenue, 0);
            const subscriptionRevenue = yearMonths.reduce((sum, m) => sum + m.subscriptionRevenue, 0);

            return {
                year,
                totalRevenue,
                pfofRevenue,
                maintenanceRevenue,
                cryptoRevenue,
                subscriptionRevenue,
                pfofPercent: totalRevenue > 0 ? (pfofRevenue / totalRevenue) * 100 : 0,
                maintenancePercent: totalRevenue > 0 ? (maintenanceRevenue / totalRevenue) * 100 : 0,
                cryptoPercent: totalRevenue > 0 ? (cryptoRevenue / totalRevenue) * 100 : 0,
                subscriptionPercent: totalRevenue > 0 ? (subscriptionRevenue / totalRevenue) * 100 : 0,
                totalCosts,
                grossProfit,
                grossMargin,
                endingCumulativeFundedAccounts: lastMonth.cumulativeFundedAccounts,
                endingSubscribers: lastMonth.totalActiveSubscriptions,
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

    formatCost(value) {
        const formatted = new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }).format(Math.abs(value));
        return `(${formatted})`;
    }

    formatParentheses(value) {
        const formatted = new Intl.NumberFormat('en-US', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }).format(Math.abs(value));
        return `(${formatted})`;
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
            <div style="width: 100%; max-width: 2200px; margin: 0 auto; padding: 24px; box-sizing: border-box;">
                <div style="text-align: center; margin-bottom: 32px;">
                    <h1 style="font-size: 28px; font-weight: bold; margin: 0 0 8px 0;">Crypto Business Analysis</h1>
                    <p style="color: #6c757d; margin: 0;">Financial projections and business model assumptions</p>
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
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                    <h3 style="margin: 0; font-size: 18px; font-weight: bold;">Assumptions</h3>
                </div>
                <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 24px;">
                    <div style="display: flex; flex-direction: column; gap: 24px;">
                        ${this.renderConversionRates()}
                        ${this.renderOtherAssumptions()}
                        ${this.renderSubscriptionAssumptions()}
                    </div>
                    ${this.renderEquitiesAssumptions()}
                    ${this.renderCryptoAssumptions()}
                    ${this.renderCryptoNoSubscriptionsAssumptions()}
                    ${this.renderCryptoPerformanceFeesAssumptions()}
                </div>
            </div>
        `;
    }

    renderConversionRates() {
        return `
            <div>
                <h4 style="font-size: 12px; font-weight: bold; color: #495057; text-transform: uppercase; margin: 0 0 12px 0;">Conversion Rates</h4>
                <div style="display: flex; flex-direction: column; gap: 12px;">
                    ${this.renderInput('Monthly Installs', 'monthlyInstalls')}
                    ${this.renderInput('User Growth (% monthly)', 'userGrowthRate')}
                    ${this.renderInput('Submitted Applications (%)', 'submittedApplications')}
                    ${this.renderInput('KYC Approved (%)', 'kycApproved')}
                    ${this.renderInput('KYC → Linked Bank (%)', 'kycToLinkedBank')}
                    ${this.renderInput('Linked Bank → ACH (%)', 'linkedBankToACH')}
                    ${this.renderInput('Subscription CVR (% of KYC)', 'subscriptionConversion')}
                </div>
            </div>
        `;
    }

    renderOtherAssumptions() {
        return `
            <div>
                <h4 style="font-size: 12px; font-weight: bold; color: #495057; text-transform: uppercase; margin: 0 0 12px 0;">Other Assumptions</h4>
                <div style="display: flex; flex-direction: column; gap: 12px;">
                    ${this.renderInput('Maintenance Fee ($/mo per funded acct)', 'maintenanceFee')}
                    ${this.renderInput('Portfolio Liquidation Rate (% monthly)', 'portfolioLiquidationRate')}
                    ${this.renderInput('% Portfolio Rebalanced', 'portfolioRebalancedPercent')}
                    ${this.renderInput('Account Closure Rate (% monthly)', 'accountClosureRate')}
                    ${this.renderInput('KYC/Alloy Fee ($)', 'kycFee')}
                    ${this.renderInput('Plaid Fees ($ per link)', 'plaidFeePerLink')}
                    ${this.renderInput('Bakkt Transaction Fee (%)', 'bakktTransactionFee')}
                    ${this.renderInput('Avg Monthly Returns (%)', 'avgMonthlyReturns')}
                </div>
            </div>
        `;
    }

    renderSubscriptionAssumptions() {
        return `
            <div style="background: #f3e5f5; padding: 16px; border-radius: 8px;">
                <h4 style="font-size: 12px; font-weight: bold; color: #6a1b9a; text-transform: uppercase; margin: 0 0 12px 0;">Subscriptions</h4>
                <div style="display: flex; flex-direction: column; gap: 12px;">
                    ${this.renderInput('Subscriber MRR ($/mo)', 'subscriptionPrice')}
                    ${this.renderInput('Dub Revenue Share (%)', 'dubRevenueShare')}
                    ${this.renderInput('Subscription CVR Growth (% monthly)', 'subscriptionConversionGrowth')}
                    ${this.renderInput('Subscriptions Per Subscriber', 'subscriptionsPerSubscriber')}
                    ${this.renderInput('Growth Per Subscriber (% monthly)', 'subscriptionGrowthPerSubscriber')}
                    ${this.renderInput('Subscription Churn (% monthly)', 'subscriptionChurnRate')}
                    ${this.renderInput('Crypto Subscriptions (% total)', 'cryptoSubscriptionsPercent')}
                </div>
            </div>
        `;
    }

    renderEquitiesAssumptions() {
        return `
            <div style="background: #f0f8ff; padding: 16px; border-radius: 8px;">
                <h4 style="font-size: 12px; font-weight: bold; color: #0056b3; text-transform: uppercase; margin: 0 0 12px 0;">Equities</h4>
                <div style="display: flex; flex-direction: column; gap: 12px;">
                    ${this.renderInput('Monthly Portfolio Copies', 'equities_avgMonthlyTrades')}
                    ${this.renderInput('Assets Per Portfolio', 'equities_assetsPerPortfolio')}
                    ${this.renderInput('Portfolio Volume Growth (% monthly)', 'equities_tradeVolumeGrowth')}
                    ${this.renderInput('Monthly Portfolio Creations', 'equities_avgMonthlyPortfolioCreations')}
                    ${this.renderInput('Portfolio Creation Growth (% monthly)', 'equities_portfolioCreationGrowth')}
                    ${this.renderInput('Monthly Rebalances', 'equities_avgMonthlyRebalances')}
                    ${this.renderInput('Rebalance Growth (% monthly)', 'equities_rebalanceGrowth')}
                    ${this.renderInput('Avg Trade Value ($ per asset)', 'equities_avgTradeValue')}
                    ${this.renderInputFourDecimals('PFOF Fee (%)', 'equities_pfofFee')}
                    ${this.renderInput('Apex Transaction Fee ($)', 'equities_apexTransactionFee')}
                </div>
            </div>
        `;
    }

    renderCryptoAssumptions() {
        return `
            <div style="background: #fff3e0; padding: 16px; border-radius: 8px; position: relative;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                    <h4 style="font-size: 12px; font-weight: bold; color: #e65100; text-transform: uppercase; margin: 0;">Crypto</h4>
                    <input
                        type="checkbox"
                        id="cryptoToggle"
                        ${this.activeScenario === 'crypto' ? 'checked' : ''}
                        style="width: 18px; height: 18px; cursor: pointer;"
                    />
                </div>
                <div style="display: flex; flex-direction: column; gap: 12px;">
                    ${this.renderInput('Monthly Portfolio Copies', 'crypto_avgMonthlyTrades')}
                    ${this.renderInput('Assets Per Portfolio', 'crypto_assetsPerPortfolio')}
                    ${this.renderInput('Trade Volume Growth (% monthly)', 'crypto_tradeVolumeGrowth')}
                    ${this.renderInput('Monthly Portfolio Creations', 'crypto_avgMonthlyPortfolioCreations')}
                    ${this.renderInput('Portfolio Creation Growth (% monthly)', 'crypto_portfolioCreationGrowth')}
                    ${this.renderInput('Monthly Rebalances', 'crypto_avgMonthlyRebalances')}
                    ${this.renderInput('Rebalance Growth (% monthly)', 'crypto_rebalanceGrowth')}
                    ${this.renderInput('Avg Trade Value ($ per asset)', 'crypto_avgTradeValue')}
                    ${this.renderInput('Bid-Ask Spread (%)', 'crypto_bidAskSpread')}
                </div>
            </div>
        `;
    }

    renderCryptoNoSubscriptionsAssumptions() {
        return `
            <div style="background: #fff3e0; padding: 16px; border-radius: 8px; position: relative;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                    <h4 style="font-size: 12px; font-weight: bold; color: #e65100; text-transform: uppercase; margin: 0;">Crypto - no subscriptions</h4>
                    <input
                        type="checkbox"
                        id="cryptoNoSubToggle"
                        ${this.activeScenario === 'cryptoNoSub' ? 'checked' : ''}
                        style="width: 18px; height: 18px; cursor: pointer;"
                    />
                </div>
                <div style="display: flex; flex-direction: column; gap: 12px;">
                    ${this.renderInput('Monthly Portfolio Copies', 'cryptoNoSub_avgMonthlyTrades')}
                    ${this.renderInput('Assets Per Portfolio', 'cryptoNoSub_assetsPerPortfolio')}
                    ${this.renderInput('Trade Volume Growth (% monthly)', 'cryptoNoSub_tradeVolumeGrowth')}
                    ${this.renderInput('Monthly Portfolio Creations', 'cryptoNoSub_avgMonthlyPortfolioCreations')}
                    ${this.renderInput('Portfolio Creation Growth (% monthly)', 'cryptoNoSub_portfolioCreationGrowth')}
                    ${this.renderInput('Monthly Rebalances', 'cryptoNoSub_avgMonthlyRebalances')}
                    ${this.renderInput('Rebalance Growth (% monthly)', 'cryptoNoSub_rebalanceGrowth')}
                    ${this.renderInput('Avg Trade Value ($ per asset)', 'cryptoNoSub_avgTradeValue')}
                    ${this.renderInput('Bid-Ask Spread (%)', 'cryptoNoSub_bidAskSpread')}
                    ${this.renderInput('Dub Revenue Share (%)', 'cryptoNoSub_dubRevenueShare')}
                </div>
            </div>
        `;
    }

    renderCryptoPerformanceFeesAssumptions() {
        return `
            <div style="background: #fff3e0; padding: 16px; border-radius: 8px; position: relative;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                    <h4 style="font-size: 12px; font-weight: bold; color: #e65100; text-transform: uppercase; margin: 0;">Crypto - performance fees</h4>
                    <input
                        type="checkbox"
                        id="cryptoPerfFeeToggle"
                        ${this.activeScenario === 'cryptoPerfFee' ? 'checked' : ''}
                        style="width: 18px; height: 18px; cursor: pointer;"
                    />
                </div>
                <div style="display: flex; flex-direction: column; gap: 12px;">
                    ${this.renderInput('Monthly Portfolio Copies', 'cryptoPerfFee_avgMonthlyTrades')}
                    ${this.renderInput('Assets Per Portfolio', 'cryptoPerfFee_assetsPerPortfolio')}
                    ${this.renderInput('Trade Volume Growth (% monthly)', 'cryptoPerfFee_tradeVolumeGrowth')}
                    ${this.renderInput('Monthly Portfolio Creations', 'cryptoPerfFee_avgMonthlyPortfolioCreations')}
                    ${this.renderInput('Portfolio Creation Growth (% monthly)', 'cryptoPerfFee_portfolioCreationGrowth')}
                    ${this.renderInput('Monthly Rebalances', 'cryptoPerfFee_avgMonthlyRebalances')}
                    ${this.renderInput('Rebalance Growth (% monthly)', 'cryptoPerfFee_rebalanceGrowth')}
                    ${this.renderInput('Avg Trade Value ($ per asset)', 'cryptoPerfFee_avgTradeValue')}
                    ${this.renderInput('Bid-Ask Spread (%)', 'cryptoPerfFee_bidAskSpread')}
                    ${this.renderInput('Performance Fee (%)', 'cryptoPerfFee_performanceFee')}
                    ${this.renderInput('Dub Revenue Share (%)', 'cryptoPerfFee_dubRevenueShare')}
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

    renderInputFourDecimals(label, key) {
        return `
            <div>
                <label style="display: block; font-size: 11px; color: #6c757d; margin-bottom: 4px;">${label}</label>
                <input
                    type="number"
                    step="0.0001"
                    value="${this.assumptions[key].toFixed(4)}"
                    data-key="${key}"
                    style="width: 100%; padding: 8px; border: 1px solid #ced4da; border-radius: 4px; font-size: 13px; box-sizing: border-box;"
                    onblur="this.value = parseFloat(this.value).toFixed(4)"
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
                <h3 style="margin: 0 0 24px 0; font-size: 18px; font-weight: bold;">3-Year Financial Projection</h3>

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
                        <div style="font-size: 11px; color: #495057; margin-top: 8px; line-height: 1.4;">
                            PFOF: ${year1.pfofPercent.toFixed(1)}%<br>
                            Maintenance: ${year1.maintenancePercent.toFixed(1)}%<br>
                            Crypto: ${year1.cryptoPercent.toFixed(1)}%<br>
                            Subscription: ${year1.subscriptionPercent.toFixed(1)}%
                        </div>
                    </div>
                    <div style="padding: 16px; background: #e7f3ff; border-radius: 6px; border: 1px solid #90caf9; text-align: center;">
                        <div style="font-size: 20px; font-weight: bold; color: #0d47a1;">${this.formatCurrency(year2.totalRevenue)}</div>
                        <div style="font-size: 11px; color: #495057; margin-top: 8px; line-height: 1.4;">
                            PFOF: ${year2.pfofPercent.toFixed(1)}%<br>
                            Maintenance: ${year2.maintenancePercent.toFixed(1)}%<br>
                            Crypto: ${year2.cryptoPercent.toFixed(1)}%<br>
                            Subscription: ${year2.subscriptionPercent.toFixed(1)}%
                        </div>
                    </div>
                    <div style="padding: 16px; background: #e7f3ff; border-radius: 6px; border: 1px solid #90caf9; text-align: center;">
                        <div style="font-size: 20px; font-weight: bold; color: #0d47a1;">${this.formatCurrency(year3.totalRevenue)}</div>
                        <div style="font-size: 11px; color: #495057; margin-top: 8px; line-height: 1.4;">
                            PFOF: ${year3.pfofPercent.toFixed(1)}%<br>
                            Maintenance: ${year3.maintenancePercent.toFixed(1)}%<br>
                            Crypto: ${year3.cryptoPercent.toFixed(1)}%<br>
                            Subscription: ${year3.subscriptionPercent.toFixed(1)}%
                        </div>
                    </div>

                    <!-- Total Costs Row -->
                    <div style="display: flex; align-items: center; padding: 16px; background: #ffe6e6; border-radius: 6px; font-weight: 600; font-size: 12px; color: #b71c1c;">
                        Total Costs
                    </div>
                    <div style="padding: 16px; background: #ffe6e6; border-radius: 6px; border: 1px solid #ef9a9a; text-align: center;">
                        <div style="font-size: 20px; font-weight: bold; color: #b71c1c;">${this.formatCost(year1.totalCosts)}</div>
                    </div>
                    <div style="padding: 16px; background: #ffe6e6; border-radius: 6px; border: 1px solid #ef9a9a; text-align: center;">
                        <div style="font-size: 20px; font-weight: bold; color: #b71c1c;">${this.formatCost(year2.totalCosts)}</div>
                    </div>
                    <div style="padding: 16px; background: #ffe6e6; border-radius: 6px; border: 1px solid #ef9a9a; text-align: center;">
                        <div style="font-size: 20px; font-weight: bold; color: #b71c1c;">${this.formatCost(year3.totalCosts)}</div>
                    </div>

                    <!-- Gross Profit Row -->
                    <div style="display: flex; align-items: center; padding: 16px; background: #d4edda; border-radius: 6px; font-weight: 600; font-size: 12px; color: #1b5e20;">
                        Gross Profit
                    </div>
                    <div style="padding: 16px; background: #d4edda; border-radius: 6px; border: 1px solid #81c784; text-align: center;">
                        <div style="font-size: 20px; font-weight: bold; color: #1b5e20;">${this.formatCurrency(year1.grossProfit)}</div>
                    </div>
                    <div style="padding: 16px; background: #d4edda; border-radius: 6px; border: 1px solid #81c784; text-align: center;">
                        <div style="font-size: 20px; font-weight: bold; color: #1b5e20;">${this.formatCurrency(year2.grossProfit)}</div>
                    </div>
                    <div style="padding: 16px; background: #d4edda; border-radius: 6px; border: 1px solid #81c784; text-align: center;">
                        <div style="font-size: 20px; font-weight: bold; color: #1b5e20;">${this.formatCurrency(year3.grossProfit)}</div>
                    </div>

                    <!-- Gross Margin Row -->
                    <div style="display: flex; align-items: center; padding: 16px; background: #d4edda; border-radius: 6px; font-weight: 600; font-size: 12px; color: #1b5e20;">
                        Gross Margin (%)
                    </div>
                    <div style="padding: 16px; background: #d4edda; border-radius: 6px; border: 1px solid #81c784; text-align: center;">
                        <div style="font-size: 20px; font-weight: bold; color: #1b5e20;">${year1.grossMargin.toFixed(1)}%</div>
                    </div>
                    <div style="padding: 16px; background: #d4edda; border-radius: 6px; border: 1px solid #81c784; text-align: center;">
                        <div style="font-size: 20px; font-weight: bold; color: #1b5e20;">${year2.grossMargin.toFixed(1)}%</div>
                    </div>
                    <div style="padding: 16px; background: #d4edda; border-radius: 6px; border: 1px solid #81c784; text-align: center;">
                        <div style="font-size: 20px; font-weight: bold; color: #1b5e20;">${year3.grossMargin.toFixed(1)}%</div>
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
                            ${this.renderMetricRow('New Installs', 'installs', projections)}
                            ${this.renderMetricRow('New KYC Approved', 'kycApproved', projections)}
                            ${this.renderMetricRow('New Linked Bank Accounts', 'linkedBankAccounts', projections)}
                            ${this.renderMetricRow('New Funded Accounts', 'fundedAccounts', projections)}
                            ${this.renderMetricRow('Cumulative Funded Accounts', 'cumulativeFundedAccounts', projections)}
                            ${this.renderSeparatorRow(projections)}
                            ${this.renderMetricRow('EQUITIES', null, projections, true, '#f8f9fa')}
                            ${this.renderMetricRow('Total Portfolios Copied', 'equities_trades', projections)}
                            ${this.renderMetricRow('New Portfolios Created', 'equities_portfoliosCreated', projections)}
                            ${this.renderMetricRow('Portfolios Liquidated', 'equities_portfoliosLiquidated', projections)}
                            ${this.renderMetricRow('Cumulative Portfolios Created', 'cumulativeEquitiesPortfoliosCreated', projections)}
                            ${this.renderMetricRow('Total Rebalances (Assets)', 'equities_rebalances', projections)}
                            ${this.renderMetricRow('Total Executed Orders (Assets)', 'equities_totalTradingEvents', projections)}
                            ${this.renderMetricRow('Total Transaction Value', 'equities_totalTransactionValue', projections, false, null, true)}
                            ${this.renderSeparatorRow(projections)}
                            ${this.renderMetricRow('CRYPTO', null, projections, true, '#f8f9fa')}
                            ${this.renderMetricRow('Total Portfolios Copied', 'crypto_trades', projections)}
                            ${this.renderMetricRow('New Portfolios Created', 'crypto_portfoliosCreated', projections)}
                            ${this.renderMetricRow('Portfolios Liquidated', 'crypto_portfoliosLiquidated', projections)}
                            ${this.renderMetricRow('Cumulative Portfolios Created', 'cumulativeCryptoPortfoliosCreated', projections)}
                            ${this.renderMetricRow('Total Rebalances (Assets)', 'crypto_rebalances', projections)}
                            ${this.renderMetricRow('Total Executed Orders (Assets)', 'crypto_totalTradingEvents', projections)}
                            ${this.renderMetricRow('Total Transaction Value', 'crypto_totalTransactionValue', projections, false, null, true)}
                            ${this.renderSeparatorRow(projections)}
                            ${this.renderMetricRow('SUBSCRIPTIONS', null, projections, true, '#f8f9fa')}
                            ${this.renderMetricRow('Subscription CVR (%)', 'subscriptionConversionRate', projections, false, null, false, false, false, true)}
                            ${this.renderMetricRow('Active Subscribers', 'activeSubscribers', projections)}
                            ${this.renderMetricRow('Subscriptions Per Subscriber', 'subscriptionsPerSubscriber', projections, false, null, false, false, false, false, true)}
                            ${this.renderMetricRow('Total Active Subscriptions', 'totalActiveSubscriptions', projections)}
                            ${this.renderSeparatorRow(projections)}
                            ${this.renderMetricRow('PFOF Revenue', 'pfofRevenue', projections, false, null, true)}
                            ${this.renderMetricRow('Maintenance Revenue', 'maintenanceRevenue', projections, false, null, true)}
                            ${this.renderMetricRow('Crypto Revenue', 'cryptoRevenue', projections, false, null, true)}
                            ${this.renderMetricRow('Subscription Revenue', 'subscriptionRevenue', projections, false, null, true)}
                            ${this.renderMetricRow('Total Revenue', 'totalRevenue', projections, false, null, true, true)}
                            ${this.renderSeparatorRow(projections)}
                            ${this.renderMetricRow('Plaid Link Fees', 'plaidLinkFees', projections, false, null, false, false, true)}
                            ${this.renderMetricRow('KYC/Alloy Fees', 'kycCost', projections, false, null, false, false, true)}
                            ${this.renderMetricRow('Apex Transaction Fees', 'equities_apexTransactionCost', projections, false, null, false, false, true)}
                            ${this.renderMetricRow('Bakkt Transaction Fees', 'crypto_bakktTransactionCost', projections, false, null, false, false, true)}
                            ${this.renderMetricRow('Total Costs', 'totalCosts', projections, false, null, false, true, true)}
                            ${this.renderSeparatorRow(projections)}
                            ${this.renderMetricRow('Gross Profit', 'grossProfit', projections, false, '#d4edda', true, true)}
                            ${this.renderMetricRow('Gross Margin (%)', 'grossMargin', projections, false, '#d4edda', false, false, false, true)}
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

    renderMetricRow(label, key, projections, isHeader = false, bgColor = null, isCurrency = false, isBold = false, isCost = false, isPercent = false, isDecimal = false) {
        if (isHeader) {
            return `
                <tr style="background: ${bgColor || '#f8f9fa'};">
                    <td style="padding: 8px; font-weight: bold; position: sticky; left: 0; background: ${bgColor || '#f8f9fa'}; z-index: 1; min-width: 200px; white-space: nowrap;">${label}</td>
                    ${projections.map(p => {
                        const bg = p.month % 12 === 0 ? (bgColor || '#f8f9fa') : (bgColor || '#f8f9fa');
                        return `<td style="text-align: right; padding: 8px; background: ${bg};"></td>`;
                    }).join('')}
                </tr>
            `;
        }

        return `
            <tr>
                <td style="padding: 8px; ${isBold ? 'font-weight: bold;' : ''} position: sticky; left: 0; background: white; z-index: 1; min-width: 200px; white-space: nowrap;">${label}</td>
                ${projections.map(p => {
                    const value = p[key];
                    let formatted;
                    if (isCost) {
                        formatted = this.formatCost(value);
                    } else if (isCurrency) {
                        formatted = this.formatCurrency(value);
                    } else if (isPercent) {
                        formatted = value.toFixed(2) + '%';
                    } else if (isDecimal) {
                        formatted = value.toFixed(2);
                    } else {
                        formatted = this.formatNumber(value);
                    }
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

        // Attach toggle listeners for the 3 crypto scenarios
        this.attachScenarioToggle('cryptoToggle', 'crypto');
        this.attachScenarioToggle('cryptoNoSubToggle', 'cryptoNoSub');
        this.attachScenarioToggle('cryptoPerfFeeToggle', 'cryptoPerfFee');
    }

    attachScenarioToggle(toggleId, scenarioKey) {
        const toggle = document.getElementById(toggleId);
        if (toggle) {
            toggle.addEventListener('change', (e) => {
                if (e.target.checked) {
                    // Turn off all other toggles and activate this scenario
                    this.activeScenario = scenarioKey;
                    this.updateAllToggles();
                    this.updateCalculations();
                } else {
                    // If unchecking the currently active scenario, deactivate it
                    if (this.activeScenario === scenarioKey) {
                        this.activeScenario = null;
                        this.updateAllToggles();
                        this.updateCalculations();
                    }
                }
            });
        }
    }

    updateAllToggles() {
        // Update all toggle states to reflect the activeScenario
        const cryptoToggle = document.getElementById('cryptoToggle');
        const cryptoNoSubToggle = document.getElementById('cryptoNoSubToggle');
        const cryptoPerfFeeToggle = document.getElementById('cryptoPerfFeeToggle');

        if (cryptoToggle) cryptoToggle.checked = (this.activeScenario === 'crypto');
        if (cryptoNoSubToggle) cryptoNoSubToggle.checked = (this.activeScenario === 'cryptoNoSub');
        if (cryptoPerfFeeToggle) cryptoPerfFeeToggle.checked = (this.activeScenario === 'cryptoPerfFee');
    }
}

// Initialize on page load
if (typeof window !== 'undefined') {
    window.CryptoAnalysis = CryptoAnalysis;
}
