-- Migration: Create top_stocks_all_premium_creators materialized view
-- Description: Shows the top 5 stocks traded by all premium creators combined
-- Used for displaying metric cards in the UI

CREATE MATERIALIZED VIEW top_stocks_all_premium_creators AS
WITH ranked_stocks AS (
  SELECT
    stock_ticker,
    SUM(total_quantity) as total_quantity,
    COUNT(DISTINCT creator_username) as creator_count,
    SUM(portfolio_count) as portfolio_count,
    ROW_NUMBER() OVER (ORDER BY SUM(total_quantity) DESC) as rank
  FROM premium_creator_stock_holdings
  GROUP BY stock_ticker
)
SELECT
  rank,
  stock_ticker,
  total_quantity,
  creator_count,
  portfolio_count
FROM ranked_stocks
WHERE rank <= 5
ORDER BY rank;

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_top_stocks_all_premium_creators_rank
ON top_stocks_all_premium_creators(rank);

-- Grant permissions
GRANT SELECT ON top_stocks_all_premium_creators TO anon, authenticated;

COMMENT ON MATERIALIZED VIEW top_stocks_all_premium_creators IS
'Top 5 stocks held by all premium creators combined. Refresh after uploading portfolio stock holdings data.';
