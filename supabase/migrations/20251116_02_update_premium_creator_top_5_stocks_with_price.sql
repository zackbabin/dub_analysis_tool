-- Update premium_creator_top_5_stocks view to include avg_price for percentage calculation
-- This allows frontend to calculate and display allocation percentage as: (total_quantity * avg_price) / copy_capital
-- Display format: "NVDA (5%)"
-- Date: 2025-11-16

DROP VIEW IF EXISTS premium_creator_top_5_stocks CASCADE;

CREATE VIEW premium_creator_top_5_stocks AS
WITH stock_aggregation AS (
  SELECT
    pc.creator_username,
    psh.stock_ticker,
    SUM(psh.total_quantity) AS total_quantity,
    -- Use weighted average for avg_price across multiple portfolios
    SUM(psh.total_quantity * COALESCE(psh.avg_price, 0)) / NULLIF(SUM(psh.total_quantity), 0) AS weighted_avg_price
  FROM premium_creators pc
  LEFT JOIN portfolio_creator_engagement_metrics pcem
    ON pc.creator_id = pcem.creator_id
  LEFT JOIN portfolio_stock_holdings psh
    ON pcem.portfolio_ticker = psh.portfolio_ticker
  WHERE psh.stock_ticker IS NOT NULL
  GROUP BY pc.creator_username, psh.stock_ticker
),
ranked_stocks AS (
  SELECT
    creator_username,
    stock_ticker,
    total_quantity,
    weighted_avg_price,
    ROW_NUMBER() OVER (
      PARTITION BY creator_username
      ORDER BY total_quantity DESC
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

-- Add comment
COMMENT ON VIEW premium_creator_top_5_stocks IS
'Top 5 stocks for each premium creator with quantity, avg_price, total_copies, and total_copy_capital. Frontend calculates allocation % as: (quantity * avg_price) / copy_capital. Depends on premium_creator_breakdown and portfolio_stock_holdings.';
