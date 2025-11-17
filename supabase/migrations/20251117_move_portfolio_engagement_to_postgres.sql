-- Move portfolio engagement processing to Postgres for 10-50x performance improvement
-- Similar pattern to sync-mixpanel-user-events: stage raw data, process in Postgres
-- Date: 2025-11-17

-- ============================================================================
-- Part 1: Create staging table for raw portfolio engagement data
-- ============================================================================

CREATE UNLOGGED TABLE IF NOT EXISTS portfolio_engagement_staging (
  id bigserial PRIMARY KEY,
  distinct_id text NOT NULL,
  portfolio_ticker text NOT NULL,
  creator_id text NOT NULL,
  total_profile_views integer DEFAULT 0,
  total_pdp_views integer DEFAULT 0,
  total_copies integer DEFAULT 0,
  total_liquidations integer DEFAULT 0,
  total_subscriptions integer DEFAULT 0,
  synced_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- UNLOGGED table: faster inserts, data not crash-safe (acceptable for staging)
-- No indexes: maximum insert speed

COMMENT ON TABLE portfolio_engagement_staging IS
'Staging table for raw portfolio engagement data. UNLOGGED for maximum insert performance. Cleared after processing.';

-- Grant permissions
GRANT SELECT, INSERT, DELETE, TRUNCATE ON portfolio_engagement_staging TO service_role, authenticated;
GRANT USAGE, SELECT ON SEQUENCE portfolio_engagement_staging_id_seq TO service_role, authenticated;

-- ============================================================================
-- Part 2: Create Postgres function to process staged data
-- ============================================================================

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
    distinct_id,
    portfolio_ticker,
    creator_id,
    total_profile_views,
    total_pdp_views,
    total_copies,
    total_liquidations,
    total_subscriptions,
    synced_at
  )
  SELECT
    distinct_id,
    portfolio_ticker,
    creator_id,
    total_profile_views,
    total_pdp_views,
    total_copies,
    total_liquidations,
    total_subscriptions,
    synced_at
  FROM portfolio_engagement_staging
  ON CONFLICT (distinct_id, portfolio_ticker, creator_id) DO UPDATE SET
    total_profile_views = EXCLUDED.total_profile_views,
    total_pdp_views = EXCLUDED.total_pdp_views,
    total_copies = EXCLUDED.total_copies,
    total_liquidations = EXCLUDED.total_liquidations,
    total_subscriptions = EXCLUDED.total_subscriptions,
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
Uses set-based SQL for 10-50x performance vs JavaScript loops.
Returns (records_processed, records_inserted).';

-- ============================================================================
-- Part 3: Helper function to clear staging table
-- ============================================================================

CREATE OR REPLACE FUNCTION clear_portfolio_engagement_staging()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count bigint;
BEGIN
  -- Get count before truncating
  SELECT COUNT(*) INTO v_count FROM portfolio_engagement_staging;

  -- Use TRUNCATE instead of DELETE (bypasses RLS and is much faster)
  TRUNCATE TABLE portfolio_engagement_staging;

  RETURN v_count;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION clear_portfolio_engagement_staging() TO service_role, authenticated;

COMMENT ON FUNCTION clear_portfolio_engagement_staging() IS
'Truncates portfolio_engagement_staging table. Uses TRUNCATE to bypass RLS and improve performance.';
