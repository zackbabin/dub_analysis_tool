-- Deduplicate @dubAdvisors in premium_creators table
-- Issue: Two creator_ids (211855351476994048 and 118) both map to @dubAdvisors
-- Solution: Keep 211855351476994048, merge engagement data, then delete 118

-- Check current state
SELECT 'Before deduplication:' as status, creator_id, creator_username
FROM premium_creators
WHERE creator_username = '@dubAdvisors'
ORDER BY creator_id;

-- Step 1: Merge user_portfolio_creator_engagement records
-- For records where both creator_ids exist for the same user+portfolio,
-- we need to aggregate the metrics and keep only the newer creator_id

-- First, create a temporary aggregation
CREATE TEMP TABLE merged_engagement AS
SELECT
  distinct_id,
  portfolio_ticker,
  '211855351476994048' as creator_id,
  '@dubAdvisors' as creator_username,
  MAX(pdp_view_count) as pdp_view_count,  -- Take max views
  bool_or(did_copy) as did_copy,  -- TRUE if copied with either id
  SUM(copy_count) as copy_count,  -- Sum all copies
  SUM(liquidation_count) as liquidation_count,  -- Sum all liquidations
  MAX(synced_at) as synced_at  -- Take most recent sync time
FROM user_portfolio_creator_engagement
WHERE creator_id IN ('118', '211855351476994048')
AND creator_username = '@dubAdvisors'
GROUP BY distinct_id, portfolio_ticker;

-- Delete all old records for both creator_ids
DELETE FROM user_portfolio_creator_engagement
WHERE creator_id IN ('118', '211855351476994048')
AND creator_username = '@dubAdvisors';

-- Insert merged records
INSERT INTO user_portfolio_creator_engagement
  (distinct_id, portfolio_ticker, creator_id, creator_username,
   pdp_view_count, did_copy, copy_count, liquidation_count, synced_at)
SELECT * FROM merged_engagement;

-- Step 2: Merge user_creator_engagement records
CREATE TEMP TABLE merged_creator_engagement AS
SELECT
  distinct_id,
  '211855351476994048' as creator_id,
  '@dubAdvisors' as creator_username,
  MAX(profile_view_count) as profile_view_count,
  bool_or(did_copy) as did_copy,
  SUM(copy_count) as copy_count,
  MAX(synced_at) as synced_at
FROM user_creator_engagement
WHERE creator_id IN ('118', '211855351476994048')
AND creator_username = '@dubAdvisors'
GROUP BY distinct_id;

-- Delete old records
DELETE FROM user_creator_engagement
WHERE creator_id IN ('118', '211855351476994048')
AND creator_username = '@dubAdvisors';

-- Insert merged records
INSERT INTO user_creator_engagement
  (distinct_id, creator_id, creator_username, profile_view_count, did_copy, copy_count, synced_at)
SELECT * FROM merged_creator_engagement;

-- Step 3: Handle premium_creator_metrics (subscriptions data)
-- Check if we need to merge or update
DO $$
DECLARE
  has_118 BOOLEAN;
  has_211 BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM premium_creator_metrics WHERE creator_id = '118') INTO has_118;
  SELECT EXISTS (SELECT 1 FROM premium_creator_metrics WHERE creator_id = '211855351476994048') INTO has_211;

  IF has_118 AND NOT has_211 THEN
    -- Only 118 has metrics, update to 211
    UPDATE premium_creator_metrics
    SET creator_id = '211855351476994048'
    WHERE creator_id = '118';
    RAISE NOTICE 'Updated metrics from 118 to 211855351476994048';
  ELSIF has_118 AND has_211 THEN
    -- Both have metrics, delete 118 (keep 211's more recent data)
    DELETE FROM premium_creator_metrics WHERE creator_id = '118';
    RAISE NOTICE 'Deleted metrics for 118 (211855351476994048 already exists)';
  END IF;
END $$;

-- Step 4: Delete the duplicate from premium_creators
DELETE FROM premium_creators
WHERE creator_id = '118'
AND creator_username = '@dubAdvisors';

-- Step 5: Verify deduplication
DO $$
DECLARE
  count_in_creators INTEGER;
  count_in_engagement INTEGER;
BEGIN
  SELECT COUNT(*) INTO count_in_creators
  FROM premium_creators
  WHERE creator_username = '@dubAdvisors';

  SELECT COUNT(DISTINCT creator_id) INTO count_in_engagement
  FROM user_portfolio_creator_engagement
  WHERE creator_username = '@dubAdvisors';

  IF count_in_creators = 1 AND count_in_engagement = 1 THEN
    RAISE NOTICE '✅ Successfully deduplicated @dubAdvisors';
  ELSE
    RAISE EXCEPTION '❌ Deduplication incomplete - creators: %, engagement: %',
      count_in_creators, count_in_engagement;
  END IF;
END $$;

-- Step 6: Refresh materialized views
REFRESH MATERIALIZED VIEW portfolio_creator_engagement_metrics;
REFRESH MATERIALIZED VIEW premium_creator_breakdown;

-- Step 7: Verify final state
SELECT
  'After deduplication:' as status,
  creator_id,
  creator_username
FROM premium_creators
WHERE creator_username = '@dubAdvisors';

-- Check that premium_creator_breakdown now has 20 creators (was 21 before)
SELECT
  'Total premium creators:' as status,
  COUNT(*) as total_count
FROM premium_creator_breakdown;

-- Expected: 20 creators (down from 21 after merging @dubAdvisors)
