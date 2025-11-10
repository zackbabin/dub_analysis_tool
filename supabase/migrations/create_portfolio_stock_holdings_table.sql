-- Migration: Create portfolio_stock_holdings table
-- Description: Stores stock holdings data for each portfolio
-- Data source: Manual CSV upload of position ledgers
-- Columns: portfolio_ticker (e.g., "$ACKMAN"), stock_ticker (e.g., "AAPL"), position_count, total_quantity

CREATE TABLE IF NOT EXISTS portfolio_stock_holdings (
  id BIGSERIAL PRIMARY KEY,
  portfolio_ticker TEXT NOT NULL,
  stock_ticker TEXT NOT NULL,
  position_count INTEGER NOT NULL,
  total_quantity NUMERIC NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Ensure one record per portfolio-stock combination
  UNIQUE(portfolio_ticker, stock_ticker)
);

-- Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_portfolio_stock_holdings_portfolio
ON portfolio_stock_holdings(portfolio_ticker);

CREATE INDEX IF NOT EXISTS idx_portfolio_stock_holdings_stock
ON portfolio_stock_holdings(stock_ticker);

CREATE INDEX IF NOT EXISTS idx_portfolio_stock_holdings_quantity
ON portfolio_stock_holdings(total_quantity DESC);

-- Grant permissions
GRANT SELECT ON portfolio_stock_holdings TO authenticated, anon, service_role;

COMMENT ON TABLE portfolio_stock_holdings IS
'Stock holdings for each portfolio. Uploaded manually via CSV. Links to premium creators via portfolio_creator_engagement_metrics.';
