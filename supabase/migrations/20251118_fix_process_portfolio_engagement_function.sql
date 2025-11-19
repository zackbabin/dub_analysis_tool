-- Fix process_portfolio_engagement_staging() function to match actual table schema
-- Issue: Function references columns that don't exist (total_profile_views, total_pdp_views, etc.)
-- Fix: Update function to use actual column names (pdp_view_count, copy_count, etc.)
-- Date: 2025-11-18

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
  -- Map staging columns to actual table columns
  INSERT INTO user_portfolio_creator_engagement (
    distinct_id,
    portfolio_ticker,
    creator_id,
    pdp_view_count,  -- map from total_pdp_views
    did_copy,
    copy_count,      -- map from total_copies
    liquidation_count, -- map from total_liquidations
    synced_at
  )
  SELECT
    distinct_id,
    portfolio_ticker,
    creator_id,
    total_pdp_views,
    (total_copies > 0) as did_copy,  -- boolean: true if user copied
    total_copies,
    total_liquidations,
    synced_at
  FROM portfolio_engagement_staging
  ON CONFLICT (distinct_id, portfolio_ticker, creator_id) DO UPDATE SET
    pdp_view_count = user_portfolio_creator_engagement.pdp_view_count + EXCLUDED.pdp_view_count,
    did_copy = (user_portfolio_creator_engagement.did_copy OR EXCLUDED.did_copy),
    copy_count = user_portfolio_creator_engagement.copy_count + EXCLUDED.copy_count,
    liquidation_count = user_portfolio_creator_engagement.liquidation_count + EXCLUDED.liquidation_count,
    synced_at = EXCLUDED.synced_at;

  -- Get count of inserted/updated records
  GET DIAGNOSTICS v_records_inserted = ROW_COUNT;

  -- Return stats
  RETURN QUERY SELECT v_records_processed, v_records_inserted;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION process_portfolio_engagement_staging() TO service_role, authenticated;

COMMENT ON FUNCTION process_portfolio_engagement_staging() IS
'Processes staged portfolio engagement data and upserts to user_portfolio_creator_engagement.
Maps staging columns (total_*) to table columns (pdp_view_count, copy_count, liquidation_count).
Uses set-based SQL for 10-50x performance vs JavaScript loops.
Returns (records_processed, records_inserted).';

-- Log the fix
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Fixed process_portfolio_engagement_staging() function';
  RAISE NOTICE '   Mapped staging columns to actual table schema:';
  RAISE NOTICE '   - total_pdp_views → pdp_view_count';
  RAISE NOTICE '   - total_copies → copy_count + did_copy';
  RAISE NOTICE '   - total_liquidations → liquidation_count';
  RAISE NOTICE '   - Removed total_profile_views (not in table)';
  RAISE NOTICE '   - Removed total_subscriptions (not in table)';
  RAISE NOTICE '';
END $$;
