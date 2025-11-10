-- Migration: Create premium_creator_stock_holdings materialized view
-- Description: Aggregates stock holdings by premium creator
-- Joins portfolio_stock_holdings with premium creators via portfolio_creator_engagement_metrics

CREATE MATERIALIZED VIEW premium_creator_stock_holdings AS
SELECT
  pc.creator_username,
  psh.stock_ticker,
  SUM(psh.total_quantity) as total_quantity,
  COUNT(DISTINCT psh.portfolio_ticker) as portfolio_count
FROM portfolio_stock_holdings psh
JOIN portfolio_creator_engagement_metrics pcem
  ON psh.portfolio_ticker = pcem.portfolio_ticker
JOIN premium_creators pc
  ON pcem.creator_id = pc.creator_id
WHERE psh.stock_ticker IS NOT NULL
  AND psh.stock_ticker != ''
GROUP BY pc.creator_username, psh.stock_ticker;

-- Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_premium_creator_stock_holdings_creator
ON premium_creator_stock_holdings(creator_username);

CREATE INDEX IF NOT EXISTS idx_premium_creator_stock_holdings_stock
ON premium_creator_stock_holdings(stock_ticker);

CREATE INDEX IF NOT EXISTS idx_premium_creator_stock_holdings_quantity
ON premium_creator_stock_holdings(total_quantity DESC);

-- Grant permissions
GRANT SELECT ON premium_creator_stock_holdings TO anon, authenticated;

COMMENT ON MATERIALIZED VIEW premium_creator_stock_holdings IS
'Aggregates stock holdings by premium creator. Refresh after uploading portfolio stock holdings data.';
