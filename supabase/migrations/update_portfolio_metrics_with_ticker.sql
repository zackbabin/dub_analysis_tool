-- Add portfolio_ticker column as the new primary key
-- Remove strategy_id column (no longer needed)

-- Drop existing primary key constraint
ALTER TABLE portfolio_performance_metrics DROP CONSTRAINT IF EXISTS portfolio_performance_metrics_pkey;

-- Add portfolio_ticker column if it doesn't exist
ALTER TABLE portfolio_performance_metrics ADD COLUMN IF NOT EXISTS portfolio_ticker TEXT;

-- Set portfolio_ticker as primary key
ALTER TABLE portfolio_performance_metrics ADD PRIMARY KEY (portfolio_ticker);

-- Drop strategy_id column (no longer needed since we're using portfolio_ticker directly)
ALTER TABLE portfolio_performance_metrics DROP COLUMN IF EXISTS strategy_id;

-- Add index on portfolio_ticker for fast lookups
CREATE INDEX IF NOT EXISTS idx_portfolio_metrics_ticker ON portfolio_performance_metrics(portfolio_ticker);
