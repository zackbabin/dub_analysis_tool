-- Convert premium_creator_breakdown from materialized view to regular view
-- This ensures it always shows fresh data from portfolio_creator_engagement_metrics
-- without needing explicit refreshes, eliminating stale data issues
-- Date: 2025-11-12

-- First drop dependent views to avoid CASCADE
DROP VIEW IF EXISTS premium_creator_summary_stats;
DROP VIEW IF EXISTS premium_creator_top_5_stocks;

-- Drop premium_creator_breakdown (could be either materialized view or regular view)
-- Try regular view first, then materialized view
DROP VIEW IF EXISTS premium_creator_breakdown;
DROP MATERIALIZED VIEW IF EXISTS premium_creator_breakdown;

-- Recreate as a regular view with the correct data sources
-- Uses portfolio_creator_copy_metrics (chart 86055000) for copies/liquidations
-- Uses portfolio_creator_engagement_metrics for PDP views only
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
    -- Engagement metrics (copies/liquidations from aggregated chart 86055000 source)
    COALESCE(copy.total_copies, 0) AS total_copies,
    COALESCE(eng.total_pdp_views, 0) AS total_pdp_views,
    COALESCE(copy.total_liquidations, 0) AS total_liquidations,
    -- Liquidation rate (copies and liquidations from same source)
    CASE
        WHEN COALESCE(copy.total_copies, 0) > 0
        THEN (COALESCE(copy.total_liquidations, 0)::numeric / COALESCE(copy.total_copies, 1)::numeric) * 100
        ELSE 0
    END AS liquidation_rate,
    -- Subscription metrics
    COALESCE(sub.total_subscriptions, 0) AS total_subscriptions,
    COALESCE(sub.total_paywall_views, 0) AS total_paywall_views,
    COALESCE(sub.total_cancellations, 0) AS total_cancellations,
    -- Calculate subscription CVR and cancellation rate (with proper NULL handling)
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
    -- Performance metrics - aggregate from deduplicated portfolios
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

-- Note: Cannot create indexes on regular views (only on materialized views)
-- The underlying portfolio_creator_engagement_metrics materialized view already has indexes

-- Grant permissions
GRANT SELECT ON premium_creator_breakdown TO anon, authenticated;

-- Update comment to reflect new architecture
COMMENT ON VIEW premium_creator_breakdown IS
'Creator-level aggregated metrics for Premium Creator Breakdown. Regular view (not materialized) that always shows fresh data. Uses portfolio_creator_copy_metrics (chart 86055000) for copies/liquidations. No refresh needed - updates automatically when underlying data changes.';

-- Recreate dependent views that were dropped by CASCADE
CREATE VIEW premium_creator_summary_stats AS
SELECT
    -- Average subscription CVR across all premium creators
    AVG(subscription_cvr) AS avg_subscription_cvr,
    -- Median performance metrics across all premium creators (excluding nulls)
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY avg_all_time_returns) AS median_all_time_performance,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_copy_capital) AS median_copy_capital,
    -- Include count of creators for reference
    COUNT(*) AS total_creators
FROM premium_creator_breakdown;

GRANT SELECT ON premium_creator_summary_stats TO anon, authenticated;

-- Recreate premium_creator_top_5_stocks view
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
      'ticker', stock_ticker,
      'quantity', total_quantity
    ) ORDER BY rank
  ) FILTER (WHERE rank <= 5) AS top_5_stocks,
  pcb.total_copies
FROM ranked_stocks rs
LEFT JOIN premium_creator_breakdown pcb ON rs.creator_username = pcb.creator_username
WHERE rank <= 5
GROUP BY rs.creator_username, pcb.total_copies;

GRANT SELECT ON premium_creator_top_5_stocks TO anon, authenticated;

COMMENT ON VIEW premium_creator_summary_stats IS
'Summary statistics aggregated across all premium creators. Used for metric cards on Premium Creator Analysis tab.';

COMMENT ON VIEW premium_creator_top_5_stocks IS
'Top 5 stock holdings for each premium creator. Includes total_copies column for sorting.';
