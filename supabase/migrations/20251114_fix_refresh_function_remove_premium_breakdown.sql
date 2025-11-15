-- Fix refresh_portfolio_engagement_views to remove premium_creator_breakdown
-- Problem: premium_creator_breakdown was converted to a regular view (not materialized)
--          but refresh function still tries to refresh it, causing 500 error
-- Solution: Remove premium_creator_breakdown from refresh list - regular views don't need refresh
-- Date: 2025-11-14

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

  -- premium_creator_breakdown is now a REGULAR VIEW (not materialized)
  -- Regular views don't need refreshing - they always show fresh data
  -- Removed: REFRESH MATERIALIZED VIEW premium_creator_breakdown;

  RETURN 'Successfully refreshed portfolio engagement views';
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error refreshing views: %', SQLERRM;
END;
$$;

COMMENT ON FUNCTION refresh_portfolio_engagement_views() IS
'Refreshes portfolio_creator_engagement_metrics and hidden_gems_portfolios materialized views. Uses non-CONCURRENT refresh for reliability. Note: premium_creator_breakdown is a regular view and does not need refreshing.';
