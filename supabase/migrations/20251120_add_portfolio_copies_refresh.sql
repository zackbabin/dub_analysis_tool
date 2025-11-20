-- Add refresh function for user_portfolio_creator_copies materialized view
-- This should be called after syncing user_portfolio_creator_engagement

CREATE OR REPLACE FUNCTION refresh_portfolio_copies()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY user_portfolio_creator_copies;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to service_role (Edge Functions)
GRANT EXECUTE ON FUNCTION refresh_portfolio_copies() TO service_role;

COMMENT ON FUNCTION refresh_portfolio_copies() IS 'Refreshes user_portfolio_creator_copies materialized view. Call after syncing user_portfolio_creator_engagement.';
