-- Simple cleanup: Just delete creator_id 118 and let next sync repopulate with correct id
-- This is safer than trying to merge data that may be inconsistent

-- Step 1: Delete creator_id 118 from premium_creators
DELETE FROM premium_creators
WHERE creator_id = '118'
AND creator_username = '@dubAdvisors';

-- Step 2: Delete all engagement data for creator_id 118
-- (Next Mixpanel sync will repopulate with correct creator_id)
DELETE FROM user_portfolio_creator_engagement
WHERE creator_id = '118';

DELETE FROM user_creator_engagement
WHERE creator_id = '118';

DELETE FROM premium_creator_metrics
WHERE creator_id = '118';

-- Step 3: Refresh materialized views
REFRESH MATERIALIZED VIEW portfolio_creator_engagement_metrics;
REFRESH MATERIALIZED VIEW premium_creator_breakdown;

-- Step 4: Verify cleanup
SELECT
  'premium_creators' as table_name,
  COUNT(*) as dubadvisors_count
FROM premium_creators
WHERE creator_username = '@dubAdvisors'
UNION ALL
SELECT
  'premium_creator_breakdown',
  COUNT(*)
FROM premium_creator_breakdown
WHERE creator_username = '@dubAdvisors'
UNION ALL
SELECT
  'Total creators in breakdown',
  COUNT(*)
FROM premium_creator_breakdown;

-- Expected:
-- premium_creators: 1
-- premium_creator_breakdown: 1
-- Total creators: 20
