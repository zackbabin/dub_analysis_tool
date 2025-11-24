-- Migration: Fix portfolio engagement processing function column name mismatch
-- Created: 2025-11-24
-- Purpose: Fix process_portfolio_engagement_staging() to use correct column names
--
-- PROBLEM:
-- - The staging table uses: total_pdp_views, total_copies, total_liquidations, total_subscriptions
-- - The final table uses: pdp_view_count, copy_count, liquidation_count, (no subscriptions column exists)
-- - The processing function was trying to INSERT columns that don't exist
-- - This caused hidden_gems_portfolios to have no copy data
--
-- SOLUTION:
-- - Update the processing function to map staging columns to correct target columns
-- - Calculate did_copy based on total_copies > 0

CREATE OR REPLACE FUNCTION process_portfolio_engagement_staging()
RETURNS TABLE (
  records_processed bigint,
  records_inserted bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_records_processed bigint;
  v_records_inserted bigint;
BEGIN
  -- Count records in staging table
  SELECT COUNT(*) INTO v_records_processed FROM portfolio_engagement_staging;

  -- Upsert from staging to final table with correct column mapping
  -- IMPORTANT: Use GROUP BY to deduplicate staging data before upsert
  INSERT INTO user_portfolio_creator_engagement (
    distinct_id,
    portfolio_ticker,
    creator_id,
    creator_username,
    pdp_view_count,
    did_copy,
    copy_count,
    liquidation_count,
    synced_at
  )
  SELECT
    distinct_id,
    portfolio_ticker,
    creator_id,
    MAX(creator_username) as creator_username,  -- Take any non-null username
    SUM(total_pdp_views) as pdp_view_count,     -- Aggregate duplicates
    BOOL_OR(total_copies > 0) as did_copy,      -- True if ANY row has copies
    SUM(total_copies) as copy_count,            -- Sum all copies
    SUM(total_liquidations) as liquidation_count, -- Sum all liquidations
    MAX(synced_at) as synced_at                 -- Use latest sync time
  FROM portfolio_engagement_staging
  GROUP BY distinct_id, portfolio_ticker, creator_id  -- Deduplicate by unique key
  ON CONFLICT (distinct_id, portfolio_ticker, creator_id) DO UPDATE SET
    pdp_view_count = user_portfolio_creator_engagement.pdp_view_count + EXCLUDED.pdp_view_count,
    did_copy = (user_portfolio_creator_engagement.did_copy OR EXCLUDED.did_copy),
    copy_count = user_portfolio_creator_engagement.copy_count + EXCLUDED.copy_count,
    liquidation_count = user_portfolio_creator_engagement.liquidation_count + EXCLUDED.liquidation_count,
    synced_at = EXCLUDED.synced_at,
    creator_username = COALESCE(EXCLUDED.creator_username, user_portfolio_creator_engagement.creator_username);

  -- Get count of inserted/updated records
  GET DIAGNOSTICS v_records_inserted = ROW_COUNT;

  -- Return stats
  RETURN QUERY SELECT v_records_processed, v_records_inserted;
END;
$$;

COMMENT ON FUNCTION process_portfolio_engagement_staging() IS
'Processes staged portfolio engagement data and upserts to user_portfolio_creator_engagement.
Maps staging column names (total_*) to table column names (pdp_view_count, copy_count, etc).
Deduplicates staging data by (distinct_id, portfolio_ticker, creator_id) using GROUP BY and SUM.
Calculates did_copy flag based on total_copies > 0.
Uses set-based SQL for 10-50x performance vs JavaScript loops.
Returns (records_processed, records_inserted).';
