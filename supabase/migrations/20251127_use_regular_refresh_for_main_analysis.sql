-- Migration: Use regular refresh for main_analysis instead of concurrent
-- Created: 2025-11-27
-- Purpose: Eliminate 500 errors by using reliable REGULAR refresh
--
-- Background:
-- - CONCURRENT refresh was failing with 500 errors
-- - REGULAR refresh works perfectly (confirmed with 24,978 rows)
-- - CONCURRENT is nice-to-have (non-blocking) but not required
-- - REGULAR refresh with 5min timeout is sufficient for this use case

DROP FUNCTION IF EXISTS refresh_main_analysis();

CREATE OR REPLACE FUNCTION refresh_main_analysis()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Increase statement timeout to 5 minutes for this operation
  SET LOCAL statement_timeout = '300s';

  -- Use REGULAR refresh (blocking but reliable)
  -- CONCURRENT refresh was causing 500 errors, and blocking is acceptable
  -- during sync workflow since users aren't actively querying during refresh
  REFRESH MATERIALIZED VIEW main_analysis;

  RAISE NOTICE '✅ Main analysis refreshed (rows: %)', (SELECT COUNT(*) FROM main_analysis);
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION refresh_main_analysis() TO authenticated, anon, service_role;

COMMENT ON FUNCTION refresh_main_analysis() IS
'Refreshes main_analysis materialized view with extended 5-minute timeout.
Uses REGULAR refresh (blocking) instead of CONCURRENT to ensure reliability.
Called after all source tables (subscribers_insights, user_portfolio_creator_engagement) are updated.';

-- Log the changes
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Updated refresh_main_analysis to use REGULAR refresh';
  RAISE NOTICE '   - Removed CONCURRENT refresh (was causing 500 errors)';
  RAISE NOTICE '   - REGULAR refresh is reliable and tested';
  RAISE NOTICE '   - Blocking is acceptable during sync workflow';
  RAISE NOTICE '   - Added row count logging';
  RAISE NOTICE '';
END $$;
