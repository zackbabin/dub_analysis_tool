-- Fix @dubAdvisors creator_id in premium_creators table
-- The correct creator_id is 211855351476994048 (has 2,563 copiers)
-- The incorrect creator_id is 118 (has 0 copiers)

-- Step 1: Check current state
SELECT 'Before fix' as step, creator_id, creator_username
FROM premium_creators
WHERE creator_username = '@dubAdvisors';

-- Step 2: Delete the incorrect entry (if it exists)
DELETE FROM premium_creators
WHERE creator_username = '@dubAdvisors'
  AND creator_id = '118';

-- Step 3: Ensure the correct entry exists
INSERT INTO premium_creators (creator_id, creator_username, synced_at)
VALUES ('211855351476994048', '@dubAdvisors', NOW())
ON CONFLICT (creator_id)
DO UPDATE SET
  creator_username = EXCLUDED.creator_username,
  synced_at = EXCLUDED.synced_at;

-- Step 4: Verify fix
SELECT 'After fix' as step, creator_id, creator_username
FROM premium_creators
WHERE creator_username = '@dubAdvisors';

-- Step 5: Verify affinity data will now include @dubAdvisors
WITH premium_creators_list AS (
  SELECT creator_id, creator_username
  FROM premium_creators
  WHERE creator_username = '@dubAdvisors'
),
premium_creator_copiers AS (
  SELECT
    pc.creator_id AS premium_creator_id,
    pc.creator_username AS premium_creator,
    COUNT(DISTINCT upce.distinct_id) as copier_count
  FROM premium_creators_list pc
  JOIN user_portfolio_creator_engagement upce
    ON pc.creator_id = upce.creator_id
    AND upce.did_copy = true
  GROUP BY pc.creator_id, pc.creator_username
)
SELECT
  'Copiers found' as verification,
  premium_creator,
  copier_count
FROM premium_creator_copiers;
