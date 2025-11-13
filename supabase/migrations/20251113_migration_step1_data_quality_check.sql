-- Migration Step 1: Data Quality Check
-- Compare subscribers_insights vs subscribers_insights_v2
-- Run this first to ensure v2 has complete data

-- Check 1: Row counts
SELECT
  'subscribers_insights' as table_name,
  COUNT(*) as total_rows,
  COUNT(DISTINCT distinct_id) as unique_users,
  MAX(updated_at) as latest_update
FROM subscribers_insights

UNION ALL

SELECT
  'subscribers_insights_v2' as table_name,
  COUNT(*) as total_rows,
  COUNT(DISTINCT distinct_id) as unique_users,
  MAX(updated_at) as latest_update
FROM subscribers_insights_v2;

-- Check 2: Find distinct_ids in v1 but not in v2 (should be empty or very few)
SELECT
  COUNT(*) as users_in_v1_not_in_v2,
  CASE
    WHEN COUNT(*) = 0 THEN '✅ All v1 users exist in v2'
    WHEN COUNT(*) < 100 THEN '⚠️ Few users missing - will migrate'
    ELSE '❌ Many users missing - investigate before migrating'
  END as status
FROM subscribers_insights v1
LEFT JOIN subscribers_insights_v2 v2 ON v1.distinct_id = v2.distinct_id
WHERE v2.distinct_id IS NULL;

-- Check 3: Sample data comparison (first 5 users)
SELECT
  'v1' as version,
  distinct_id,
  total_copies,
  total_deposits,
  total_subscriptions,
  linked_bank_account,
  updated_at
FROM subscribers_insights
ORDER BY updated_at DESC
LIMIT 5;

SELECT
  'v2' as version,
  distinct_id,
  total_copies,
  total_deposits,
  total_subscriptions,
  linked_bank_account,
  updated_at
FROM subscribers_insights_v2
ORDER BY updated_at DESC
LIMIT 5;

-- Check 4: Verify v2 has recent data (within last 24 hours)
SELECT
  CASE
    WHEN MAX(updated_at) > NOW() - INTERVAL '24 hours' THEN '✅ V2 has recent data'
    ELSE '❌ V2 data is stale - run sync first'
  END as data_freshness,
  MAX(updated_at) as latest_update,
  NOW() - MAX(updated_at) as time_since_update
FROM subscribers_insights_v2;
