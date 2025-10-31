-- Detailed debug for @dubAdvisors copiers

-- Check 1: What creator_ids exist for @dubAdvisors in premium_creators?
SELECT 'premium_creators table' as source,
       creator_id,
       creator_username
FROM premium_creators
WHERE creator_username = '@dubAdvisors'
ORDER BY creator_id;

-- Check 2: For each creator_id, how many copiers exist?
SELECT 'Copiers per creator_id' as check_name,
       upce.creator_id,
       upce.creator_username,
       COUNT(DISTINCT upce.distinct_id) as unique_copiers,
       SUM(upce.copy_count) as total_copies
FROM user_portfolio_creator_engagement upce
WHERE upce.creator_username = '@dubAdvisors'
  AND upce.did_copy = true
GROUP BY upce.creator_id, upce.creator_username
ORDER BY upce.creator_id;

-- Check 3: After LATERAL unnest and join, what do we get?
WITH premium_creators_list AS (
  SELECT
    creator_username,
    array_agg(creator_id) as creator_ids
  FROM premium_creators
  WHERE creator_username = '@dubAdvisors'
  GROUP BY creator_username
)
SELECT 'After LATERAL unnest' as check_name,
       pc.creator_username,
       pc.creator_ids,
       pc_creator_id,
       COUNT(*) as join_count
FROM premium_creators_list pc
CROSS JOIN LATERAL unnest(pc.creator_ids) AS pc_creator_id
JOIN user_portfolio_creator_engagement upce
  ON pc_creator_id = upce.creator_id
  AND upce.did_copy = true
GROUP BY pc.creator_username, pc.creator_ids, pc_creator_id;

-- Check 4: After deduplication in premium_creator_copiers CTE
WITH premium_creators_list AS (
  SELECT
    creator_username,
    array_agg(creator_id) as creator_ids
  FROM premium_creators
  WHERE creator_username = '@dubAdvisors'
  GROUP BY creator_username
),
premium_creator_copiers AS (
  SELECT
    pc.creator_username AS premium_creator,
    upce.distinct_id AS copier_id,
    upce.copy_count,
    upce.liquidation_count
  FROM premium_creators_list pc
  CROSS JOIN LATERAL unnest(pc.creator_ids) AS pc_creator_id
  JOIN user_portfolio_creator_engagement upce
    ON pc_creator_id = upce.creator_id
    AND upce.did_copy = true
)
SELECT 'premium_creator_copiers CTE' as check_name,
       premium_creator,
       COUNT(*) as total_rows,
       COUNT(DISTINCT copier_id) as unique_copiers,
       SUM(copy_count) as total_copies,
       SUM(liquidation_count) as total_liquidations
FROM premium_creator_copiers
GROUP BY premium_creator;
