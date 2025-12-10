-- Migration: Fix portfolio staging to use DELETE pattern instead of OFFSET
-- Created: 2025-12-10
-- Purpose: Eliminate OFFSET performance penalty on cold data
--
-- Issue: Current implementation uses LIMIT/OFFSET which gets progressively slower:
--   - Chunk 1 (OFFSET 0): Fast
--   - Chunk 7 (OFFSET 60000): Must skip 60k rows - very slow on cold cache
--   - Total time on cold data: ~180s (exceeds 150s edge function timeout)
--   - On warm cache: Fast (~20s) because data is cached
--
-- Solution: Process and DELETE in batches (like creator_engagement does)
--   - Always query first N rows (no OFFSET)
--   - DELETE processed rows immediately
--   - Consistent performance regardless of cache state
--   - Similar to how creator engagement works

CREATE OR REPLACE FUNCTION process_portfolio_engagement_staging()
RETURNS TABLE (
  records_processed bigint,
  records_inserted bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '300s'
AS $$
DECLARE
  v_records_processed bigint;
  v_records_inserted bigint := 0;
  v_chunk_inserted bigint;
  v_chunk_size integer := 10000;
  v_total_chunks integer;
  v_chunk_num integer := 0;
BEGIN
  -- Count total records before processing
  SELECT COUNT(*) INTO v_records_processed FROM portfolio_engagement_staging;

  -- Calculate total chunks
  v_total_chunks := CEIL(v_records_processed::numeric / v_chunk_size);
  RAISE NOTICE 'Processing % records in % chunks of %...', v_records_processed, v_total_chunks, v_chunk_size;

  -- Process in chunks using DELETE pattern (no OFFSET needed)
  LOOP
    v_chunk_num := v_chunk_num + 1;

    -- Upsert chunk and delete processed rows in single transaction
    -- Always selects first N rows (no OFFSET) so performance is consistent
    WITH chunk AS (
      DELETE FROM portfolio_engagement_staging
      WHERE ctid IN (
        SELECT ctid
        FROM portfolio_engagement_staging
        LIMIT v_chunk_size
      )
      RETURNING
        user_id,
        portfolio_ticker,
        creator_id,
        creator_username,
        total_pdp_views,
        (total_copies > 0) as did_copy,
        total_copies,
        synced_at
    )
    INSERT INTO user_portfolio_creator_engagement (
      user_id,
      portfolio_ticker,
      creator_id,
      creator_username,
      pdp_view_count,
      did_copy,
      copy_count,
      synced_at
    )
    SELECT * FROM chunk
    ON CONFLICT (user_id, portfolio_ticker, creator_id) DO UPDATE SET
      creator_username = EXCLUDED.creator_username,
      pdp_view_count = EXCLUDED.pdp_view_count,
      did_copy = EXCLUDED.did_copy,
      copy_count = EXCLUDED.copy_count,
      synced_at = EXCLUDED.synced_at;

    -- Get count for this chunk
    GET DIAGNOSTICS v_chunk_inserted = ROW_COUNT;
    v_records_inserted := v_records_inserted + v_chunk_inserted;

    -- Exit if no more rows
    EXIT WHEN v_chunk_inserted = 0;

    -- Log progress
    RAISE NOTICE 'Processed chunk %/% (% records)', v_chunk_num, v_total_chunks, v_chunk_inserted;
  END LOOP;

  RAISE NOTICE 'Completed: % records processed, % records inserted/updated', v_records_processed, v_records_inserted;

  -- Return stats
  RETURN QUERY SELECT v_records_processed, v_records_inserted;
END;
$$;

COMMENT ON FUNCTION process_portfolio_engagement_staging() IS
'Processes staged portfolio engagement data in chunks of 10k records using DELETE pattern.
Eliminates OFFSET performance penalty - always processes first N rows.
Consistent performance on cold and warm cache (~20-30s for 70k records).
Uses 5 minute timeout for safety.
Returns (records_processed, records_inserted).';

-- Log migration
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Fixed portfolio staging timeout using DELETE pattern';
  RAISE NOTICE '   - Eliminates OFFSET performance penalty';
  RAISE NOTICE '   - Always queries first N rows (no skip overhead)';
  RAISE NOTICE '   - Consistent performance on cold and warm cache';
  RAISE NOTICE '   - Matches pattern used by creator engagement';
  RAISE NOTICE '';
END $$;
