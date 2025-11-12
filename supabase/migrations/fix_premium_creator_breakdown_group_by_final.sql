-- Fix Premium Creator Breakdown GROUP BY clause
-- Problem: Final GROUP BY includes aggregated columns (copy.total_copies, etc.)
--          which causes incorrect aggregation when joining with multi-row CTEs
-- Solution: Only GROUP BY pc.creator_username (the dimension), not the measures
-- Date: 2025-11-12

DROP MATERIALIZED VIEW IF EXISTS premium_creator_breakdown CASCADE;

CREATE MATERIALIZED VIEW premium_creator_breakdown AS
WITH engagement_by_username AS (
    SELECT
        pc.creator_username,
        SUM(pcem.total_pdp_views) AS total_pdp_views
    FROM premium_creators pc
    LEFT JOIN portfolio_creator_engagement_metrics pcem ON pc.creator_id = pcem.creator_id
    GROUP BY pc.creator_username
),
copy_metrics_by_username AS (
    -- Use portfolio_creator_copy_metrics (chart 86055000) for copies/liquidations
    SELECT
        pc.creator_username,
        SUM(pccm.total_copies) AS total_copies,
        SUM(pccm.total_liquidations) AS total_liquidations
    FROM premium_creators pc
    LEFT JOIN portfolio_creator_copy_metrics pccm ON pc.creator_id = pccm.creator_id
    GROUP BY pc.creator_username
),
subscription_by_username AS (
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
    -- Use MAX since CTEs already aggregated by username (each username has only 1 row in CTEs)
    COALESCE(MAX(copy.total_copies), 0::bigint) AS total_copies,
    COALESCE(MAX(eng.total_pdp_views), 0::numeric) AS total_pdp_views,
    COALESCE(MAX(copy.total_liquidations), 0::bigint) AS total_liquidations,
    CASE
        WHEN COALESCE(MAX(copy.total_copies), 0::bigint) > 0
        THEN (COALESCE(MAX(copy.total_liquidations), 0::bigint)::numeric / COALESCE(MAX(copy.total_copies), 1::bigint)::numeric) * 100::numeric
        ELSE 0::numeric
    END AS liquidation_rate,
    COALESCE(MAX(sub.total_subscriptions), 0) AS total_subscriptions,
    COALESCE(MAX(sub.total_paywall_views), 0) AS total_paywall_views,
    COALESCE(MAX(sub.total_cancellations), 0) AS total_cancellations,
    CASE
        WHEN COALESCE(MAX(sub.total_paywall_views), 0) > 0
        THEN (COALESCE(MAX(sub.total_subscriptions), 0)::numeric / COALESCE(MAX(sub.total_paywall_views), 1)::numeric) * 100::numeric
        ELSE 0::numeric
    END AS subscription_cvr,
    CASE
        WHEN COALESCE(MAX(sub.total_subscriptions), 0) > 0
        THEN (COALESCE(MAX(sub.total_cancellations), 0)::numeric / COALESCE(MAX(sub.total_subscriptions), 1)::numeric) * 100::numeric
        ELSE 0::numeric
    END AS cancellation_rate,
    AVG(perf.total_returns_percentage) AS avg_all_time_returns,
    CASE
        WHEN SUM(perf.total_position) > 0::numeric THEN SUM(perf.total_position)
        ELSE NULL::numeric
    END AS total_copy_capital
FROM (SELECT DISTINCT creator_username FROM premium_creators) pc
LEFT JOIN engagement_by_username eng ON pc.creator_username = eng.creator_username
LEFT JOIN copy_metrics_by_username copy ON pc.creator_username = copy.creator_username
LEFT JOIN subscription_by_username sub ON pc.creator_username = sub.creator_username
LEFT JOIN performance_by_username perf ON pc.creator_username = perf.creator_username
-- FIX: Only GROUP BY the dimension (creator_username), not the aggregated measures
GROUP BY pc.creator_username;

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_premium_creator_breakdown_username ON premium_creator_breakdown(creator_username);

-- Grant permissions
GRANT SELECT ON premium_creator_breakdown TO anon, authenticated;

COMMENT ON MATERIALIZED VIEW premium_creator_breakdown IS
'Creator-level aggregated metrics for Premium Creator Breakdown. Uses portfolio_creator_copy_metrics (chart 86055000) for copies/liquidations to match Affinity view. Refresh after syncing creator data.';
