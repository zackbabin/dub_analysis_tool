-- Fix premium_creator_breakdown to ensure all premium creators are included
-- Issue: GROUP BY includes aggregated columns from CTEs which is redundant
-- Solution: Simplify GROUP BY to only include creator_username

DROP MATERIALIZED VIEW IF EXISTS premium_creator_breakdown CASCADE;

CREATE MATERIALIZED VIEW premium_creator_breakdown AS
WITH engagement_by_username AS (
    SELECT
        pc.creator_username,
        SUM(pcem.total_copies) AS total_copies,
        COALESCE(SUM(pcem.total_liquidations), 0) AS total_liquidations,
        SUM(pcem.total_pdp_views) AS total_pdp_views
    FROM premium_creators pc
    LEFT JOIN portfolio_creator_engagement_metrics pcem ON pc.creator_id = pcem.creator_id
    GROUP BY pc.creator_username
),
subscription_by_username AS (
    -- Use MAX instead of SUM to avoid double-counting when a creator has multiple creator_ids
    -- Subscriptions are at the username level, so all creator_ids for the same username have the same subscription count
    SELECT
        pc.creator_username,
        MAX(pcm.total_subscriptions) AS total_subscriptions,
        MAX(pcm.total_paywall_views) AS total_paywall_views,
        MAX(pcm.total_cancellations) AS total_cancellations
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
        WHEN COALESCE(eng.total_pdp_views, 0) > 0
        THEN (COALESCE(eng.total_copies, 0)::numeric / eng.total_pdp_views::numeric) * 100
        ELSE 0
    END AS copy_cvr,
    CASE
        WHEN COALESCE(eng.total_copies, 0) > 0
        THEN (COALESCE(eng.total_liquidations, 0)::numeric / eng.total_copies::numeric) * 100
        ELSE 0
    END AS liquidation_rate,
    -- Subscription metrics
    COALESCE(sub.total_subscriptions, 0) AS total_subscriptions,
    COALESCE(sub.total_paywall_views, 0) AS total_paywall_views,
    COALESCE(sub.total_cancellations, 0) AS total_cancellations,
    -- Calculate subscription CVR and cancellation rate
    CASE
        WHEN COALESCE(sub.total_paywall_views, 0) > 0
        THEN (COALESCE(sub.total_subscriptions, 0)::numeric / sub.total_paywall_views::numeric) * 100
        ELSE 0
    END AS subscription_cvr,
    CASE
        WHEN COALESCE(sub.total_subscriptions, 0) > 0
        THEN (COALESCE(sub.total_cancellations, 0)::numeric / sub.total_subscriptions::numeric) * 100
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
    eng.total_liquidations,
    eng.total_pdp_views,
    sub.total_subscriptions,
    sub.total_paywall_views,
    sub.total_cancellations;

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_premium_creator_breakdown_username ON premium_creator_breakdown(creator_username);

-- Grant permissions
GRANT SELECT ON premium_creator_breakdown TO anon, authenticated;

-- Add comment
COMMENT ON MATERIALIZED VIEW premium_creator_breakdown IS
'Creator-level aggregated metrics for Premium Creator Breakdown. Uses portfolio_creator_engagement_metrics for all metrics. Refresh after syncing creator data or uploading portfolio performance metrics.';

-- Refresh the view to populate with current data
REFRESH MATERIALIZED VIEW premium_creator_breakdown;
