-- Migration: Recreate dependent views after premium_creator_breakdown fix
-- Created: 2025-11-27
-- Purpose: Recreate all views that were dropped by CASCADE when fixing premium_creator_breakdown
--
-- The previous migration (20251127_fix_premium_creator_breakdown_aggregation.sql) used
-- DROP VIEW IF EXISTS premium_creator_breakdown CASCADE which dropped all dependent views.
-- This migration recreates them.

-- 1. premium_creator_summary_stats (depends on: premium_creator_breakdown)
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

-- 2. premium_creator_top_5_stocks (depends on: premium_creators, portfolio_creator_engagement_metrics, portfolio_stock_holdings, premium_creator_breakdown)
DROP VIEW IF EXISTS premium_creator_top_5_stocks CASCADE;

CREATE VIEW premium_creator_top_5_stocks AS
WITH stock_aggregation AS (
  SELECT
    pc.creator_username,
    psh.stock_ticker,
    psh.total_quantity,
    psh.avg_price
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
    AVG(avg_price) AS avg_price,
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
      'quantity', rs.total_quantity,
      'avg_price', rs.avg_price
    ) ORDER BY rs.rank
  ) FILTER (WHERE rs.rank <= 5) AS top_5_stocks,
  pcb.total_copies,
  pcb.total_copy_capital
FROM ranked_stocks rs
LEFT JOIN premium_creator_breakdown pcb
  ON rs.creator_username = pcb.creator_username
WHERE rs.rank <= 5
GROUP BY rs.creator_username, pcb.total_copies, pcb.total_copy_capital;

GRANT SELECT ON premium_creator_top_5_stocks TO anon, authenticated, service_role;

COMMENT ON VIEW premium_creator_top_5_stocks IS
'Top 5 stocks for each premium creator with total_copies and total_copy_capital for sorting.';

-- 3. top_stocks_all_premium_creators (depends on: premium_creators, portfolio_creator_engagement_metrics, portfolio_stock_holdings)
DROP VIEW IF EXISTS top_stocks_all_premium_creators CASCADE;

CREATE VIEW top_stocks_all_premium_creators AS
WITH aggregated_stocks AS (
  SELECT
    psh.stock_ticker,
    SUM(psh.total_quantity) AS total_quantity,
    AVG(psh.avg_price) AS avg_price
  FROM premium_creators pc
  LEFT JOIN portfolio_creator_engagement_metrics pcem
    ON pc.creator_id = pcem.creator_id
  LEFT JOIN portfolio_stock_holdings psh
    ON pcem.portfolio_ticker = psh.portfolio_ticker
  WHERE psh.stock_ticker IS NOT NULL
  GROUP BY psh.stock_ticker
)
SELECT
  ROW_NUMBER() OVER (ORDER BY total_quantity DESC) AS rank,
  stock_ticker,
  total_quantity,
  avg_price
FROM aggregated_stocks
ORDER BY total_quantity DESC
LIMIT 5;

GRANT SELECT ON top_stocks_all_premium_creators TO anon, authenticated, service_role;

COMMENT ON VIEW top_stocks_all_premium_creators IS
'Top 5 stocks across all premium creators, aggregated by total quantity.';

-- 4. portfolio_breakdown_with_metrics (depends on: portfolio_creator_copy_metrics, portfolio_creator_engagement_metrics, portfolio_performance_metrics, premium_creators)
DROP VIEW IF EXISTS portfolio_breakdown_with_metrics CASCADE;

CREATE VIEW portfolio_breakdown_with_metrics AS
SELECT
    pccm.portfolio_ticker,
    pccm.creator_id,
    pc.creator_username,
    pccm.total_copies,
    pccm.total_liquidations,
    pcem.total_pdp_views,
    ppm.total_returns_percentage AS avg_all_time_returns,
    CASE
        WHEN ppm.total_position > 0 THEN ppm.total_position
        ELSE NULL
    END AS total_copy_capital,
    ppm.inception_date
FROM portfolio_creator_copy_metrics pccm
LEFT JOIN premium_creators pc
    ON pccm.creator_id = pc.creator_id
LEFT JOIN portfolio_creator_engagement_metrics pcem
    ON pccm.portfolio_ticker = pcem.portfolio_ticker
    AND pccm.creator_id = pcem.creator_id
LEFT JOIN portfolio_performance_metrics ppm
    ON pccm.portfolio_ticker = ppm.portfolio_ticker;

GRANT SELECT ON portfolio_breakdown_with_metrics TO anon, authenticated, service_role;

COMMENT ON VIEW portfolio_breakdown_with_metrics IS
'Portfolio breakdown with copies, liquidations, views, performance metrics, and creator info.';

-- Log success
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Recreated all dependent views after premium_creator_breakdown fix';
  RAISE NOTICE '   ✓ premium_creator_summary_stats (for metric cards)';
  RAISE NOTICE '   ✓ premium_creator_top_5_stocks (for portfolio assets table)';
  RAISE NOTICE '   ✓ top_stocks_all_premium_creators (for overall top 5 stocks)';
  RAISE NOTICE '   ✓ portfolio_breakdown_with_metrics (for portfolio breakdown)';
  RAISE NOTICE '';
END $$;
