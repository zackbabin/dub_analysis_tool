-- Drop creators_insights table and related objects
-- This table is no longer used after moving to user-level engagement tracking
-- Date: 2025-11-15

-- ==============================================================================
-- STEP 1: Show what will be deleted (safety check)
-- ==============================================================================

SELECT
  'creators_insights' as table_name,
  COUNT(*) as row_count,
  pg_size_pretty(pg_total_relation_size('creators_insights')) as table_size
FROM creators_insights;

-- ==============================================================================
-- STEP 2: Drop dependent function first
-- ==============================================================================

-- Drop upload_creator_data function (references creators_insights)
DROP FUNCTION IF EXISTS upload_creator_data(jsonb[]);

COMMENT ON FUNCTION upload_creator_data IS NULL; -- Remove if exists

-- ==============================================================================
-- STEP 3: Drop the table (CASCADE will drop indexes, triggers, constraints)
-- ==============================================================================

DROP TABLE IF EXISTS creators_insights CASCADE;

-- ==============================================================================
-- STEP 4: Verify deletion
-- ==============================================================================

-- Check if table still exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public'
    AND tablename = 'creators_insights'
  ) THEN
    RAISE EXCEPTION '⚠️ creators_insights table still exists!';
  ELSE
    RAISE NOTICE '✅ creators_insights table successfully dropped';
  END IF;
END $$;

-- Check if function still exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
    AND p.proname = 'upload_creator_data'
  ) THEN
    RAISE EXCEPTION '⚠️ upload_creator_data function still exists!';
  ELSE
    RAISE NOTICE '✅ upload_creator_data function successfully dropped';
  END IF;
END $$;

-- ==============================================================================
-- SUMMARY
-- ==============================================================================

DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ Cleanup complete:';
  RAISE NOTICE '   - creators_insights table dropped';
  RAISE NOTICE '   - upload_creator_data() function dropped';
  RAISE NOTICE '   - All indexes, triggers, constraints dropped (CASCADE)';
  RAISE NOTICE '========================================';
END $$;
