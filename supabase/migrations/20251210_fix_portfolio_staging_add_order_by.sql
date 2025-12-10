-- Migration: Add ORDER BY back to portfolio staging function
-- Created: 2025-12-10
-- Purpose: Fix first-run timeout by forcing index usage with ORDER BY
--
-- Issue: Removing ORDER BY in previous migration caused sequential scans
--        which timeout on first run but succeed on second run (cached).
--
-- Solution: Add ORDER BY user_id, portfolio_ticker, creator_id back
--           This forces PostgreSQL to use the composite index, even when cold.
--           Also increase chunk size from 5k to 10k (same as creator processing).
--
-- Why this works:
--   - ORDER BY forces index scan instead of sequential scan
--   - Index scan is consistent speed (cold or warm)
--   - Sequential scan is fast when cached, slow when cold
--
-- Comparison with creator function:
--   - Creator: has ORDER BY, chunk size 10k - NO timeout issues
--   - Portfolio: removed ORDER BY, chunk size 5k - timeout on first run

CREATE OR REPLACE FUNCTION process_portfolio_engagement_staging()
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
  v_chunk_size integer := 10000;  -- Increased from 5k to 10k (same as creator)
  v_offset integer := 0;
  v_total_chunks integer;
BEGIN
  -- Count total records before processing
  SELECT COUNT(*) INTO v_records_processed FROM portfolio_engagement_staging;

  -- Calculate total chunks
  v_total_chunks := CEIL(v_records_processed::numeric / v_chunk_size);
  RAISE NOTICE 'Processing % records in % chunks of %...', v_records_processed, v_total_chunks, v_chunk_size;

  -- Process in chunks to avoid timeout
  LOOP
    EXIT WHEN v_offset >= v_records_processed;

    -- Upsert chunk from staging to main table
    -- ORDER BY added back - forces index usage, prevents sequential scan timeout
    WITH chunk AS (
      SELECT
        user_id,
        portfolio_ticker,
        creator_id,
        creator_username,
        total_pdp_views,
        (total_copies > 0) as did_copy,
        total_copies,
        synced_at
      FROM portfolio_engagement_staging
      ORDER BY user_id, portfolio_ticker, creator_id  -- Forces index usage
      LIMIT v_chunk_size
      OFFSET v_offset
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

    -- Log progress
    v_offset := v_offset + v_chunk_size;
    RAISE NOTICE 'Processed chunk: %/% records complete', LEAST(v_offset, v_records_processed), v_records_processed;
  END LOOP;

  RAISE NOTICE 'Completed: % records processed, % records inserted/updated', v_records_processed, v_records_inserted;

  -- Return stats
  RETURN QUERY SELECT v_records_processed, v_records_inserted;
END;
$$;

COMMENT ON FUNCTION process_portfolio_engagement_staging() IS
'Processes staged portfolio engagement data in chunks of 10k records to avoid timeout.
Uses ORDER BY to force index usage - prevents sequential scan timeout on first run.
Upserts to user_portfolio_creator_engagement using set-based SQL.
Returns (records_processed, records_inserted).';

-- Log migration
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Fixed portfolio staging timeout on first run';
  RAISE NOTICE '   - Added ORDER BY user_id, portfolio_ticker, creator_id';
  RAISE NOTICE '   - Forces index usage instead of sequential scan';
  RAISE NOTICE '   - Increased chunk size from 5k to 10k';
  RAISE NOTICE '   - Now consistent with creator processing';
  RAISE NOTICE '';
END $$;
