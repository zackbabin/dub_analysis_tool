-- Move creator engagement processing to Postgres for 10-50x performance improvement
-- Similar pattern to portfolio engagement: stage raw data, process in Postgres
-- Date: 2025-11-18

-- ============================================================================
-- Part 1: Create staging table for raw creator engagement data
-- ============================================================================

CREATE UNLOGGED TABLE IF NOT EXISTS creator_engagement_staging (
  id bigserial PRIMARY KEY,
  distinct_id text NOT NULL,
  creator_id text NOT NULL,
  creator_username text,
  profile_view_count integer DEFAULT 0,
  did_subscribe boolean DEFAULT false,
  subscription_count integer DEFAULT 0,
  synced_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- UNLOGGED table: faster inserts, data not crash-safe (acceptable for staging)
-- No indexes: maximum insert speed

COMMENT ON TABLE creator_engagement_staging IS
'Staging table for raw creator engagement data. UNLOGGED for maximum insert performance. Cleared after processing.';

-- Grant permissions
GRANT SELECT, INSERT, DELETE, TRUNCATE ON creator_engagement_staging TO service_role, authenticated;
GRANT USAGE, SELECT ON SEQUENCE creator_engagement_staging_id_seq TO service_role, authenticated;

-- ============================================================================
-- Part 2: Create Postgres function to process staged data
-- ============================================================================

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
    distinct_id,
    creator_id,
    creator_username,
    profile_view_count,
    did_subscribe,
    subscription_count,
    synced_at
  )
  SELECT
    distinct_id,
    creator_id,
    creator_username,
    profile_view_count,
    did_subscribe,
    subscription_count,
    synced_at
  FROM creator_engagement_staging
  ON CONFLICT (distinct_id, creator_id) DO UPDATE SET
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

-- Grant execute permission
GRANT EXECUTE ON FUNCTION process_creator_engagement_staging() TO service_role, authenticated;

COMMENT ON FUNCTION process_creator_engagement_staging() IS
'Processes staged creator engagement data and upserts to user_creator_engagement.
Uses set-based SQL for 10-50x performance vs JavaScript loops.
Returns (records_processed, records_inserted).';

-- ============================================================================
-- Part 3: Helper function to clear staging table
-- ============================================================================

CREATE OR REPLACE FUNCTION clear_creator_engagement_staging()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count bigint;
BEGIN
  -- Get count before truncating
  SELECT COUNT(*) INTO v_count FROM creator_engagement_staging;

  -- Use TRUNCATE instead of DELETE (bypasses RLS and is much faster)
  TRUNCATE TABLE creator_engagement_staging;

  RETURN v_count;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION clear_creator_engagement_staging() TO service_role, authenticated;

COMMENT ON FUNCTION clear_creator_engagement_staging() IS
'Truncates creator_engagement_staging table. Uses TRUNCATE to bypass RLS and improve performance.';
