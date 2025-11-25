-- Migration: Update portfolio engagement SQL functions to use user_id
-- Created: 2025-11-25
-- Purpose: Update process_portfolio_engagement_staging() function to use user_id column
--
-- Background:
-- - Renamed distinct_id → user_id in portfolio_engagement_staging
-- - Need to update SQL function that processes staging data

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
  v_records_inserted bigint;
BEGIN
  -- Count total records before processing
  SELECT COUNT(*) INTO v_records_processed FROM portfolio_engagement_staging;

  -- Upsert from staging to main table using set-based SQL
  -- This is 10-50x faster than JavaScript loops with network round trips
  INSERT INTO user_portfolio_creator_engagement (
    user_id,              -- Updated from distinct_id
    portfolio_ticker,
    creator_id,
    creator_username,
    pdp_view_count,
    did_copy,
    copy_count,
    synced_at
  )
  SELECT
    user_id,              -- Updated from distinct_id
    portfolio_ticker,
    creator_id,
    creator_username,
    total_pdp_views,
    (total_copies > 0),
    total_copies,
    synced_at
  FROM portfolio_engagement_staging
  ON CONFLICT (user_id, portfolio_ticker, creator_id) DO UPDATE SET  -- Updated from distinct_id
    creator_username = EXCLUDED.creator_username,
    pdp_view_count = EXCLUDED.pdp_view_count,
    did_copy = EXCLUDED.did_copy,
    copy_count = EXCLUDED.copy_count,
    synced_at = EXCLUDED.synced_at;

  -- Get count of inserted/updated records
  GET DIAGNOSTICS v_records_inserted = ROW_COUNT;

  -- Return stats
  RETURN QUERY SELECT v_records_processed, v_records_inserted;
END;
$$;

COMMENT ON FUNCTION process_portfolio_engagement_staging() IS
'Processes staged portfolio engagement data and upserts to user_portfolio_creator_engagement.
Uses set-based SQL for 10-50x performance vs JavaScript loops.
Returns (records_processed, records_inserted).
Updated to use user_id column instead of distinct_id.';

-- Log the changes
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Updated process_portfolio_engagement_staging() function';
  RAISE NOTICE '   - Changed distinct_id → user_id in INSERT/SELECT/ON CONFLICT';
  RAISE NOTICE '';
END $$;
