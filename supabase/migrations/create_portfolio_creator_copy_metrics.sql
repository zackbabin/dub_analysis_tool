-- Create table for portfolio-level aggregated copy and liquidation metrics
-- Data source: Mixpanel chart 86055000
-- This stores portfolio-creator level aggregates (not user-level)
-- Used for Premium Creator Analysis tab

CREATE TABLE IF NOT EXISTS portfolio_creator_copy_metrics (
  id BIGSERIAL PRIMARY KEY,
  portfolio_ticker TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  creator_username TEXT NOT NULL,
  total_copies INTEGER NOT NULL DEFAULT 0,
  total_liquidations INTEGER NOT NULL DEFAULT 0,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Ensure one record per portfolio-creator pair
  UNIQUE(portfolio_ticker, creator_id)
);

-- Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_portfolio_creator_copy_metrics_portfolio
  ON portfolio_creator_copy_metrics(portfolio_ticker);

CREATE INDEX IF NOT EXISTS idx_portfolio_creator_copy_metrics_creator
  ON portfolio_creator_copy_metrics(creator_id);

CREATE INDEX IF NOT EXISTS idx_portfolio_creator_copy_metrics_username
  ON portfolio_creator_copy_metrics(creator_username);

-- Grant permissions
GRANT SELECT ON portfolio_creator_copy_metrics TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON portfolio_creator_copy_metrics TO service_role;

-- Add comment
COMMENT ON TABLE portfolio_creator_copy_metrics IS
'Portfolio-level aggregated copy and liquidation metrics from Mixpanel chart 86055000.
This is NOT user-level data - these are portfolio-creator aggregates.
Refreshed during engagement sync via sync-mixpanel-engagement → process-copy-metrics chain.';
