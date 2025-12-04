-- Migration: Recreate premium_creator_top_5_stocks view
-- Created: 2025-12-04
-- Purpose: Recreate view that was dropped by CASCADE in 20251203_fix_premium_creator_metrics_single_row.sql
--
-- Issue: 20251203_fix_premium_creator_metrics_single_row.sql dropped premium_creator_breakdown with CASCADE,
--        which also dropped premium_creator_top_5_stocks (dependent view), but never recreated it.
--
-- This view is queried by creator_analysis_tool_supabase.js for stock holdings display.

CREATE VIEW premium_creator_top_5_stocks AS
WITH creator_copy_capital AS (
  -- Get total copy capital for each creator first
  SELECT
    creator_username,
    total_copy_capital
  FROM premium_creator_breakdown
),
stock_aggregation AS (
  SELECT
    pc.creator_username,
    psh.stock_ticker,
    SUM(psh.total_quantity) AS total_quantity,
    -- Use weighted average for avg_price across multiple portfolios
    SUM(psh.total_quantity * COALESCE(psh.avg_price, 0)) / NULLIF(SUM(psh.total_quantity), 0) AS weighted_avg_price,
    ccc.total_copy_capital
  FROM premium_creators pc
  LEFT JOIN creator_copy_capital ccc
    ON pc.creator_username = ccc.creator_username
  LEFT JOIN portfolio_creator_engagement_metrics pcem
    ON pc.creator_id = pcem.creator_id
  LEFT JOIN portfolio_stock_holdings psh
    ON pcem.portfolio_ticker = psh.portfolio_ticker
  WHERE psh.stock_ticker IS NOT NULL
  GROUP BY pc.creator_username, psh.stock_ticker, ccc.total_copy_capital
),
ranked_stocks AS (
  SELECT
    creator_username,
    stock_ticker,
    total_quantity,
    weighted_avg_price,
    total_copy_capital,
    -- Calculate stock value (quantity * price)
    total_quantity * COALESCE(weighted_avg_price, 0) AS stock_value,
    -- Calculate allocation percentage
    CASE
      WHEN total_copy_capital IS NULL OR total_copy_capital = 0 THEN 0
      ELSE (total_quantity * COALESCE(weighted_avg_price, 0)) / total_copy_capital * 100
    END AS allocation_pct,
    ROW_NUMBER() OVER (
      PARTITION BY creator_username
      -- ORDER BY allocation percentage (highest first)
      ORDER BY
        CASE
          WHEN total_copy_capital IS NULL OR total_copy_capital = 0 THEN 0
          ELSE (total_quantity * COALESCE(weighted_avg_price, 0)) / total_copy_capital
        END DESC
    ) AS rank
  FROM stock_aggregation
)
SELECT
  rs.creator_username,
  ARRAY_AGG(
    json_build_object(
      'ticker', rs.stock_ticker,
      'quantity', rs.total_quantity,
      'avg_price', rs.weighted_avg_price
    ) ORDER BY rs.rank
  ) FILTER (WHERE rs.rank <= 5) AS top_5_stocks,
  pcb.total_copies,
  pcb.total_copy_capital
FROM ranked_stocks rs
LEFT JOIN premium_creator_breakdown pcb
  ON rs.creator_username = pcb.creator_username
WHERE rs.rank <= 5
GROUP BY rs.creator_username, pcb.total_copies, pcb.total_copy_capital;

-- Grant permissions
GRANT SELECT ON premium_creator_top_5_stocks TO anon, authenticated;

COMMENT ON VIEW premium_creator_top_5_stocks IS
'Top 5 stocks for each premium creator ranked by allocation % of total copy capital. Calculation: (quantity * avg_price) / copy_capital. Shows stocks with highest percentage allocations. Depends on premium_creator_breakdown and portfolio_stock_holdings.';

-- =======================
-- Log Migration
-- =======================

DO $$
BEGIN
  RAISE NOTICE ' ';
  RAISE NOTICE '✅ Recreated premium_creator_top_5_stocks view';
  RAISE NOTICE '   - Dropped by CASCADE in 20251203_fix_premium_creator_metrics_single_row.sql';
  RAISE NOTICE '   - Required by creator_analysis_tool_supabase.js';
  RAISE NOTICE '   - Ranks stocks by allocation % of total copy capital';
  RAISE NOTICE ' ';
END $$;
