-- Migration: Optimize creator engagement processing with chunked processing
-- Created: 2025-12-01
-- Purpose: Process staging data in chunks to avoid statement timeout with large datasets
--
-- Problem: Single INSERT...SELECT with ON CONFLICT can timeout on large datasets (40k+ records)
-- Solution: Process in chunks of 10k records at a time (same as portfolio processing)

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
  v_records_inserted bigint := 0;
  v_chunk_inserted bigint;
  v_chunk_size integer := 10000;  -- Process 10k records at a time
  v_offset integer := 0;
  v_total_chunks integer;
BEGIN
  -- Count total records before processing
  SELECT COUNT(*) INTO v_records_processed FROM creator_engagement_staging;

  -- Calculate total chunks
  v_total_chunks := CEIL(v_records_processed::numeric / v_chunk_size);
  RAISE NOTICE 'Processing % records in % chunks of %...', v_records_processed, v_total_chunks, v_chunk_size;

  -- Process in chunks to avoid timeout
  LOOP
    EXIT WHEN v_offset >= v_records_processed;

    -- Upsert chunk from staging to main table
    WITH chunk AS (
      SELECT
        user_id,
        creator_id,
        creator_username,
        profile_view_count,
        did_subscribe,
        subscription_count,
        synced_at
      FROM creator_engagement_staging
      ORDER BY user_id, creator_id
      LIMIT v_chunk_size
      OFFSET v_offset
    )
    INSERT INTO user_creator_engagement (
      user_id,
      creator_id,
      creator_username,
      profile_view_count,
      did_subscribe,
      subscription_count,
      synced_at
    )
    SELECT * FROM chunk
    ON CONFLICT (user_id, creator_id) DO UPDATE SET
      creator_username = EXCLUDED.creator_username,
      profile_view_count = EXCLUDED.profile_view_count,
      did_subscribe = EXCLUDED.did_subscribe,
      subscription_count = EXCLUDED.subscription_count,
      synced_at = EXCLUDED.synced_at;

    -- Get count for this chunk
    GET DIAGNOSTICS v_chunk_inserted = ROW_COUNT;
    v_records_inserted := v_records_inserted + v_chunk_inserted;

    -- Log progress
    v_offset := v_offset + v_chunk_size;
    RAISE NOTICE 'Processed chunk: %/% records complete', LEAST(v_offset, v_records_processed), v_records_processed;
  END LOOP;

  RAISE NOTICE 'Completed: % records processed, % records inserted/updated', v_records_processed, v_records_inserted;

  -- Return stats
  RETURN QUERY SELECT v_records_processed, v_records_inserted;
END;
$$;

COMMENT ON FUNCTION process_creator_engagement_staging() IS
'Processes staged creator engagement data in chunks of 10k records to avoid timeout.
Upserts to user_creator_engagement using set-based SQL.
Returns (records_processed, records_inserted).';

-- Log the changes
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Optimized process_creator_engagement_staging() function';
  RAISE NOTICE '   - Now processes in chunks of 10k records';
  RAISE NOTICE '   - Prevents statement timeout on large datasets (40k+ records)';
  RAISE NOTICE '   - Maintains 300s timeout but completes faster via chunking';
  RAISE NOTICE '   - Consistent with portfolio processing approach';
  RAISE NOTICE '';
END $$;
