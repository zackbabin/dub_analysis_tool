-- Migration: Simple check of main_analysis data
-- Created: 2025-11-27
-- Purpose: Verify if main_analysis has data and if source tables have data

-- Check source tables first
SELECT 'subscribers_insights' as table_name, COUNT(*) as row_count FROM subscribers_insights
UNION ALL
SELECT 'user_portfolio_creator_engagement', COUNT(*) FROM user_portfolio_creator_engagement
UNION ALL
SELECT 'main_analysis', COUNT(*) FROM main_analysis;

-- Check if main_analysis view definition is valid
SELECT
  schemaname,
  matviewname,
  ispopulated
FROM pg_matviews
WHERE matviewname = 'main_analysis';

-- Try to manually refresh and see what happens
DO $$
BEGIN
  RAISE NOTICE 'Attempting manual refresh of main_analysis...';
  REFRESH MATERIALIZED VIEW main_analysis;
  RAISE NOTICE '✅ Manual refresh succeeded!';
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE '❌ Manual refresh failed: %', SQLERRM;
    RAISE NOTICE '   Error detail: %', SQLSTATE;
END $$;

-- Check row count after refresh attempt
SELECT COUNT(*) as main_analysis_rows_after_refresh FROM main_analysis;
