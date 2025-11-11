-- Migration: Add refresh timestamp tracking to materialized views
-- Purpose: Track when each materialized view was last refreshed for debugging and monitoring
-- Impact: 100% additive - adds new column, does not modify existing data or logic
-- Date: 2025-11-10

-- Add last_refreshed_at column to each materialized view
-- This is a phantom column that gets updated by the refresh function
-- It helps debug data staleness and sync issues

-- Note: We cannot directly add columns to existing materialized views
-- Instead, we'll create a separate tracking table

CREATE TABLE IF NOT EXISTS materialized_view_refresh_log (
  view_name TEXT PRIMARY KEY,
  last_refreshed_at TIMESTAMPTZ NOT NULL,
  refresh_duration_ms INTEGER,
  rows_affected BIGINT,
  refreshed_by TEXT DEFAULT 'system'
);

-- Grant permissions
GRANT SELECT ON materialized_view_refresh_log TO anon, authenticated;

-- Create index for timestamp lookups
CREATE INDEX IF NOT EXISTS idx_mv_refresh_log_timestamp
ON materialized_view_refresh_log(last_refreshed_at DESC);

COMMENT ON TABLE materialized_view_refresh_log IS
'Tracks when each materialized view was last refreshed. Used for debugging data staleness and monitoring view freshness.';

-- Helper function to log refresh
CREATE OR REPLACE FUNCTION log_materialized_view_refresh(
  p_view_name TEXT,
  p_refresh_duration_ms INTEGER DEFAULT NULL,
  p_rows_affected BIGINT DEFAULT NULL
)
RETURNS void AS $$
BEGIN
  INSERT INTO materialized_view_refresh_log (view_name, last_refreshed_at, refresh_duration_ms, rows_affected)
  VALUES (p_view_name, NOW(), p_refresh_duration_ms, p_rows_affected)
  ON CONFLICT (view_name)
  DO UPDATE SET
    last_refreshed_at = NOW(),
    refresh_duration_ms = COALESCE(EXCLUDED.refresh_duration_ms, materialized_view_refresh_log.refresh_duration_ms),
    rows_affected = COALESCE(EXCLUDED.rows_affected, materialized_view_refresh_log.rows_affected);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION log_materialized_view_refresh IS
'Helper function to log when a materialized view was refreshed. Call this after refreshing any materialized view.';

-- Update existing refresh functions to log timestamps
-- This is additive - only adds logging, doesn't change refresh logic

-- 1. portfolio_creator_engagement_metrics
CREATE OR REPLACE FUNCTION refresh_portfolio_creator_engagement_metrics()
RETURNS void AS $$
DECLARE
  start_time TIMESTAMPTZ;
  end_time TIMESTAMPTZ;
  duration_ms INTEGER;
BEGIN
  start_time := clock_timestamp();
  REFRESH MATERIALIZED VIEW portfolio_creator_engagement_metrics;
  end_time := clock_timestamp();
  duration_ms := EXTRACT(MILLISECONDS FROM (end_time - start_time))::INTEGER;

  PERFORM log_materialized_view_refresh('portfolio_creator_engagement_metrics', duration_ms, NULL);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. premium_creator_breakdown
CREATE OR REPLACE FUNCTION refresh_premium_creator_breakdown_view()
RETURNS void AS $$
DECLARE
  start_time TIMESTAMPTZ;
  end_time TIMESTAMPTZ;
  duration_ms INTEGER;
BEGIN
  start_time := clock_timestamp();
  REFRESH MATERIALIZED VIEW premium_creator_breakdown;
  end_time := clock_timestamp();
  duration_ms := EXTRACT(MILLISECONDS FROM (end_time - start_time))::INTEGER;

  PERFORM log_materialized_view_refresh('premium_creator_breakdown', duration_ms, NULL);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. premium_creator_stock_holdings
CREATE OR REPLACE FUNCTION refresh_premium_creator_stock_holdings_view()
RETURNS void AS $$
DECLARE
  start_time TIMESTAMPTZ;
  end_time TIMESTAMPTZ;
  duration_ms INTEGER;
BEGIN
  start_time := clock_timestamp();
  REFRESH MATERIALIZED VIEW premium_creator_stock_holdings;
  end_time := clock_timestamp();
  duration_ms := EXTRACT(MILLISECONDS FROM (end_time - start_time))::INTEGER;

  PERFORM log_materialized_view_refresh('premium_creator_stock_holdings', duration_ms, NULL);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. top_stocks_all_premium_creators
CREATE OR REPLACE FUNCTION refresh_top_stocks_all_premium_creators_view()
RETURNS void AS $$
DECLARE
  start_time TIMESTAMPTZ;
  end_time TIMESTAMPTZ;
  duration_ms INTEGER;
BEGIN
  start_time := clock_timestamp();
  REFRESH MATERIALIZED VIEW top_stocks_all_premium_creators;
  end_time := clock_timestamp();
  duration_ms := EXTRACT(MILLISECONDS FROM (end_time - start_time))::INTEGER;

  PERFORM log_materialized_view_refresh('top_stocks_all_premium_creators', duration_ms, NULL);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. premium_creator_top_5_stocks
CREATE OR REPLACE FUNCTION refresh_premium_creator_top_5_stocks_view()
RETURNS void AS $$
DECLARE
  start_time TIMESTAMPTZ;
  end_time TIMESTAMPTZ;
  duration_ms INTEGER;
BEGIN
  start_time := clock_timestamp();
  REFRESH MATERIALIZED VIEW premium_creator_top_5_stocks;
  end_time := clock_timestamp();
  duration_ms := EXTRACT(MILLISECONDS FROM (end_time - start_time))::INTEGER;

  PERFORM log_materialized_view_refresh('premium_creator_top_5_stocks', duration_ms, NULL);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. hidden_gems_portfolios (if it exists)
CREATE OR REPLACE FUNCTION refresh_hidden_gems_portfolios()
RETURNS void AS $$
DECLARE
  start_time TIMESTAMPTZ;
  end_time TIMESTAMPTZ;
  duration_ms INTEGER;
BEGIN
  start_time := clock_timestamp();
  REFRESH MATERIALIZED VIEW hidden_gems_portfolios;
  end_time := clock_timestamp();
  duration_ms := EXTRACT(MILLISECONDS FROM (end_time - start_time))::INTEGER;

  PERFORM log_materialized_view_refresh('hidden_gems_portfolios', duration_ms, NULL);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. portfolio_breakdown_with_metrics (if it exists)
CREATE OR REPLACE FUNCTION refresh_portfolio_breakdown_view()
RETURNS void AS $$
DECLARE
  start_time TIMESTAMPTZ;
  end_time TIMESTAMPTZ;
  duration_ms INTEGER;
BEGIN
  start_time := clock_timestamp();
  REFRESH MATERIALIZED VIEW portfolio_breakdown_with_metrics;
  end_time := clock_timestamp();
  duration_ms := EXTRACT(MILLISECONDS FROM (end_time - start_time))::INTEGER;

  PERFORM log_materialized_view_refresh('portfolio_breakdown_with_metrics', duration_ms, NULL);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON TABLE materialized_view_refresh_log IS
'Logs refresh times for all materialized views. Query this table to check view freshness and debug data staleness issues.';
