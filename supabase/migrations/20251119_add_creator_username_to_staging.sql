-- Add creator_username to portfolio_engagement_staging and update processing function
-- This ensures creator names are properly populated in user_portfolio_creator_engagement table
-- and subsequently in hidden_gems_portfolios and other views

-- Part 1: Add creator_username column to staging table
ALTER TABLE portfolio_engagement_staging
ADD COLUMN IF NOT EXISTS creator_username text;

-- Part 2: Update the processing function to include creator_username
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
  -- IMPORTANT: Use GROUP BY to deduplicate and aggregate duplicate keys in staging
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
    MAX(creator_username) as creator_username,              -- use any creator_username for this creator_id
    SUM(total_pdp_views) as pdp_view_count,                  -- aggregate duplicates
    BOOL_OR(total_copies > 0) as did_copy,                   -- true if ANY row has copies
    SUM(total_copies) as copy_count,                         -- sum all copies
    SUM(total_liquidations) as liquidation_count,            -- sum all liquidations
    MAX(synced_at) as synced_at                              -- use latest sync time
  FROM portfolio_engagement_staging
  GROUP BY distinct_id, portfolio_ticker, creator_id         -- deduplicate by unique key
  ON CONFLICT (distinct_id, portfolio_ticker, creator_id) DO UPDATE SET
    creator_username = COALESCE(EXCLUDED.creator_username, user_portfolio_creator_engagement.creator_username),  -- update if new value provided
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

-- Update function comment
COMMENT ON FUNCTION process_portfolio_engagement_staging() IS
'Processes staged portfolio engagement data and upserts to user_portfolio_creator_engagement.
Maps staging columns (total_*) to table columns (pdp_view_count, copy_count, liquidation_count).
Includes creator_username for display in hidden_gems and other views.
Deduplicates staging data by (distinct_id, portfolio_ticker, creator_id) using GROUP BY and SUM.
Uses set-based SQL for 10-50x performance vs JavaScript loops.
Returns (records_processed, records_inserted).';

-- Log the migration
DO $$
BEGIN
  RAISE NOTICE '✅ Added creator_username column to portfolio_engagement_staging';
  RAISE NOTICE '✅ Updated process_portfolio_engagement_staging() to populate creator_username';
END $$;
