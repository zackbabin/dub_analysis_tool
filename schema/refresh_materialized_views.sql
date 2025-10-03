-- Helper functions to refresh materialized views
-- This allows edge functions to refresh the materialized views programmatically

CREATE OR REPLACE FUNCTION refresh_subscription_engagement_summary()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW subscription_engagement_summary;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_copy_engagement_summary()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW copy_engagement_summary;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_hidden_gems()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW portfolio_creator_engagement_metrics;
  REFRESH MATERIALIZED VIEW hidden_gems_portfolios;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION refresh_subscription_engagement_summary() TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION refresh_copy_engagement_summary() TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION refresh_hidden_gems() TO authenticated, anon, service_role;
