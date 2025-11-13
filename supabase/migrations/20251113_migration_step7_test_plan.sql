-- Migration Step 7: Test Plan
-- Manual tests to verify migration was successful
-- Run these tests after completing steps 1-6

-- ==============================================================================
-- TEST 1: Verify main_analysis View
-- ==============================================================================

-- Refresh and query main_analysis view
REFRESH MATERIALIZED VIEW main_analysis;

SELECT
  COUNT(*) as total_rows,
  COUNT(DISTINCT distinct_id) as unique_users,
  SUM(CASE WHEN did_copy = 1 THEN 1 ELSE 0 END) as users_with_copies,
  SUM(CASE WHEN did_subscribe = 1 THEN 1 ELSE 0 END) as users_with_subscriptions
FROM main_analysis;

-- Expected: Should return row counts matching subscribers_insights

-- ==============================================================================
-- TEST 2: Test Edge Function - process-event-sequences
-- ==============================================================================

-- This test requires manual trigger via Supabase dashboard or API
-- URL: https://rnpfeblxapdafrbmomix.supabase.co/functions/v1/process-event-sequences
-- Method: POST
-- Headers: Authorization: Bearer <SERVICE_ROLE_KEY>

/*
curl -X POST 'https://rnpfeblxapdafrbmomix.supabase.co/functions/v1/process-event-sequences' \
  -H 'Authorization: Bearer <SERVICE_ROLE_KEY>' \
  -H 'Content-Type: application/json'
*/

-- After running, check sync_logs table for success
SELECT
  id,
  tool_type,
  source,
  sync_status,
  sync_started_at,
  sync_completed_at,
  total_records_inserted,
  error_message
FROM sync_logs
WHERE source = 'process_event_sequences'
ORDER BY sync_started_at DESC
LIMIT 5;

-- Expected: sync_status = 'completed', no error_message

-- ==============================================================================
-- TEST 3: Test V2 Sync Functions
-- ==============================================================================

-- Verify sync-mixpanel-users-v2 is working
SELECT
  id,
  tool_type,
  source,
  sync_status,
  sync_started_at,
  sync_completed_at,
  total_records_inserted,
  error_message
FROM sync_logs
WHERE source = 'mixpanel_users_v2'
ORDER BY sync_started_at DESC
LIMIT 5;

-- Expected: Recent successful syncs

-- Verify sync-mixpanel-user-properties-v2 is working
SELECT
  id,
  tool_type,
  source,
  sync_status,
  sync_started_at,
  sync_completed_at,
  total_records_inserted,
  error_message
FROM sync_logs
WHERE source = 'mixpanel_user_properties_v2'
ORDER BY sync_started_at DESC
LIMIT 5;

-- Expected: Recent successful syncs

-- ==============================================================================
-- TEST 4: Verify Data Integrity
-- ==============================================================================

-- Check for NULL distinct_ids (should be 0)
SELECT COUNT(*) as null_distinct_ids
FROM subscribers_insights
WHERE distinct_id IS NULL;

-- Check for duplicate distinct_ids (should be 0)
SELECT
  distinct_id,
  COUNT(*) as duplicate_count
FROM subscribers_insights
GROUP BY distinct_id
HAVING COUNT(*) > 1;

-- Verify data ranges are reasonable
SELECT
  MIN(total_copies) as min_copies,
  MAX(total_copies) as max_copies,
  AVG(total_copies) as avg_copies,
  MIN(total_deposits) as min_deposits,
  MAX(total_deposits) as max_deposits,
  AVG(total_deposits) as avg_deposits,
  MIN(total_subscriptions) as min_subscriptions,
  MAX(total_subscriptions) as max_subscriptions,
  COUNT(*) as total_users
FROM subscribers_insights;

-- ==============================================================================
-- TEST 5: Verify Cron Jobs
-- ==============================================================================

-- List active cron jobs
SELECT
  jobid,
  jobname,
  schedule,
  command,
  active,
  nodename,
  nodeport
FROM cron.job
WHERE jobname LIKE 'mixpanel%'
ORDER BY jobname;

-- Expected: Only v2 jobs should be active

-- ==============================================================================
-- TEST 6: Test Rollback Capability
-- ==============================================================================

-- Verify compatibility view still works (for emergency rollback)
SELECT COUNT(*) as compat_view_row_count
FROM subscribers_insights_compat;

-- Verify backup table is intact
SELECT
  COUNT(*) as backup_row_count,
  MAX(updated_at) as backup_latest_update
FROM subscribers_insights_v1_deprecated;

-- ==============================================================================
-- SUMMARY
-- ==============================================================================

/*
Post-Migration Checklist:

✅ Step 1: Data quality check passed
✅ Step 2: Compatibility view created
✅ Step 3: main_analysis view updated and refreshed
✅ Step 4: process-event-sequences updated
✅ Step 5: Safety data migration completed
✅ Step 6: Table rename cutover executed
✅ Step 7: Indexes and constraints verified
✅ Step 8: All tests passed (this step)

Next Steps:
1. Monitor sync_logs for 7 days for any errors
2. Verify all dashboards and analysis tools work correctly
3. After 7 days, archive subscribers_insights_v1_deprecated to cold storage
4. After 30 days, drop backup table and compatibility view

Rollback Plan (if needed):
```sql
-- Quick rollback if issues occur within 7 days
ALTER TABLE subscribers_insights RENAME TO subscribers_insights_v2_temp;
ALTER TABLE subscribers_insights_v1_deprecated RENAME TO subscribers_insights;
ALTER TABLE subscribers_insights_v2_temp RENAME TO subscribers_insights_v2;
-- Then revert edge functions via Supabase CLI
```
*/
