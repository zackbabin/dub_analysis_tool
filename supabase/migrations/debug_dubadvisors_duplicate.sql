-- Debug: Check for duplicate @dubAdvisors entries

-- Step 1: Check premium_creators table for dubAdvisors
SELECT 'premium_creators table' as source, creator_id, creator_username, COUNT(*)
FROM premium_creators
WHERE creator_username = '@dubAdvisors'
GROUP BY creator_id, creator_username;

-- Step 2: Check which creator_id(s) have engagement data
SELECT 'user_portfolio_creator_engagement' as source,
       upce.creator_id,
       upce.creator_username,
       COUNT(DISTINCT distinct_id) as unique_users,
       SUM(CASE WHEN did_copy THEN 1 ELSE 0 END) as copiers
FROM user_portfolio_creator_engagement upce
WHERE upce.creator_username = '@dubAdvisors'
GROUP BY upce.creator_id, upce.creator_username;

-- Step 3: Check premium_creator_copiers CTE logic
WITH premium_creators_list AS (
  SELECT creator_id, creator_username
  FROM premium_creators
  WHERE creator_username = '@dubAdvisors'
),
premium_creator_copiers AS (
  SELECT
    pc.creator_id AS premium_creator_id,
    pc.creator_username AS premium_creator,
    upce.distinct_id AS copier_id,
    upce.copy_count,
    upce.liquidation_count
  FROM premium_creators_list pc
  JOIN user_portfolio_creator_engagement upce
    ON pc.creator_id = upce.creator_id
    AND upce.did_copy = true
)
SELECT
  'Copiers matched' as check_result,
  premium_creator_id,
  premium_creator,
  COUNT(DISTINCT copier_id) as copier_count
FROM premium_creator_copiers
GROUP BY premium_creator_id, premium_creator;

-- Solution: If there are duplicate creator_ids for @dubAdvisors,
-- we need to either:
-- 1. Deduplicate premium_creators table (keep only the one with engagement data)
-- 2. Update the view to handle multiple creator_ids per username
