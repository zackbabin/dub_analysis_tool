-- Add price columns to portfolio_stock_holdings table
-- These columns are needed for calculating portfolio allocation percentages
-- Source: position ledgers CSV with avg_price, min_price, max_price columns
-- Date: 2025-11-16

ALTER TABLE portfolio_stock_holdings
ADD COLUMN IF NOT EXISTS avg_price NUMERIC,
ADD COLUMN IF NOT EXISTS min_price NUMERIC,
ADD COLUMN IF NOT EXISTS max_price NUMERIC;

COMMENT ON COLUMN portfolio_stock_holdings.avg_price IS 'Average price of the stock position';
COMMENT ON COLUMN portfolio_stock_holdings.min_price IS 'Minimum price of the stock position';
COMMENT ON COLUMN portfolio_stock_holdings.max_price IS 'Maximum price of the stock position';

-- Update table comment
COMMENT ON TABLE portfolio_stock_holdings IS
'Stock holdings for each portfolio with price data. Uploaded manually via CSV. Links to premium creators via portfolio_creator_engagement_metrics.';
