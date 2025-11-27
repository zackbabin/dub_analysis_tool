-- Migration: Diagnose main_analysis refresh issues
-- Created: 2025-11-27
-- Purpose: Add logging and diagnostics to understand why refresh is failing
--
-- This migration doesn't change functionality - it adds diagnostics

-- Check current state of main_analysis
DO $$
DECLARE
  row_count INTEGER;
  index_valid BOOLEAN;
  view_definition TEXT;
BEGIN
  -- Count rows in main_analysis
  SELECT COUNT(*) INTO row_count FROM main_analysis;
  RAISE NOTICE 'main_analysis current row count: %', row_count;

  -- Check if unique index exists and is valid
  SELECT indisvalid INTO index_valid
  FROM pg_index i
  JOIN pg_class c ON i.indexrelid = c.oid
  WHERE c.relname = 'idx_main_analysis_user_id';

  IF index_valid THEN
    RAISE NOTICE '✅ Unique index idx_main_analysis_user_id is VALID';
  ELSE
    RAISE NOTICE '❌ Unique index idx_main_analysis_user_id is INVALID or missing';
  END IF;

  -- Check for duplicate user_ids (would prevent CONCURRENT refresh)
  EXECUTE '
    SELECT COUNT(*)
    FROM (
      SELECT user_id, COUNT(*) as cnt
      FROM main_analysis
      GROUP BY user_id
      HAVING COUNT(*) > 1
    ) dupes
  ' INTO row_count;

  IF row_count > 0 THEN
    RAISE NOTICE '❌ Found % duplicate user_id values in main_analysis!', row_count;
  ELSE
    RAISE NOTICE '✅ No duplicate user_ids found';
  END IF;

END $$;

-- Test if regular refresh works
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '🔄 Testing REGULAR refresh (non-concurrent)...';
  BEGIN
    REFRESH MATERIALIZED VIEW main_analysis;
    RAISE NOTICE '✅ REGULAR refresh succeeded';
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE '❌ REGULAR refresh failed: %', SQLERRM;
  END;
END $$;

-- Test if concurrent refresh works
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '🔄 Testing CONCURRENT refresh...';
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY main_analysis;
    RAISE NOTICE '✅ CONCURRENT refresh succeeded';
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE '❌ CONCURRENT refresh failed: %', SQLERRM;
      RAISE NOTICE '   This is why the function returns 500 errors';
  END;
END $$;
