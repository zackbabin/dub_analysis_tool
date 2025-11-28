-- Migration: Fix refresh_portfolio_engagement_views to only refresh existing views
-- Created: 2025-11-27
-- Purpose: Remove references to premium_creator_stock_holdings and top_stocks_all_premium_creators
--
-- Background:
-- - premium_creator_stock_holdings does not exist (never created)
-- - top_stocks_all_premium_creators is a REGULAR VIEW (not materialized) - no refresh needed
-- - Only need to refresh the 2 materialized views that actually exist

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

  -- Note: All other views are REGULAR VIEWS (not materialized)
  -- They update automatically when underlying data changes - no refresh needed:
  -- - premium_creator_breakdown
  -- - premium_creator_summary_stats
  -- - premium_creator_top_5_stocks
  -- - top_stocks_all_premium_creators
  -- - portfolio_breakdown_with_metrics

  RETURN 'Successfully refreshed portfolio engagement materialized views';
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error refreshing views: %', SQLERRM;
END;
$$;

COMMENT ON FUNCTION refresh_portfolio_engagement_views() IS
'Refreshes only the materialized views that exist:
 1. portfolio_creator_engagement_metrics (base)
 2. hidden_gems_portfolios (depends on 1)

All other views are regular views and update automatically.
Called by refresh-materialized-views edge function and upload-portfolio-metrics.';

-- Log the changes
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Updated refresh_portfolio_engagement_views function';
  RAISE NOTICE '   - Only refreshes 2 materialized views that exist:';
  RAISE NOTICE '     1. portfolio_creator_engagement_metrics';
  RAISE NOTICE '     2. hidden_gems_portfolios';
  RAISE NOTICE '   - Removed premium_creator_stock_holdings (does not exist)';
  RAISE NOTICE '   - Removed top_stocks_all_premium_creators (regular view, not materialized)';
  RAISE NOTICE '';
END $$;
