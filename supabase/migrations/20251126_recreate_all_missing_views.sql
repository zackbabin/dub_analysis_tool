-- Migration: Recreate all missing premium creator and portfolio views
-- Created: 2025-11-26
-- Purpose: Fix 404 errors by recreating views that don't exist in database
--
-- Missing views reported by browser:
-- - premium_creator_summary_stats
-- - premium_creator_breakdown
-- - premium_creator_top_5_stocks
-- - portfolio_breakdown_with_metrics

-- ============================================================================
-- 1. Create premium_creator_breakdown (regular view)
-- ============================================================================

DROP VIEW IF EXISTS premium_creator_breakdown CASCADE;

CREATE VIEW premium_creator_breakdown AS
WITH engagement_by_username AS (
    SELECT
        pc.creator_username,
        SUM(pcem.total_pdp_views) AS total_pdp_views
    FROM premium_creators pc
    LEFT JOIN portfolio_creator_engagement_metrics pcem ON pc.creator_id = pcem.creator_id
    GROUP BY pc.creator_username
),
copy_metrics_by_username AS (
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
    COALESCE(copy.total_copies, 0) AS total_copies,
    COALESCE(eng.total_pdp_views, 0) AS total_pdp_views,
    COALESCE(copy.total_liquidations, 0) AS total_liquidations,
    CASE
        WHEN COALESCE(copy.total_copies, 0) > 0
        THEN (COALESCE(copy.total_liquidations, 0)::numeric / COALESCE(copy.total_copies, 1)::numeric) * 100
        ELSE 0
    END AS liquidation_rate,
    COALESCE(sub.total_subscriptions, 0) AS total_subscriptions,
    COALESCE(sub.total_paywall_views, 0) AS total_paywall_views,
    COALESCE(sub.total_cancellations, 0) AS total_cancellations,
    CASE
        WHEN COALESCE(sub.total_paywall_views, 0) > 0
        THEN (COALESCE(sub.total_subscriptions, 0)::numeric / COALESCE(sub.total_paywall_views, 1)::numeric) * 100
        ELSE 0
    END AS subscription_cvr,
    CASE
        WHEN COALESCE(sub.total_subscriptions, 0) > 0
        THEN (COALESCE(sub.total_cancellations, 0)::numeric / COALESCE(sub.total_subscriptions, 1)::numeric) * 100
        ELSE 0
    END AS cancellation_rate,
    AVG(perf.total_returns_percentage) AS avg_all_time_returns,
    CASE
        WHEN SUM(perf.total_position) > 0 THEN SUM(perf.total_position)
        ELSE NULL
    END AS total_copy_capital
FROM (SELECT DISTINCT creator_username FROM premium_creators) pc
LEFT JOIN engagement_by_username eng ON pc.creator_username = eng.creator_username
LEFT JOIN copy_metrics_by_username copy ON pc.creator_username = copy.creator_username
LEFT JOIN subscription_by_username sub ON pc.creator_username = sub.creator_username
LEFT JOIN performance_by_username perf ON pc.creator_username = perf.creator_username
GROUP BY
    pc.creator_username,
    eng.total_pdp_views,
    copy.total_copies,
    copy.total_liquidations,
    sub.total_subscriptions,
    sub.total_paywall_views,
    sub.total_cancellations;

GRANT SELECT ON premium_creator_breakdown TO anon, authenticated, service_role;

COMMENT ON VIEW premium_creator_breakdown IS
'Creator-level aggregated metrics for Premium Creator Breakdown. Regular view (not materialized) that always shows fresh data.';

-- ============================================================================
-- 2. Create premium_creator_summary_stats (depends on premium_creator_breakdown)
-- ============================================================================

DROP VIEW IF EXISTS premium_creator_summary_stats CASCADE;

CREATE VIEW premium_creator_summary_stats AS
SELECT
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_copies) AS median_copies,
    AVG(subscription_cvr) AS avg_subscription_cvr,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY avg_all_time_returns) AS median_all_time_performance,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_copy_capital) AS median_copy_capital,
    COUNT(*) AS total_creators
FROM premium_creator_breakdown;

GRANT SELECT ON premium_creator_summary_stats TO anon, authenticated, service_role;

COMMENT ON VIEW premium_creator_summary_stats IS
'Summary statistics aggregated across all premium creators. Used for metric cards on Premium Creator Analysis tab.';

-- ============================================================================
-- 3. Create premium_creator_top_5_stocks (depends on premium_creator_breakdown)
-- ============================================================================

DROP VIEW IF EXISTS premium_creator_top_5_stocks CASCADE;

CREATE VIEW premium_creator_top_5_stocks AS
WITH stock_aggregation AS (
  SELECT
    pc.creator_username,
    psh.stock_ticker,
    psh.total_quantity
  FROM premium_creators pc
  LEFT JOIN portfolio_creator_engagement_metrics pcem
    ON pc.creator_id = pcem.creator_id
  LEFT JOIN portfolio_stock_holdings psh
    ON pcem.portfolio_ticker = psh.portfolio_ticker
  WHERE psh.stock_ticker IS NOT NULL
),
ranked_stocks AS (
  SELECT
    creator_username,
    stock_ticker,
    SUM(total_quantity) AS total_quantity,
    ROW_NUMBER() OVER (
      PARTITION BY creator_username
      ORDER BY SUM(total_quantity) DESC
    ) AS rank
  FROM stock_aggregation
  GROUP BY creator_username, stock_ticker
)
SELECT
  rs.creator_username,
  ARRAY_AGG(
    json_build_object(
      'ticker', rs.stock_ticker,
      'quantity', rs.total_quantity
    ) ORDER BY rs.rank
  ) FILTER (WHERE rs.rank <= 5) AS top_5_stocks,
  pcb.total_copies
FROM ranked_stocks rs
LEFT JOIN premium_creator_breakdown pcb
  ON rs.creator_username = pcb.creator_username
WHERE rs.rank <= 5
GROUP BY rs.creator_username, pcb.total_copies;

GRANT SELECT ON premium_creator_top_5_stocks TO anon, authenticated, service_role;

COMMENT ON VIEW premium_creator_top_5_stocks IS
'Top 5 stock holdings for each premium creator. Includes total_copies column for sorting.';

-- ============================================================================
-- 4. Create portfolio_breakdown_with_metrics (regular view)
-- ============================================================================

DROP VIEW IF EXISTS portfolio_breakdown_with_metrics CASCADE;

CREATE VIEW portfolio_breakdown_with_metrics AS
SELECT
    pcem.portfolio_ticker,
    pcem.creator_id,
    pc.creator_username,
    pcem.total_copies,
    pcem.total_pdp_views,
    pccm.total_liquidations,
    CASE
        WHEN pcem.total_pdp_views > 0
        THEN (pcem.total_copies::numeric / pcem.total_pdp_views::numeric) * 100
        ELSE 0
    END as copy_cvr,
    CASE
        WHEN pcem.total_copies > 0
        THEN (pccm.total_liquidations::numeric / pcem.total_copies::numeric) * 100
        ELSE 0
    END as liquidation_rate,
    ppm.total_returns_percentage,
    ppm.total_position,
    ppm.inception_date,
    ppm.uploaded_at as metrics_updated_at
FROM portfolio_creator_engagement_metrics pcem
JOIN premium_creators pc ON pcem.creator_id = pc.creator_id
LEFT JOIN portfolio_creator_copy_metrics pccm ON pcem.portfolio_ticker = pccm.portfolio_ticker AND pcem.creator_id = pccm.creator_id
LEFT JOIN portfolio_performance_metrics ppm ON pcem.portfolio_ticker = ppm.portfolio_ticker;

GRANT SELECT ON portfolio_breakdown_with_metrics TO service_role, authenticated, anon;

COMMENT ON VIEW portfolio_breakdown_with_metrics IS
'Portfolio breakdown with engagement and performance metrics. Regular view (not materialized) - always shows current data.';

-- Log the changes
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Recreated all missing views:';
  RAISE NOTICE '   1. premium_creator_breakdown (regular view)';
  RAISE NOTICE '   2. premium_creator_summary_stats (regular view)';
  RAISE NOTICE '   3. premium_creator_top_5_stocks (regular view)';
  RAISE NOTICE '   4. portfolio_breakdown_with_metrics (regular view)';
  RAISE NOTICE '';
  RAISE NOTICE '⚠️ If portfolio_creator_engagement_metrics is empty, run:';
  RAISE NOTICE '   SELECT refresh_portfolio_engagement_views();';
  RAISE NOTICE '';
END $$;
