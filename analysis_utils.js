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

// Export to window for global access
if (typeof window !== 'undefined') {
    window.calculatePredictiveStrength = calculatePredictiveStrength;
}

console.log('✅ Analysis utilities loaded successfully!');
