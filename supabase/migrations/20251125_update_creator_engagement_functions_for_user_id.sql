-- Migration: Update creator engagement SQL functions to use user_id
-- Created: 2025-11-25
-- Purpose: Update process_creator_engagement_staging() function to use user_id column
--
-- Background:
-- - Renamed distinct_id → user_id in creator_engagement_staging
-- - Need to update SQL function that processes staging data

CREATE OR REPLACE FUNCTION process_creator_engagement_staging()
RETURNS TABLE (
  records_processed bigint,
  records_inserted bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_records_processed bigint;
  v_records_inserted bigint;
BEGIN
  -- Count total records before processing
  SELECT COUNT(*) INTO v_records_processed FROM creator_engagement_staging;

  -- Upsert from staging to main table using set-based SQL
  -- This is 10-50x faster than JavaScript loops with network round trips
  INSERT INTO user_creator_engagement (
    user_id,              -- Updated from distinct_id
    creator_id,
    creator_username,
    profile_view_count,
    did_subscribe,
    subscription_count,
    synced_at
  )
  SELECT
    user_id,              -- Updated from distinct_id
    creator_id,
    creator_username,
    profile_view_count,
    did_subscribe,
    subscription_count,
    synced_at
  FROM creator_engagement_staging
  ON CONFLICT (user_id, creator_id) DO UPDATE SET  -- Updated from distinct_id
    creator_username = EXCLUDED.creator_username,
    profile_view_count = EXCLUDED.profile_view_count,
    did_subscribe = EXCLUDED.did_subscribe,
    subscription_count = EXCLUDED.subscription_count,
    synced_at = EXCLUDED.synced_at;

  -- Get count of inserted/updated records
  GET DIAGNOSTICS v_records_inserted = ROW_COUNT;

  -- Return stats
  RETURN QUERY SELECT v_records_processed, v_records_inserted;
END;
$$;

COMMENT ON FUNCTION process_creator_engagement_staging() IS
'Processes staged creator engagement data and upserts to user_creator_engagement.
Uses set-based SQL for 10-50x performance vs JavaScript loops.
Returns (records_processed, records_inserted).
Updated to use user_id column instead of distinct_id.';

-- Log the changes
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Updated process_creator_engagement_staging() function';
  RAISE NOTICE '   - Changed distinct_id → user_id in INSERT/SELECT/ON CONFLICT';
  RAISE NOTICE '';
END $$;
