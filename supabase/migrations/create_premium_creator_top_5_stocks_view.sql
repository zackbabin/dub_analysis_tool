-- Migration: Create premium_creator_top_5_stocks materialized view
-- Description: Shows the top 5 stocks for each premium creator
-- Used for displaying in the Premium Creator Breakdown table

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
  creator_username,
  ARRAY_AGG(stock_ticker ORDER BY rank) as top_stocks,
  ARRAY_AGG(total_quantity ORDER BY rank) as top_quantities
FROM ranked_by_creator
WHERE rank <= 5
GROUP BY creator_username;

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_premium_creator_top_5_stocks_creator
ON premium_creator_top_5_stocks(creator_username);

-- Grant permissions
GRANT SELECT ON premium_creator_top_5_stocks TO anon, authenticated;

COMMENT ON MATERIALIZED VIEW premium_creator_top_5_stocks IS
'Top 5 stocks for each premium creator. Refresh after uploading portfolio stock holdings data.';
