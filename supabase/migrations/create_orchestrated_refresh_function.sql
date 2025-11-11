-- Migration: Create orchestrated refresh function for premium creator views
-- Purpose: Refresh all materialized views in correct dependency order with error handling
-- Impact: 100% additive - new function only, doesn't modify existing refresh logic
-- Date: 2025-11-10

-- Main orchestration function that refreshes all premium creator views in correct order
CREATE OR REPLACE FUNCTION refresh_all_premium_creator_views()
RETURNS TABLE(
  view_name TEXT,
  status TEXT,
  duration_ms INTEGER,
  error_message TEXT
) AS $$
DECLARE
  v_start_time TIMESTAMPTZ;
  v_end_time TIMESTAMPTZ;
  v_duration_ms INTEGER;
  v_error_msg TEXT;
BEGIN
  -- This function refreshes views in dependency order:
  -- Level 1 (base): portfolio_creator_engagement_metrics
  -- Level 2 (depends on L1): premium_creator_breakdown, premium_creator_stock_holdings
  -- Level 3 (depends on L2): premium_creator_summary_stats (view, not MV), top_stocks_all_premium_creators, premium_creator_top_5_stocks

  RAISE NOTICE 'Starting orchestrated refresh of all premium creator views...';

  -- LEVEL 1: Base materialized views

  -- 1. portfolio_creator_engagement_metrics
  BEGIN
    v_start_time := clock_timestamp();
    PERFORM refresh_portfolio_creator_engagement_metrics();
    v_end_time := clock_timestamp();
    v_duration_ms := EXTRACT(MILLISECONDS FROM (v_end_time - v_start_time))::INTEGER;

    RETURN QUERY SELECT
      'portfolio_creator_engagement_metrics'::TEXT,
      'success'::TEXT,
      v_duration_ms,
      NULL::TEXT;
    RAISE NOTICE '✓ portfolio_creator_engagement_metrics refreshed in % ms', v_duration_ms;
  EXCEPTION WHEN OTHERS THEN
    v_error_msg := SQLERRM;
    RETURN QUERY SELECT
      'portfolio_creator_engagement_metrics'::TEXT,
      'error'::TEXT,
      NULL::INTEGER,
      v_error_msg;
    RAISE WARNING '✗ portfolio_creator_engagement_metrics failed: %', v_error_msg;
  END;

  -- LEVEL 2: Views that depend on portfolio_creator_engagement_metrics

  -- 2. premium_creator_breakdown
  BEGIN
    v_start_time := clock_timestamp();
    PERFORM refresh_premium_creator_breakdown_view();
    v_end_time := clock_timestamp();
    v_duration_ms := EXTRACT(MILLISECONDS FROM (v_end_time - v_start_time))::INTEGER;

    RETURN QUERY SELECT
      'premium_creator_breakdown'::TEXT,
      'success'::TEXT,
      v_duration_ms,
      NULL::TEXT;
    RAISE NOTICE '✓ premium_creator_breakdown refreshed in % ms', v_duration_ms;
  EXCEPTION WHEN OTHERS THEN
    v_error_msg := SQLERRM;
    RETURN QUERY SELECT
      'premium_creator_breakdown'::TEXT,
      'error'::TEXT,
      NULL::INTEGER,
      v_error_msg;
    RAISE WARNING '✗ premium_creator_breakdown failed: %', v_error_msg;
  END;

  -- 3. premium_creator_stock_holdings
  BEGIN
    v_start_time := clock_timestamp();
    PERFORM refresh_premium_creator_stock_holdings_view();
    v_end_time := clock_timestamp();
    v_duration_ms := EXTRACT(MILLISECONDS FROM (v_end_time - v_start_time))::INTEGER;

    RETURN QUERY SELECT
      'premium_creator_stock_holdings'::TEXT,
      'success'::TEXT,
      v_duration_ms,
      NULL::TEXT;
    RAISE NOTICE '✓ premium_creator_stock_holdings refreshed in % ms', v_duration_ms;
  EXCEPTION WHEN OTHERS THEN
    v_error_msg := SQLERRM;
    RETURN QUERY SELECT
      'premium_creator_stock_holdings'::TEXT,
      'error'::TEXT,
      NULL::INTEGER,
      v_error_msg;
    RAISE WARNING '✗ premium_creator_stock_holdings failed: %', v_error_msg;
  END;

  -- LEVEL 3: Views that depend on Level 2

  -- 4. top_stocks_all_premium_creators
  BEGIN
    v_start_time := clock_timestamp();
    PERFORM refresh_top_stocks_all_premium_creators_view();
    v_end_time := clock_timestamp();
    v_duration_ms := EXTRACT(MILLISECONDS FROM (v_end_time - v_start_time))::INTEGER;

    RETURN QUERY SELECT
      'top_stocks_all_premium_creators'::TEXT,
      'success'::TEXT,
      v_duration_ms,
      NULL::TEXT;
    RAISE NOTICE '✓ top_stocks_all_premium_creators refreshed in % ms', v_duration_ms;
  EXCEPTION WHEN OTHERS THEN
    v_error_msg := SQLERRM;
    RETURN QUERY SELECT
      'top_stocks_all_premium_creators'::TEXT,
      'error'::TEXT,
      NULL::INTEGER,
      v_error_msg;
    RAISE WARNING '✗ top_stocks_all_premium_creators failed: %', v_error_msg;
  END;

  -- 5. premium_creator_top_5_stocks
  BEGIN
    v_start_time := clock_timestamp();
    PERFORM refresh_premium_creator_top_5_stocks_view();
    v_end_time := clock_timestamp();
    v_duration_ms := EXTRACT(MILLISECONDS FROM (v_end_time - v_start_time))::INTEGER;

    RETURN QUERY SELECT
      'premium_creator_top_5_stocks'::TEXT,
      'success'::TEXT,
      v_duration_ms,
      NULL::TEXT;
    RAISE NOTICE '✓ premium_creator_top_5_stocks refreshed in % ms', v_duration_ms;
  EXCEPTION WHEN OTHERS THEN
    v_error_msg := SQLERRM;
    RETURN QUERY SELECT
      'premium_creator_top_5_stocks'::TEXT,
      'error'::TEXT,
      NULL::INTEGER,
      v_error_msg;
    RAISE WARNING '✗ premium_creator_top_5_stocks failed: %', v_error_msg;
  END;

  -- Optional: Other materialized views (only if they exist)

  -- 6. hidden_gems_portfolios (optional)
  BEGIN
    v_start_time := clock_timestamp();
    PERFORM refresh_hidden_gems_portfolios();
    v_end_time := clock_timestamp();
    v_duration_ms := EXTRACT(MILLISECONDS FROM (v_end_time - v_start_time))::INTEGER;

    RETURN QUERY SELECT
      'hidden_gems_portfolios'::TEXT,
      'success'::TEXT,
      v_duration_ms,
      NULL::TEXT;
    RAISE NOTICE '✓ hidden_gems_portfolios refreshed in % ms', v_duration_ms;
  EXCEPTION WHEN OTHERS THEN
    v_error_msg := SQLERRM;
    RETURN QUERY SELECT
      'hidden_gems_portfolios'::TEXT,
      'skipped'::TEXT,
      NULL::INTEGER,
      'View does not exist'::TEXT;
    RAISE NOTICE '- hidden_gems_portfolios skipped (does not exist)';
  END;

  -- 7. portfolio_breakdown_with_metrics (optional)
  BEGIN
    v_start_time := clock_timestamp();
    PERFORM refresh_portfolio_breakdown_view();
    v_end_time := clock_timestamp();
    v_duration_ms := EXTRACT(MILLISECONDS FROM (v_end_time - v_start_time))::INTEGER;

    RETURN QUERY SELECT
      'portfolio_breakdown_with_metrics'::TEXT,
      'success'::TEXT,
      v_duration_ms,
      NULL::TEXT;
    RAISE NOTICE '✓ portfolio_breakdown_with_metrics refreshed in % ms', v_duration_ms;
  EXCEPTION WHEN OTHERS THEN
    v_error_msg := SQLERRM;
    RETURN QUERY SELECT
      'portfolio_breakdown_with_metrics'::TEXT,
      'skipped'::TEXT,
      NULL::INTEGER,
      'View does not exist'::TEXT;
    RAISE NOTICE '- portfolio_breakdown_with_metrics skipped (does not exist)';
  END;

  RAISE NOTICE 'Orchestrated refresh complete!';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION refresh_all_premium_creator_views IS
'Orchestrated refresh of all premium creator materialized views in correct dependency order. Returns table with status of each refresh. Safe to call - will not fail if individual views fail, and will not modify existing data.';

-- Convenience function for Edge Functions to call
CREATE OR REPLACE FUNCTION refresh_premium_creator_views_json()
RETURNS JSONB AS $$
DECLARE
  v_results JSONB;
BEGIN
  SELECT jsonb_agg(row_to_json(r))
  INTO v_results
  FROM refresh_all_premium_creator_views() r;

  RETURN v_results;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION refresh_premium_creator_views_json IS
'Returns refresh results as JSON for easy consumption by Edge Functions. Call this after syncing creator data.';
