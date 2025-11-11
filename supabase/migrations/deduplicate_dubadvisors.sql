-- Deduplicate @dubAdvisors in premium_creators table
-- Issue: Two creator_ids (211855351476994048 and 118) both map to @dubAdvisors
-- Solution: Keep 211855351476994048 (newer), merge data from 118, then delete 118

-- Check current state
DO $$
BEGIN
  RAISE NOTICE 'Current @dubAdvisors entries:';
END $$;

SELECT creator_id, creator_username
FROM premium_creators
WHERE creator_username = '@dubAdvisors'
ORDER BY creator_id;

-- Step 1: Update all references in portfolio_creator_engagement_metrics
-- (This is a materialized view, so we can't update it directly - will refresh later)

-- Step 2: Update references in user_portfolio_creator_engagement
UPDATE user_portfolio_creator_engagement
SET creator_id = '211855351476994048',
    creator_username = '@dubAdvisors'
WHERE creator_id = '118'
AND creator_username = '@dubAdvisors';

-- Step 3: Update references in user_creator_engagement
UPDATE user_creator_engagement
SET creator_id = '211855351476994048',
    creator_username = '@dubAdvisors'
WHERE creator_id = '118'
AND creator_username = '@dubAdvisors';

-- Step 4: Update references in premium_creator_metrics (if any exist for 118)
-- Check if creator_id 118 has metrics
DO $$
DECLARE
  has_metrics INTEGER;
BEGIN
  SELECT COUNT(*) INTO has_metrics
  FROM premium_creator_metrics
  WHERE creator_id = '118';

  IF has_metrics > 0 THEN
    -- If 211855351476994048 already has metrics, delete 118's metrics
    -- If not, update 118's metrics to 211855351476994048
    IF EXISTS (SELECT 1 FROM premium_creator_metrics WHERE creator_id = '211855351476994048') THEN
      DELETE FROM premium_creator_metrics WHERE creator_id = '118';
      RAISE NOTICE 'Deleted metrics for creator_id 118 (211855351476994048 already has metrics)';
    ELSE
      UPDATE premium_creator_metrics
      SET creator_id = '211855351476994048'
      WHERE creator_id = '118';
      RAISE NOTICE 'Updated metrics from creator_id 118 to 211855351476994048';
    END IF;
  END IF;
END $$;

-- Step 5: Delete the duplicate entry from premium_creators
DELETE FROM premium_creators
WHERE creator_id = '118'
AND creator_username = '@dubAdvisors';

-- Step 6: Verify only one @dubAdvisors remains
DO $$
DECLARE
  count_remaining INTEGER;
BEGIN
  SELECT COUNT(*) INTO count_remaining
  FROM premium_creators
  WHERE creator_username = '@dubAdvisors';

  IF count_remaining = 1 THEN
    RAISE NOTICE '✅ Successfully deduplicated @dubAdvisors - 1 entry remains';
  ELSE
    RAISE EXCEPTION '❌ Deduplication failed - % entries remain', count_remaining;
  END IF;
END $$;

-- Step 7: Refresh materialized views to reflect the changes
REFRESH MATERIALIZED VIEW portfolio_creator_engagement_metrics;
REFRESH MATERIALIZED VIEW premium_creator_breakdown;

-- Verify final state
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
WHERE creator_username = '@dubAdvisors';

-- Expected result: Both should show 1 row
