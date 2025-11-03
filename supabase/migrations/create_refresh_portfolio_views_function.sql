-- Migration: Create RPC function to refresh portfolio engagement materialized views
-- Date: 2025-11-03
-- Purpose: Callable from Edge Functions to refresh views after data sync

-- ============================================================================
-- Create function to refresh materialized views
-- ============================================================================
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

  RETURN 'Successfully refreshed portfolio engagement views';
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error refreshing views: %', SQLERRM;
END;
$$;

-- Grant execute permission to service role (used by Edge Functions)
GRANT EXECUTE ON FUNCTION refresh_portfolio_engagement_views() TO service_role;

COMMENT ON FUNCTION refresh_portfolio_engagement_views() IS
'Refreshes portfolio_creator_engagement_metrics and hidden_gems_portfolios materialized views. Called by sync-creator-data Edge Function after syncing premium creator portfolio metrics.';

-- ============================================================================
-- Test the function
-- ============================================================================
-- SELECT refresh_portfolio_engagement_views();
