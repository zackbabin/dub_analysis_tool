-- Migration Step 5: Table Rename Cutover
-- This is the critical step that switches v2 to become the primary table
-- IMPORTANT: Run this only after verifying all previous steps completed successfully

-- ==============================================================================
-- SAFETY CHECKS - Verify before proceeding
-- ==============================================================================

-- Check 1: Verify v2 has data
DO $$
DECLARE
  v2_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v2_count FROM subscribers_insights_v2;

  IF v2_count = 0 THEN
    RAISE EXCEPTION '❌ ABORT: subscribers_insights_v2 is empty. Cannot proceed with migration.';
  ELSE
    RAISE NOTICE '✅ V2 has % records', v2_count;
  END IF;
END $$;

-- Check 2: Verify main_analysis view was updated
DO $$
DECLARE
  view_definition TEXT;
BEGIN
  SELECT pg_get_viewdef('main_analysis'::regclass, true) INTO view_definition;

  IF view_definition LIKE '%subscribers_insights_v2%' THEN
    RAISE NOTICE '✅ main_analysis view references subscribers_insights_v2';
  ELSE
    RAISE EXCEPTION '❌ ABORT: main_analysis view not yet updated to use v2';
  END IF;
END $$;

-- Check 3: Verify compatibility view exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'subscribers_insights_compat') THEN
    RAISE NOTICE '✅ Compatibility view exists for rollback safety';
  ELSE
    RAISE WARNING '⚠️ Compatibility view not found - rollback will be harder';
  END IF;
END $$;

-- ==============================================================================
-- PERFORM THE CUTOVER
-- ==============================================================================

-- Step 1: Rename old table to _v1_deprecated (backup)
ALTER TABLE subscribers_insights RENAME TO subscribers_insights_v1_deprecated;
RAISE NOTICE '✅ Renamed subscribers_insights → subscribers_insights_v1_deprecated';

-- Step 2: Rename v2 to become the primary table
ALTER TABLE subscribers_insights_v2 RENAME TO subscribers_insights;
RAISE NOTICE '✅ Renamed subscribers_insights_v2 → subscribers_insights';

-- Step 3: Update constraint names to match (for consistency)
ALTER TABLE subscribers_insights RENAME CONSTRAINT subscribers_insights_v2_pkey TO subscribers_insights_pkey;
ALTER TABLE subscribers_insights RENAME CONSTRAINT subscribers_insights_v2_distinct_id_key TO subscribers_insights_distinct_id_key;
RAISE NOTICE '✅ Updated constraint names';

-- Step 4: Update sequence ownership (if needed)
-- Note: v2 already has its own sequence, just rename it
ALTER SEQUENCE subscribers_insights_v2_id_seq RENAME TO subscribers_insights_id_seq;
RAISE NOTICE '✅ Renamed sequence';

-- ==============================================================================
-- POST-CUTOVER VERIFICATION
-- ==============================================================================

-- Verify table structure
SELECT
  'subscribers_insights (promoted from v2)' as table_name,
  COUNT(*) as total_rows,
  COUNT(DISTINCT distinct_id) as unique_users,
  MAX(updated_at) as latest_update
FROM subscribers_insights;

SELECT
  'subscribers_insights_v1_deprecated (backup)' as table_name,
  COUNT(*) as total_rows,
  COUNT(DISTINCT distinct_id) as unique_users,
  MAX(updated_at) as latest_update
FROM subscribers_insights_v1_deprecated;

-- Verify indexes exist on new primary table
SELECT
  schemaname,
  tablename,
  indexname
FROM pg_indexes
WHERE tablename = 'subscribers_insights'
ORDER BY indexname;

RAISE NOTICE '✅ CUTOVER COMPLETE - subscribers_insights now points to v2 data';
RAISE NOTICE '📋 Next steps:';
RAISE NOTICE '  1. Run step 6 to verify indexes and constraints';
RAISE NOTICE '  2. Run step 7 to test all edge functions';
RAISE NOTICE '  3. Monitor for 7 days before deleting v1_deprecated backup';
