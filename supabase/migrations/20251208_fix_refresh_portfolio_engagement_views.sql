-- Migration: Fix refresh_portfolio_engagement_views to remove hidden_gems_portfolios
-- Created: 2025-12-08
-- Purpose: hidden_gems_portfolios was converted to regular view on 2025-11-28, no longer needs refresh
--
-- Background:
-- - hidden_gems_portfolios was converted from materialized to regular view in 20251128_convert_simple_materialized_views_to_regular.sql
-- - Regular views auto-update when underlying data changes
-- - Trying to refresh it as materialized view causes error: "hidden_gems_portfolios" is not a table or materialized view

CREATE OR REPLACE FUNCTION refresh_portfolio_engagement_views()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Refresh materialized views in dependency order

  -- Level 1: portfolio_creator_engagement_metrics (base view)
  REFRESH MATERIALIZED VIEW portfolio_creator_engagement_metrics;

  -- Note: hidden_gems_portfolios is now a REGULAR VIEW (converted 2025-11-28)
  -- It auto-updates when portfolio_creator_engagement_metrics refreshes - no manual refresh needed

  -- Note: All other views are REGULAR VIEWS (not materialized)
  -- They update automatically when underlying data changes - no refresh needed:
  -- - hidden_gems_portfolios (regular view, auto-updates)
  -- - premium_creator_breakdown (regular view, auto-updates)
  -- - premium_creator_summary_stats (regular view, auto-updates)
  -- - premium_creator_top_5_stocks (regular view, auto-updates)
  -- - top_stocks_all_premium_creators (regular view, auto-updates)
  -- - portfolio_breakdown_with_metrics (regular view, auto-updates)

  RETURN 'Successfully refreshed portfolio engagement materialized view';
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error refreshing views: %', SQLERRM;
END;
$$;

COMMENT ON FUNCTION refresh_portfolio_engagement_views() IS
'Refreshes only the materialized view that exists:
 1. portfolio_creator_engagement_metrics (base)

All other views including hidden_gems_portfolios are regular views and update automatically.
Called by refresh-materialized-views edge function and sync-creator-data.';

-- Log the changes
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Updated refresh_portfolio_engagement_views function';
  RAISE NOTICE '   - Only refreshes 1 materialized view: portfolio_creator_engagement_metrics';
  RAISE NOTICE '   - Removed hidden_gems_portfolios (converted to regular view on 2025-11-28)';
  RAISE NOTICE '   - All other views are regular and auto-update';
  RAISE NOTICE '';
END $$;
