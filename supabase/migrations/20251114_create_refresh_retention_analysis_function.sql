-- Create refresh function for premium_creator_retention_analysis materialized view

CREATE OR REPLACE FUNCTION refresh_premium_creator_retention_analysis()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY premium_creator_retention_analysis;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION refresh_premium_creator_retention_analysis() TO service_role;

COMMENT ON FUNCTION refresh_premium_creator_retention_analysis IS
'Refreshes the premium_creator_retention_analysis materialized view. Safe to call - uses CONCURRENTLY to avoid blocking reads.';
