-- Increase statement timeout for main_analysis refresh to handle large datasets
-- The main_analysis materialized view refresh was timing out due to:
-- 1. Large user_portfolio_creator_engagement table
-- 2. Expensive COUNT(DISTINCT) operations on creator_id and portfolio_ticker
-- 3. GROUP BY on distinct_id
-- Date: 2025-11-16

-- Drop and recreate refresh_main_analysis with increased timeout
CREATE OR REPLACE FUNCTION refresh_main_analysis()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Increase statement timeout to 5 minutes for this operation
  SET LOCAL statement_timeout = '300s';

  REFRESH MATERIALIZED VIEW main_analysis;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION refresh_main_analysis() TO authenticated, anon, service_role;

COMMENT ON FUNCTION refresh_main_analysis() IS
'Refreshes main_analysis materialized view with extended 5-minute timeout to handle large datasets and expensive aggregations on user_portfolio_creator_engagement table.';
