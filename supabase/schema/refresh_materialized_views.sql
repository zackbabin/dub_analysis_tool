-- Helper function to refresh materialized views
-- This allows edge functions to refresh the materialized view programmatically

CREATE OR REPLACE FUNCTION refresh_subscription_engagement_summary()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW subscription_engagement_summary;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION refresh_subscription_engagement_summary() TO authenticated, anon, service_role;
