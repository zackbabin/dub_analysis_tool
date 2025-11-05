-- Add portfolio_ticker column as the new primary key
-- Remove strategy_id column (no longer needed)

-- Step 1: Drop the materialized view that depends on strategy_id
DROP MATERIALIZED VIEW IF EXISTS portfolio_breakdown_with_metrics CASCADE;

-- Step 2: Add portfolio_ticker column if it doesn't exist
ALTER TABLE portfolio_performance_metrics ADD COLUMN IF NOT EXISTS portfolio_ticker TEXT;

-- Step 3: Since we're switching from strategy_id to portfolio_ticker,
-- and existing data uses strategy_id which doesn't map to portfolio_ticker,
-- we need to clear the table (data will be re-uploaded with new CSV)
TRUNCATE TABLE portfolio_performance_metrics;

-- Step 4: Drop existing primary key constraint
ALTER TABLE portfolio_performance_metrics DROP CONSTRAINT IF EXISTS portfolio_performance_metrics_pkey;

-- Step 5: Drop strategy_id column (no longer needed)
ALTER TABLE portfolio_performance_metrics DROP COLUMN IF EXISTS strategy_id;

-- Step 6: Set portfolio_ticker as primary key (NOT NULL is enforced by PRIMARY KEY)
ALTER TABLE portfolio_performance_metrics ADD PRIMARY KEY (portfolio_ticker);

-- Step 7: Add index on portfolio_ticker for fast lookups
CREATE INDEX IF NOT EXISTS idx_portfolio_metrics_ticker ON portfolio_performance_metrics(portfolio_ticker);
