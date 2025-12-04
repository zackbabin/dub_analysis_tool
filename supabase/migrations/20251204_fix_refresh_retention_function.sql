-- Migration: Fix refresh_premium_creator_retention_analysis to use regular refresh
-- Created: 2025-12-04
-- Purpose: CONCURRENTLY requires a unique index, but the view doesn't have one
-- Solution: Use regular refresh (it's fast enough with 857 rows)

CREATE OR REPLACE FUNCTION refresh_premium_creator_retention_analysis()
RETURNS void AS $$
BEGIN
  -- Use regular refresh since we don't have a unique index for CONCURRENTLY
  -- With only 857 rows, regular refresh is fast and won't cause issues
  REFRESH MATERIALIZED VIEW premium_creator_retention_analysis;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION refresh_premium_creator_retention_analysis() TO service_role;

COMMENT ON FUNCTION refresh_premium_creator_retention_analysis IS
'Refreshes the premium_creator_retention_analysis materialized view. Uses regular refresh (not CONCURRENTLY) since the view has no unique index and data size is small (857 rows).';

-- Log migration
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Fixed refresh_premium_creator_retention_analysis function';
  RAISE NOTICE '   - Changed from CONCURRENTLY to regular refresh';
  RAISE NOTICE '   - CONCURRENTLY requires unique index (not available)';
  RAISE NOTICE '   - Regular refresh is fast enough with 857 rows';
  RAISE NOTICE '';
END $$;
