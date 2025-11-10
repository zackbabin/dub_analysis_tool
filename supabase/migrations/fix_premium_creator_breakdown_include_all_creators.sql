-- Fix premium_creator_breakdown to include ALL premium creators
-- Changes INNER JOINs to LEFT JOINs in CTEs to prevent filtering out creators without data
-- Then recreates dependent views

-- =============================================================================
-- Step 1: Drop and recreate premium_creator_breakdown with LEFT JOINs
-- =============================================================================

DROP MATERIALIZED VIEW IF EXISTS premium_creator_breakdown CASCADE;

CREATE MATERIALIZED VIEW premium_creator_breakdown AS
WITH engagement_by_username AS (
    -- Aggregate engagement metrics at username level
    -- Sum across all creator_ids with same username
    -- Use LEFT JOIN to include all premium creators even without engagement data
    SELECT
        pc.creator_username,
        SUM(pcem.total_copies) AS total_copies,
        SUM(pcem.total_pdp_views) AS total_pdp_views,
        SUM(pcem.total_liquidations) AS total_liquidations
    FROM premium_creators pc
    LEFT JOIN portfolio_creator_engagement_metrics pcem ON pc.creator_id = pcem.creator_id
    GROUP BY pc.creator_username
),
subscription_by_username AS (
    -- Aggregate subscription metrics at username level
    -- Sum across all creator_ids with same username
    -- Use LEFT JOIN to include all premium creators even without subscription data
    SELECT
        pc.creator_username,
        SUM(pcm.total_subscriptions) AS total_subscriptions,
        SUM(pcm.total_paywall_views) AS total_paywall_views,
        SUM(pcm.total_cancellations) AS total_cancellations
    FROM premium_creators pc
    LEFT JOIN premium_creator_metrics pcm ON pc.creator_id = pcm.creator_id
    GROUP BY pc.creator_username
),
performance_by_username AS (
    -- Get unique portfolio performance metrics per username
    -- A portfolio should only be counted once per username, even if multiple creator_ids share that username
    -- Use LEFT JOINs to include all premium creators even without performance data
    SELECT
        pc.creator_username,
        ppm.portfolio_ticker,
        ppm.total_returns_percentage,
        ppm.total_position
    FROM premium_creators pc
    LEFT JOIN portfolio_creator_engagement_metrics pcem ON pc.creator_id = pcem.creator_id
    LEFT JOIN portfolio_performance_metrics ppm ON pcem.portfolio_ticker = ppm.portfolio_ticker
    GROUP BY pc.creator_username, ppm.portfolio_ticker, ppm.total_returns_percentage, ppm.total_position
)
SELECT
    pc.creator_username,
    -- Engagement metrics
    COALESCE(eng.total_copies, 0) AS total_copies,
    COALESCE(eng.total_pdp_views, 0) AS total_pdp_views,
    COALESCE(eng.total_liquidations, 0) AS total_liquidations,
    -- Calculate copy CVR and liquidation rate
    CASE
        WHEN eng.total_pdp_views > 0
        THEN (eng.total_copies::numeric / eng.total_pdp_views::numeric) * 100
        ELSE 0
    END AS copy_cvr,
    CASE
        WHEN eng.total_copies > 0
        THEN (eng.total_liquidations::numeric / eng.total_copies::numeric) * 100
        ELSE 0
    END AS liquidation_rate,
    -- Subscription metrics
    COALESCE(sub.total_subscriptions, 0) AS total_subscriptions,
    COALESCE(sub.total_paywall_views, 0) AS total_paywall_views,
    COALESCE(sub.total_cancellations, 0) AS total_cancellations,
    -- Calculate subscription CVR and cancellation rate
    CASE
        WHEN sub.total_paywall_views > 0
        THEN (sub.total_subscriptions::numeric / sub.total_paywall_views::numeric) * 100
        ELSE 0
    END AS subscription_cvr,
    CASE
        WHEN sub.total_subscriptions > 0
        THEN (sub.total_cancellations::numeric / sub.total_subscriptions::numeric) * 100
        ELSE 0
    END AS cancellation_rate,
    -- Performance metrics - aggregate from deduplicated portfolios
    AVG(perf.total_returns_percentage) AS avg_all_time_returns,
    CASE
        WHEN SUM(perf.total_position) > 0 THEN SUM(perf.total_position)
        ELSE NULL
    END AS total_copy_capital
FROM (SELECT DISTINCT creator_username FROM premium_creators) pc
LEFT JOIN engagement_by_username eng ON pc.creator_username = eng.creator_username
LEFT JOIN subscription_by_username sub ON pc.creator_username = sub.creator_username
LEFT JOIN performance_by_username perf ON pc.creator_username = perf.creator_username
GROUP BY
    pc.creator_username,
    eng.total_copies,
    eng.total_pdp_views,
    eng.total_liquidations,
    sub.total_subscriptions,
    sub.total_paywall_views,
    sub.total_cancellations;

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_premium_creator_breakdown_username ON premium_creator_breakdown(creator_username);

-- Grant permissions
GRANT SELECT ON premium_creator_breakdown TO anon, authenticated;

COMMENT ON MATERIALIZED VIEW premium_creator_breakdown IS
'Creator-level aggregated metrics for Premium Creator Breakdown. Combines engagement metrics from portfolio_creator_engagement_metrics, subscription metrics from premium_creator_metrics, and performance metrics from portfolio_breakdown_with_metrics. Uses LEFT JOINs to include ALL premium creators even without data. Refresh after syncing creator data or uploading portfolio performance metrics.';

-- =============================================================================
-- Step 2: Recreate premium_creator_summary_stats view (dropped by CASCADE)
-- =============================================================================

DROP VIEW IF EXISTS premium_creator_summary_stats;

CREATE VIEW premium_creator_summary_stats AS
SELECT
    -- Average CVRs across all premium creators
    AVG(copy_cvr) AS avg_copy_cvr,
    AVG(subscription_cvr) AS avg_subscription_cvr,
    -- Median performance metrics across all premium creators (excluding nulls)
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY avg_all_time_returns) AS median_all_time_performance,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_copy_capital) AS median_copy_capital,
    -- Include count of creators for reference
    COUNT(*) AS total_creators
FROM premium_creator_breakdown;

-- Grant permissions
GRANT SELECT ON premium_creator_summary_stats TO anon, authenticated;

COMMENT ON VIEW premium_creator_summary_stats IS
'Summary statistics aggregated across all premium creators. Used for metric cards on Premium Creator Analysis tab. Calculates averages for CVRs and medians for All-Time Returns and Copy Capital from premium_creator_breakdown materialized view.';

-- =============================================================================
-- Step 3: Refresh the materialized view to populate with current data
-- =============================================================================

REFRESH MATERIALIZED VIEW premium_creator_breakdown;
