-- Migration: Fix refresh_portfolio_engagement_views to skip regular views
-- Created: 2025-11-22
-- Purpose: Remove premium_creator_top_5_stocks from refresh function (now a regular view)
--
-- Issue: Error "premium_creator_top_5_stocks" is not a table or materialized view
-- premium_creator_top_5_stocks was converted to a regular VIEW in restore_all_premium_creator_views.sql
-- Regular views don't need refreshing - they update automatically

CREATE OR REPLACE FUNCTION refresh_portfolio_engagement_views()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Refresh materialized views in dependency order

  -- Level 1: portfolio_creator_engagement_metrics (base view)
  REFRESH MATERIALIZED VIEW portfolio_creator_engagement_metrics;

  -- Level 2: hidden_gems_portfolios (depends on portfolio_creator_engagement_metrics)
  REFRESH MATERIALIZED VIEW hidden_gems_portfolios;

  -- Level 2: premium_creator_stock_holdings (depends on portfolio_creator_engagement_metrics)
  REFRESH MATERIALIZED VIEW premium_creator_stock_holdings;

  -- Level 3: top_stocks_all_premium_creators (depends on premium_creator_stock_holdings)
  REFRESH MATERIALIZED VIEW top_stocks_all_premium_creators;

  -- Note: premium_creator_top_5_stocks is now a REGULAR VIEW (not materialized)
  -- It updates automatically when underlying data changes - no refresh needed

  RETURN 'Successfully refreshed portfolio engagement views and stock holdings views';
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error refreshing views: %', SQLERRM;
END;
$$;

COMMENT ON FUNCTION refresh_portfolio_engagement_views() IS
'Refreshes portfolio engagement and stock holdings materialized views in dependency order:
 1. portfolio_creator_engagement_metrics (base)
 2. hidden_gems_portfolios (depends on 1)
 3. premium_creator_stock_holdings (depends on 1)
 4. top_stocks_all_premium_creators (depends on 3)

Note: premium_creator_top_5_stocks is a regular view - no refresh needed.
Called by refresh-materialized-views edge function and upload-portfolio-metrics.';
