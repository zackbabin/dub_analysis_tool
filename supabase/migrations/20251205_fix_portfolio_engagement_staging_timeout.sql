-- Migration: Fix portfolio engagement staging timeout on first run
-- Created: 2025-12-05
-- Purpose: Add composite index and remove unnecessary ORDER BY to prevent statement timeout
--
-- Issue: process_portfolio_engagement_staging() times out on first run due to:
--   1. Full table scan + sort for ORDER BY user_id, portfolio_ticker, creator_id
--   2. No composite index to support the ORDER BY
--
-- Solution:
--   1. Add composite index on (user_id, portfolio_ticker, creator_id)
--   2. Remove ORDER BY since upsert order doesn't matter

-- ===========================================
-- 1. Add composite index for ORDER BY
-- ===========================================

CREATE INDEX IF NOT EXISTS idx_portfolio_engagement_staging_composite
  ON portfolio_engagement_staging(user_id, portfolio_ticker, creator_id);

COMMENT ON INDEX idx_portfolio_engagement_staging_composite IS
'Composite index to support ORDER BY in chunked processing.
Prevents full table scan + sort that was causing statement timeout on first run.';

-- ===========================================
-- 2. Remove ORDER BY from chunked processing
-- ===========================================

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
  v_chunk_size integer := 5000;
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
    -- REMOVED: ORDER BY user_id, portfolio_ticker, creator_id (not needed for upsert, causes full table scan)
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
'Processes staged portfolio engagement data in chunks of 5k records to avoid timeout.
Upserts to user_portfolio_creator_engagement using set-based SQL.
ORDER BY removed since upsert order does not matter.
Returns (records_processed, records_inserted).';

-- ===========================================
-- 3. Log Migration
-- ===========================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Fixed portfolio engagement staging timeout';
  RAISE NOTICE '   - Added composite index on (user_id, portfolio_ticker, creator_id)';
  RAISE NOTICE '   - Removed unnecessary ORDER BY from chunked processing';
  RAISE NOTICE '   - Should prevent statement timeout on first run';
  RAISE NOTICE '';
END $$;
