-- Post-Migration Verification
-- Run this after completing steps 1-7 to verify everything is working correctly
-- This checks the state AFTER the table rename cutover (step 5)

-- ==============================================================================
-- CHECK 1: Verify Table Structure After Cutover
-- ==============================================================================

-- Current primary table (was v2, now renamed)
SELECT
  'subscribers_insights (current)' as table_name,
  COUNT(*) as total_rows,
  COUNT(DISTINCT distinct_id) as unique_users,
  MAX(updated_at) as latest_update,
  MIN(updated_at) as earliest_update
FROM subscribers_insights;

-- Backup table (was v1, now deprecated)
SELECT
  'subscribers_insights_v1_deprecated (backup)' as table_name,
  COUNT(*) as total_rows,
  COUNT(DISTINCT distinct_id) as unique_users,
  MAX(updated_at) as latest_update,
  MIN(updated_at) as earliest_update
FROM subscribers_insights_v1_deprecated;

-- ==============================================================================
-- CHECK 2: Verify Data Types After Column Changes
-- ==============================================================================

-- Verify investing_experience_years is now text (supports ranges like "3–5")
SELECT
  column_name,
  data_type,
  character_maximum_length,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'subscribers_insights'
AND column_name IN ('investing_experience_years', 'distinct_id', 'income', 'net_worth')
ORDER BY column_name;

-- Sample values to verify text ranges work
SELECT
  investing_experience_years,
  COUNT(*) as user_count
FROM subscribers_insights
WHERE investing_experience_years IS NOT NULL
GROUP BY investing_experience_years
ORDER BY user_count DESC
LIMIT 10;

-- ==============================================================================
-- CHECK 3: Verify main_analysis View is Current
-- ==============================================================================

-- Refresh main_analysis to ensure it has latest data
REFRESH MATERIALIZED VIEW main_analysis;

SELECT
  COUNT(*) as total_rows,
  COUNT(DISTINCT distinct_id) as unique_users,
  SUM(CASE WHEN did_copy = 1 THEN 1 ELSE 0 END) as users_with_copies,
  SUM(CASE WHEN did_subscribe = 1 THEN 1 ELSE 0 END) as users_with_subscriptions,
  AVG(total_copies) as avg_copies,
  AVG(total_deposits) as avg_deposits
FROM main_analysis;

-- ==============================================================================
-- CHECK 4: Verify Compatibility View Works
-- ==============================================================================

SELECT
  COUNT(*) as compat_view_rows,
  COUNT(DISTINCT distinct_id) as compat_unique_users
FROM subscribers_insights_compat;

-- Verify compat view matches main table
SELECT
  CASE
    WHEN (SELECT COUNT(*) FROM subscribers_insights) = (SELECT COUNT(*) FROM subscribers_insights_compat)
    THEN '✅ Compatibility view row count matches'
    ELSE '❌ Compatibility view row count mismatch'
  END as compat_check;

-- ==============================================================================
-- CHECK 5: Data Integrity
-- ==============================================================================

-- Check for NULL distinct_ids (should be 0)
SELECT
  COUNT(*) as null_distinct_ids,
  CASE
    WHEN COUNT(*) = 0 THEN '✅ No NULL distinct_ids'
    ELSE '❌ NULL distinct_ids found'
  END as status
FROM subscribers_insights
WHERE distinct_id IS NULL;

-- Check for duplicate distinct_ids (should be 0)
SELECT
  COUNT(*) as duplicate_count,
  CASE
    WHEN COUNT(*) = 0 THEN '✅ No duplicate distinct_ids'
    ELSE '❌ Duplicates found'
  END as status
FROM (
  SELECT distinct_id, COUNT(*) as cnt
  FROM subscribers_insights
  GROUP BY distinct_id
  HAVING COUNT(*) > 1
) duplicates;

-- ==============================================================================
-- CHECK 6: Recent Sync Activity
-- ==============================================================================

-- Check user properties sync (should have recent successful runs)
SELECT
  source,
  COUNT(*) as total_syncs,
  COUNT(CASE WHEN sync_status = 'completed' THEN 1 END) as successful_syncs,
  COUNT(CASE WHEN sync_status = 'failed' THEN 1 END) as failed_syncs,
  MAX(sync_completed_at) as latest_sync
FROM sync_logs
WHERE source = 'mixpanel_user_properties_v2'
AND sync_started_at > NOW() - INTERVAL '7 days'
GROUP BY source;

-- Check engagement sync
SELECT
  source,
  COUNT(*) as total_syncs,
  COUNT(CASE WHEN sync_status = 'completed' THEN 1 END) as successful_syncs,
  COUNT(CASE WHEN sync_status = 'failed' THEN 1 END) as failed_syncs,
  MAX(sync_completed_at) as latest_sync
FROM sync_logs
WHERE source LIKE '%engagement%'
AND sync_started_at > NOW() - INTERVAL '7 days'
GROUP BY source;

-- ==============================================================================
-- CHECK 7: Cron Jobs Status
-- ==============================================================================

SELECT
  jobid,
  jobname,
  schedule,
  active,
  CASE
    WHEN jobname LIKE '%v2%' OR jobname LIKE '%user-properties%' THEN '✅ V2 job'
    WHEN jobname LIKE '%v1%' THEN '⚠️ V1 job (should be disabled)'
    ELSE 'ℹ️ Other job'
  END as job_status
FROM cron.job
WHERE jobname LIKE '%mixpanel%'
ORDER BY jobname;

-- ==============================================================================
-- SUMMARY
-- ==============================================================================

DO $$
BEGIN
  RAISE NOTICE '✅ Post-Migration Verification Complete';
  RAISE NOTICE '';
  RAISE NOTICE '📋 Review the query results above to ensure:';
  RAISE NOTICE '  1. subscribers_insights has more recent data than backup';
  RAISE NOTICE '  2. investing_experience_years is TEXT type with range values';
  RAISE NOTICE '  3. main_analysis view refreshed successfully';
  RAISE NOTICE '  4. Compatibility view matches main table';
  RAISE NOTICE '  5. No NULL or duplicate distinct_ids';
  RAISE NOTICE '  6. Recent successful syncs for user properties';
  RAISE NOTICE '  7. Only v2 cron jobs are active';
  RAISE NOTICE '';
  RAISE NOTICE '✅ Migration from subscribers_insights_v2 to subscribers_insights complete!';
END $$;
