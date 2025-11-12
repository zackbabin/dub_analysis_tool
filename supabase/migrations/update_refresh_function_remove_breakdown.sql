-- Update refresh function to remove premium_creator_breakdown refresh
-- premium_creator_breakdown is now a regular view (not materialized) so no refresh needed
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

  -- Note: premium_creator_breakdown is now a regular view (not materialized)
  -- so it doesn't need to be refreshed - it always shows current data

  RETURN 'Successfully refreshed portfolio engagement views';
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error refreshing views: %', SQLERRM;
END;
$$;

COMMENT ON FUNCTION refresh_portfolio_engagement_views() IS
'Refreshes portfolio_creator_engagement_metrics and hidden_gems_portfolios materialized views. premium_creator_breakdown is now a regular view and updates automatically. Uses non-CONCURRENT refresh for reliability. Called by refresh-engagement-views and sync-creator-data Edge Functions.';
