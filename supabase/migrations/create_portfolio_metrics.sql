-- Create table to store portfolio ticker to ID mapping from Mixpanel Chart 85877922
CREATE TABLE IF NOT EXISTS portfolio_ticker_mapping (
    portfolio_ticker TEXT NOT NULL,
    portfolio_id TEXT NOT NULL,
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (portfolio_ticker, portfolio_id)
);

CREATE INDEX IF NOT EXISTS idx_portfolio_mapping_ticker ON portfolio_ticker_mapping(portfolio_ticker);
CREATE INDEX IF NOT EXISTS idx_portfolio_mapping_id ON portfolio_ticker_mapping(portfolio_id);

-- Create table to store portfolio performance metrics from CSV uploads
-- Maps strategyId (from CSV) to totalreturnspercentage and totalposition
CREATE TABLE IF NOT EXISTS portfolio_performance_metrics (
    strategy_id TEXT PRIMARY KEY,
    total_returns_percentage NUMERIC,
    total_returns_value NUMERIC,
    total_position NUMERIC,
    daily_returns_percentage NUMERIC,
    daily_returns_value NUMERIC,
    uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portfolio_performance_metrics_strategy ON portfolio_performance_metrics(strategy_id);

-- Grant permissions
GRANT SELECT ON portfolio_ticker_mapping TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON portfolio_performance_metrics TO anon, authenticated;
