-- Migration: Add total_copy_capital to premium_creator_top_5_stocks view
-- Created: 2025-11-26
-- Purpose: UI code expects total_copy_capital but view only returns total_copies
--
-- Background:
-- - UI displays copy capital alongside top 5 stocks
-- - View was missing total_copy_capital column from premium_creator_breakdown join

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
  pcb.total_copies,
  pcb.total_copy_capital  -- ADD: Include copy capital for UI display
FROM ranked_stocks rs
LEFT JOIN premium_creator_breakdown pcb
  ON rs.creator_username = pcb.creator_username
WHERE rs.rank <= 5
GROUP BY rs.creator_username, pcb.total_copies, pcb.total_copy_capital;

GRANT SELECT ON premium_creator_top_5_stocks TO anon, authenticated, service_role;

COMMENT ON VIEW premium_creator_top_5_stocks IS
'Top 5 stock holdings for each premium creator. Includes total_copies and total_copy_capital for sorting and display.';

-- Log the changes
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Added total_copy_capital to premium_creator_top_5_stocks';
  RAISE NOTICE '   - View now includes copy capital for UI display';
  RAISE NOTICE '';
END $$;
