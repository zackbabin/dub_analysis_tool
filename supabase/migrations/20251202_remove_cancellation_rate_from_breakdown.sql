-- Remove cancellation_rate column from premium_creator_breakdown view
-- Keep total_cancellations in subscription_by_username CTE for future use if needed
-- Remove cancellation_rate calculation and column from final SELECT

DROP VIEW IF EXISTS premium_creator_breakdown CASCADE;

CREATE VIEW premium_creator_breakdown AS
WITH engagement_by_username AS (
    SELECT pc.creator_username,
        SUM(pcem.total_pdp_views) AS total_pdp_views
    FROM premium_creators pc
    LEFT JOIN portfolio_creator_engagement_metrics pcem
        ON pc.creator_id = pcem.creator_id
    GROUP BY pc.creator_username
),
copy_metrics_by_username AS (
    SELECT pc.creator_username,
        SUM(pccm.total_copies) AS total_copies,
        SUM(pccm.total_liquidations) AS total_liquidations
    FROM premium_creators pc
    LEFT JOIN portfolio_creator_copy_metrics pccm
        ON pc.creator_id = pccm.creator_id
    GROUP BY pc.creator_username
),
subscription_by_username AS (
    SELECT pc.creator_username,
        MAX(pcm.total_subscriptions) AS total_subscriptions,
        MAX(pcm.total_paywall_views) AS total_paywall_views,
        MAX(pcm.total_cancellations) AS total_cancellations
    FROM premium_creators pc
    LEFT JOIN premium_creator_metrics pcm
        ON pc.creator_id = pcm.creator_id
    GROUP BY pc.creator_username
),
performance_by_username AS (
    SELECT pc.creator_username,
        AVG(ppm.total_returns_percentage) AS avg_all_time_returns,
        SUM(ppm.total_position) AS total_copy_capital
    FROM premium_creators pc
    LEFT JOIN portfolio_creator_engagement_metrics pcem
        ON pc.creator_id = pcem.creator_id
    LEFT JOIN portfolio_performance_metrics ppm
        ON pcem.portfolio_ticker = ppm.portfolio_ticker
    GROUP BY pc.creator_username
)
SELECT pc.creator_username,
    COALESCE(copy.total_copies, 0) AS total_copies,
    COALESCE(eng.total_pdp_views, 0) AS total_pdp_views,
    COALESCE(copy.total_liquidations, 0) AS total_liquidations,
    CASE
        WHEN COALESCE(copy.total_copies, 0) > 0 THEN
            (COALESCE(copy.total_liquidations, 0)::NUMERIC / COALESCE(copy.total_copies, 1)::NUMERIC) * 100
        ELSE 0
    END AS liquidation_rate,
    COALESCE(sub.total_subscriptions, 0) AS total_subscriptions,
    COALESCE(sub.total_paywall_views, 0) AS total_paywall_views,
    COALESCE(sub.total_cancellations, 0) AS total_cancellations,
    CASE
        WHEN COALESCE(sub.total_paywall_views, 0) > 0 THEN
            (COALESCE(sub.total_subscriptions, 0)::NUMERIC / COALESCE(sub.total_paywall_views, 1)::NUMERIC) * 100
        ELSE 0
    END AS subscription_cvr,
    -- Removed: cancellation_rate calculation
    perf.avg_all_time_returns,
    CASE
        WHEN perf.total_copy_capital > 0 THEN perf.total_copy_capital
        ELSE NULL
    END AS total_copy_capital
FROM (SELECT DISTINCT creator_username FROM premium_creators) pc
LEFT JOIN engagement_by_username eng
    ON pc.creator_username = eng.creator_username
LEFT JOIN copy_metrics_by_username copy
    ON pc.creator_username = copy.creator_username
LEFT JOIN subscription_by_username sub
    ON pc.creator_username = sub.creator_username
LEFT JOIN performance_by_username perf
    ON pc.creator_username = perf.creator_username;

GRANT SELECT ON premium_creator_breakdown TO anon, authenticated, service_role;

COMMENT ON VIEW premium_creator_breakdown IS
'Creator-level aggregated metrics for Premium Creator Breakdown. Regular view (not materialized) that always shows fresh data. Uses portfolio_creator_copy_metrics for copies/liquidations. No refresh needed - updates automatically when underlying data changes. Cancellation rate removed from display but total_cancellations still tracked.';

-- Log the changes
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Removed cancellation_rate from premium_creator_breakdown';
  RAISE NOTICE '   - Column removed from view';
  RAISE NOTICE '   - total_cancellations still available in underlying data';
  RAISE NOTICE '';
END $$;
