-- Migration: Update premium_creator_top_5_stocks to include total_copies
-- Description: Adds total_copies column from premium_creator_breakdown for sorting
-- This allows the frontend to order by total_copies without a separate query

DROP MATERIALIZED VIEW IF EXISTS premium_creator_top_5_stocks;

CREATE MATERIALIZED VIEW premium_creator_top_5_stocks AS
WITH ranked_by_creator AS (
  SELECT
    creator_username,
    stock_ticker,
    total_quantity,
    ROW_NUMBER() OVER (
      PARTITION BY creator_username
      ORDER BY total_quantity DESC
    ) as rank
  FROM premium_creator_stock_holdings
)
SELECT
  rbc.creator_username,
  ARRAY_AGG(rbc.stock_ticker ORDER BY rbc.rank) as top_stocks,
  ARRAY_AGG(rbc.total_quantity ORDER BY rbc.rank) as top_quantities,
  pcb.total_copies
FROM ranked_by_creator rbc
LEFT JOIN premium_creator_breakdown pcb ON rbc.creator_username = pcb.creator_username
WHERE rbc.rank <= 5
GROUP BY rbc.creator_username, pcb.total_copies;

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_premium_creator_top_5_stocks_creator
ON premium_creator_top_5_stocks(creator_username);

-- Create index for sorting by total_copies
CREATE INDEX IF NOT EXISTS idx_premium_creator_top_5_stocks_copies
ON premium_creator_top_5_stocks(total_copies DESC);

-- Grant permissions
GRANT SELECT ON premium_creator_top_5_stocks TO anon, authenticated;

COMMENT ON MATERIALIZED VIEW premium_creator_top_5_stocks IS
'Top 5 stocks for each premium creator with total_copies for sorting. Refresh after uploading portfolio stock holdings data.';
