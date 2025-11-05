-- Update refresh_portfolio_engagement_views to include premium_creator_breakdown

CREATE OR REPLACE FUNCTION refresh_portfolio_engagement_views()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Refresh portfolio_creator_engagement_metrics (this has new premium data)
  REFRESH MATERIALIZED VIEW CONCURRENTLY portfolio_creator_engagement_metrics;

  -- Refresh dependent view (hidden_gems_portfolios depends on portfolio_creator_engagement_metrics)
  REFRESH MATERIALIZED VIEW CONCURRENTLY hidden_gems_portfolios;

  -- Refresh premium_creator_breakdown (depends on portfolio_creator_engagement_metrics, premium_creator_metrics, and portfolio_breakdown_with_metrics)
  REFRESH MATERIALIZED VIEW CONCURRENTLY premium_creator_breakdown;

  RETURN 'Successfully refreshed portfolio engagement views';
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error refreshing views: %', SQLERRM;
END;
$$;

COMMENT ON FUNCTION refresh_portfolio_engagement_views() IS
'Refreshes portfolio_creator_engagement_metrics, hidden_gems_portfolios, and premium_creator_breakdown materialized views. Called by sync-creator-data Edge Function after syncing premium creator portfolio metrics.';
