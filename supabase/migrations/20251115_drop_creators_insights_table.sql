-- Drop creators_insights table and related objects
-- This table is no longer used after moving to user-level engagement tracking
-- Date: 2025-11-15

-- ==============================================================================
-- SAFETY CHECK: Verify no critical dependencies exist
-- ==============================================================================

-- Check for views that depend on creators_insights
DO $$
DECLARE
  dependent_views TEXT;
BEGIN
  SELECT string_agg(DISTINCT dependent_view.relname, ', ')
  INTO dependent_views
  FROM pg_depend
  JOIN pg_rewrite ON pg_depend.objid = pg_rewrite.oid
  JOIN pg_class as dependent_view ON pg_rewrite.ev_class = dependent_view.oid
  JOIN pg_class as source_table ON pg_depend.refobjid = source_table.oid
  WHERE source_table.relname = 'creators_insights'
  AND dependent_view.relkind IN ('v', 'm') -- views and materialized views
  AND dependent_view.relname != 'creators_insights';

  IF dependent_views IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot drop creators_insights - the following views depend on it: %', dependent_views;
  ELSE
    RAISE NOTICE '✅ No dependent views found - safe to drop';
  END IF;
END $$;

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

-- What CASCADE will drop:
-- - All indexes on creators_insights (idx_creators_insights_*)
-- - All triggers on creators_insights (update_creators_insights_updated_at)
-- - Sequence: creators_insights_id_seq
-- - Any constraints on creators_insights
--
-- What CASCADE will NOT drop (verified):
-- - No views depend on creators_insights
-- - No foreign keys reference creators_insights
-- - No other tables depend on creators_insights

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
