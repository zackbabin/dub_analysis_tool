// Analysis Utilities - Shared functions across analysis tools
'use strict';

/**
 * Calculate predictive strength combining statistical significance and effect size
 * Uses a two-stage approach:
 * 1. Check statistical significance (T-stat >= 1.96 for 95% confidence)
 * 2. Calculate weighted score: Correlation (90%) + T-stat (10%)
 *
 * @param {number} correlation - Correlation coefficient (-1 to 1)
 * @param {number} tStat - T-statistic value
 * @returns {Object} { strength: string, className: string }
 */
function calculatePredictiveStrength(correlation, tStat) {
    const absCorr = Math.abs(correlation);
    const absTStat = Math.abs(tStat);

    // Gate 1: Check statistical significance first
    // If T-stat < 1.96, the relationship is not statistically significant at 95% confidence
    if (absTStat < 1.96) {
        return { strength: 'Very Weak', className: 'qda-strength-very-weak' };
    }

    // Gate 2: If statistically significant, calculate weighted score
    // Correlation score (0-6 scale)
    let corrScore = 0;
    if (absCorr >= 0.50) corrScore = 6;
    else if (absCorr >= 0.30) corrScore = 5;
    else if (absCorr >= 0.20) corrScore = 4;
    else if (absCorr >= 0.10) corrScore = 3;
    else if (absCorr >= 0.05) corrScore = 2;
    else if (absCorr >= 0.02) corrScore = 1;
    else corrScore = 0;  // Very tiny correlation (< 0.02) scores 0

    // T-stat score (0-6 scale) - only for values >= 1.96
    let tScore = 0;
    if (absTStat >= 3.29) tScore = 6;          // p < 0.001 (99.9% confidence)
    else if (absTStat >= 2.58) tScore = 5;     // p < 0.01 (99% confidence)
    else if (absTStat >= 1.96) tScore = 4;     // p < 0.05 (95% confidence)

    // Combined score (90% correlation, 10% T-stat)
    // Heavy weighting on correlation since large sample size makes most T-stats significant
    const combinedScore = (corrScore * 0.9) + (tScore * 0.1);

    // Map combined score to strength categories
    if (combinedScore >= 5.5) {
        return { strength: 'Very Strong', className: 'qda-strength-very-strong' };
    } else if (combinedScore >= 4.5) {
        return { strength: 'Strong', className: 'qda-strength-strong' };
    } else if (combinedScore >= 3.5) {
        return { strength: 'Moderate - Strong', className: 'qda-strength-moderate-strong' };
    } else if (combinedScore >= 2.5) {
        return { strength: 'Moderate', className: 'qda-strength-moderate' };
    } else if (combinedScore >= 1.5) {
        return { strength: 'Weak - Moderate', className: 'qda-strength-weak-moderate' };
    } else if (combinedScore >= 0.5) {
        return { strength: 'Weak', className: 'qda-strength-weak' };
    } else {
        return { strength: 'Very Weak', className: 'qda-strength-very-weak' };
    }
}

/**
 * Map database column names to display-friendly variable labels
 * Based on comprehensive Mixpanel → DB → Variable mapping
 * Excludes variables with N/A mapping (user profile fields not used in analysis)
 *
 * @param {string} columnName - Database column name from main_analysis view
 * @returns {string} Display-friendly variable label
 */
function getVariableLabel(columnName) {
    // Comprehensive mapping from DB column → Display Variable
    const VARIABLE_LABELS = {
        // Copy-related metrics
        'total_bank_links': 'Linked Bank',
        'total_copies': 'Total Copies',
        'total_regular_copies': 'Total Regular Copies',
        'total_premium_copies': 'Total Premium Copies',

        // View metrics
        'regular_pdp_views': 'Regular PDP Views',
        'premium_pdp_views': 'Premium PDP Views',
        'paywall_views': 'Paywall Views',
        'regular_creator_views': 'Regular Creator Views',
        'premium_creator_views': 'Premium Creator Views',

        // Subscription metrics
        'total_subscriptions': 'Total Subscriptions',

        // Engagement metrics
        'app_sessions': 'App Sessions',
        'discover_tab_views': 'Discover Tab Views',
        'leaderboard_tab_views': 'Leaderboard Tab Views',
        'premium_tab_views': 'Premium Tab Views',
        'stripe_modal_views': 'Stripe Modal Views',
        'creator_card_taps': 'Creator Card Taps',
        'portfolio_card_taps': 'Portfolio Card Taps',

        // Deposit & financial metrics
        'total_ach_deposits': 'Total ACH Deposits',

        // Aggregated unique views
        'unique_creators_viewed': 'Unique Creator Views',
        'unique_portfolios_viewed': 'Unique Portfolio Views',

        // User properties (used in analysis)
        'available_copy_credits': 'Available Copy Credits',
        'buying_power': 'Buying Power',
        'active_created_portfolios': 'Active Created Portfolios',
        'lifetime_created_portfolios': 'Lifetime Created Portfolios',
        'active_copied_portfolios': 'Active Copied Portfolios',
        'lifetime_copied_portfolios': 'Lifetime Copied Portfolios',
        'total_deposits': 'Total Deposits',

        // Note: The following fields are excluded (N/A in mapping):
        // - income, net_worth, investing_activity, investing_experience_years
        // - investing_objective, acquisition_survey
        // These are not used in behavioral driver analysis
    };

    return VARIABLE_LABELS[columnName] || columnName;
}

/**
 * Check if a variable should be excluded from analysis
 * Variables with N/A mapping are profile fields not used in behavioral analysis
 *
 * @param {string} columnName - Database column name
 * @returns {boolean} true if variable should be excluded from analysis
 */
function shouldExcludeVariable(columnName) {
    const EXCLUDED_VARIABLES = [
        'income',
        'net_worth',
        'investing_activity',
        'investing_experience_years',
        'investing_objective',
        'acquisition_survey',
        'investment_type'
    ];

    return EXCLUDED_VARIABLES.includes(columnName);
}

// Export to window for global access
if (typeof window !== 'undefined') {
    window.calculatePredictiveStrength = calculatePredictiveStrength;
    window.getVariableLabel = getVariableLabel;
    window.shouldExcludeVariable = shouldExcludeVariable;
}

console.log('✅ Analysis utilities loaded successfully!');
