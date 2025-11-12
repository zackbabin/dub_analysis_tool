-- Fix refresh function to use non-concurrent refresh
-- Problem: CONCURRENT refresh failing with "cannot refresh materialized view concurrently"
--          This happens when unique index is missing or has duplicate rows
-- Solution: Use non-CONCURRENT refresh which doesn't require unique index
--          Trade-off: Brief lock during refresh (acceptable for admin sync operations)
-- Date: 2025-11-12

CREATE OR REPLACE FUNCTION refresh_portfolio_engagement_views()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Use non-CONCURRENT refresh (brief lock but guaranteed to work)
  -- portfolio_creator_engagement_metrics depends on user_portfolio_creator_engagement
  REFRESH MATERIALIZED VIEW portfolio_creator_engagement_metrics;

  -- hidden_gems_portfolios depends on portfolio_creator_engagement_metrics
  REFRESH MATERIALIZED VIEW hidden_gems_portfolios;

  -- premium_creator_breakdown depends on multiple sources including portfolio_creator_engagement_metrics
  REFRESH MATERIALIZED VIEW premium_creator_breakdown;

  RETURN 'Successfully refreshed portfolio engagement views';
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error refreshing views: %', SQLERRM;
END;
$$;

COMMENT ON FUNCTION refresh_portfolio_engagement_views() IS
'Refreshes portfolio_creator_engagement_metrics, hidden_gems_portfolios, and premium_creator_breakdown materialized views. Uses non-CONCURRENT refresh for reliability. Called by sync-creator-data Edge Function after syncing premium creator portfolio metrics.';
