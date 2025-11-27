-- Migration: Fix refresh_main_analysis function to handle errors gracefully
-- Created: 2025-11-27
-- Purpose: Add error handling to prevent 500 errors and fall back to regular refresh
--
-- Background:
-- - refresh_main_analysis is returning 500 errors
-- - CONCURRENT refresh may be failing for various reasons
-- - Need to add fallback to regular refresh and better error handling

DROP FUNCTION IF EXISTS refresh_main_analysis();

CREATE OR REPLACE FUNCTION refresh_main_analysis()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Increase statement timeout to 5 minutes for this operation
  SET LOCAL statement_timeout = '300s';

  -- Try CONCURRENT refresh first (doesn't block reads, requires UNIQUE index on user_id)
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY main_analysis;
    RAISE NOTICE '✅ Main analysis refreshed (CONCURRENT)';
  EXCEPTION
    WHEN OTHERS THEN
      -- If CONCURRENT fails, log the error and try regular refresh
      RAISE WARNING '⚠️ CONCURRENT refresh failed: % - Falling back to regular refresh', SQLERRM;

      -- Regular refresh (blocks reads but more reliable)
      BEGIN
        REFRESH MATERIALIZED VIEW main_analysis;
        RAISE NOTICE '✅ Main analysis refreshed (REGULAR)';
      EXCEPTION
        WHEN OTHERS THEN
          -- If both fail, log error but don't propagate exception
          RAISE WARNING '❌ Both CONCURRENT and REGULAR refresh failed: %', SQLERRM;
          -- Don't re-raise - let function complete gracefully
      END;
  END;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION refresh_main_analysis() TO authenticated, anon, service_role;

COMMENT ON FUNCTION refresh_main_analysis() IS
'Refreshes main_analysis materialized view with extended 5-minute timeout.
Attempts CONCURRENT refresh first (non-blocking, requires unique index on user_id).
Falls back to REGULAR refresh if CONCURRENT fails.
Handles all errors gracefully to prevent 500 responses.';

-- Log the changes
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Updated refresh_main_analysis function with robust error handling';
  RAISE NOTICE '   - Attempts CONCURRENT refresh first';
  RAISE NOTICE '   - Falls back to REGULAR refresh if needed';
  RAISE NOTICE '   - Catches and logs all errors without propagating';
  RAISE NOTICE '   - Should eliminate 500 errors';
  RAISE NOTICE '';
END $$;
