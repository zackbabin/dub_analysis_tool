-- Add the missing @dubAdvisors creator_id to premium_creators table
-- The premium_creators table only has creator_id 118, but the engagement data is under 211855351476994048

-- Check current state
SELECT 'Before fix' as step, creator_id, creator_username
FROM premium_creators
WHERE creator_username = '@dubAdvisors'
ORDER BY creator_id;

-- Insert the missing creator_id (211855351476994048) that has the actual engagement data
INSERT INTO premium_creators (creator_id, creator_username, synced_at)
VALUES ('211855351476994048', '@dubAdvisors', NOW())
ON CONFLICT (creator_id) DO NOTHING;

-- Verify both creator_ids now exist
SELECT 'After fix' as step, creator_id, creator_username
FROM premium_creators
WHERE creator_username = '@dubAdvisors'
ORDER BY creator_id;

-- Verify the array aggregation will now include both
WITH premium_creators_list AS (
  SELECT
    creator_username,
    array_agg(creator_id ORDER BY creator_id) as creator_ids
  FROM premium_creators
  WHERE creator_username = '@dubAdvisors'
  GROUP BY creator_username
)
SELECT 'Array aggregation' as step, *
FROM premium_creators_list;

-- Verify we can now find copiers
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
SELECT 'Copiers found' as step,
       premium_creator,
       COUNT(DISTINCT copier_id) as unique_copiers,
       SUM(copy_count) as total_copies,
       SUM(liquidation_count) as total_liquidations
FROM premium_creator_copiers
GROUP BY premium_creator;
