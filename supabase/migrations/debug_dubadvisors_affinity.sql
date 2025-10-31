-- Debug: Check if @dubAdvisors appears in each CTE step

-- Step 1: Check premium_creators_list CTE
WITH premium_creators_list AS (
  SELECT
    creator_username,
    array_agg(creator_id) as creator_ids
  FROM premium_creators
  GROUP BY creator_username
)
SELECT 'Step 1: premium_creators_list' as step, *
FROM premium_creators_list
WHERE creator_username = '@dubAdvisors';

-- Step 2: Check premium_creator_copiers CTE
WITH premium_creators_list AS (
  SELECT
    creator_username,
    array_agg(creator_id) as creator_ids
  FROM premium_creators
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
SELECT 'Step 2: premium_creator_copiers' as step,
       premium_creator,
       COUNT(DISTINCT copier_id) as copier_count,
       SUM(copy_count) as total_copies,
       SUM(liquidation_count) as total_liquidations
FROM premium_creator_copiers
WHERE premium_creator = '@dubAdvisors'
GROUP BY premium_creator;

-- Step 3: Check premium_totals CTE
WITH premium_creators_list AS (
  SELECT
    creator_username,
    array_agg(creator_id) as creator_ids
  FROM premium_creators
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
),
premium_totals AS (
  SELECT
    premium_creator,
    SUM(copy_count) AS total_copies,
    SUM(liquidation_count) AS total_liquidations
  FROM premium_creator_copiers
  GROUP BY premium_creator
)
SELECT 'Step 3: premium_totals' as step, *
FROM premium_totals
WHERE premium_creator = '@dubAdvisors';

-- Step 4: Check if @dubAdvisors appears in the base view
SELECT 'Step 4: premium_creator_copy_affinity_base' as step,
       COUNT(*) as row_count
FROM premium_creator_copy_affinity_base
WHERE premium_creator = '@dubAdvisors';

-- Step 5: Check if @dubAdvisors appears in the display view
SELECT 'Step 5: premium_creator_affinity_display' as step, *
FROM premium_creator_affinity_display
WHERE premium_creator = '@dubAdvisors';

-- Step 6: Check all premium creators in display view
SELECT 'Step 6: All premium creators' as step,
       premium_creator,
       premium_creator_total_copies
FROM premium_creator_affinity_display
ORDER BY premium_creator_total_copies DESC;
