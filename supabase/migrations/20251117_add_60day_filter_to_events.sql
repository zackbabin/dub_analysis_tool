-- Add 60-day rolling window filter to event processing
-- Changes event accumulation from "replace all" to "accumulate + filter last 60 days"
-- Date: 2025-11-17

-- ============================================================================
-- Part 1: Add index on event_time for fast 60-day filtering
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_staging_event_time ON raw_mixpanel_events_staging(event_time);

COMMENT ON INDEX idx_staging_event_time IS
'Index for fast 60-day filtering in process_raw_events_to_profiles()';

-- ============================================================================
-- Part 2: Update process_raw_events_to_profiles to filter last 60 days
-- ============================================================================

CREATE OR REPLACE FUNCTION process_raw_events_to_profiles(synced_at timestamptz)
RETURNS TABLE (
  profiles_processed bigint,
  events_processed bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profiles_processed bigint;
  v_events_processed bigint;
  v_cutoff_date timestamptz;
BEGIN
  -- Calculate 60-day cutoff (from synced_at, not NOW() for consistency)
  v_cutoff_date := synced_at - INTERVAL '60 days';

  -- Count events being processed (last 60 days only)
  SELECT COUNT(*) INTO v_events_processed
  FROM raw_mixpanel_events_staging
  WHERE event_time >= v_cutoff_date;

  -- Process events and upsert to subscribers_insights using set-based SQL
  -- This is 10-50x faster than JavaScript loops
  -- CRITICAL: Only aggregate events from last 60 days (rolling window)
  WITH event_aggregates AS (
    SELECT
      distinct_id,
      -- Account properties
      BOOL_OR(event_name = 'BankAccountLinked') AS linked_bank_account,

      -- Event counts - copies with premium/regular split
      COUNT(*) FILTER (WHERE event_name = 'DubAutoCopyInitiated') AS total_copies,
      COUNT(*) FILTER (WHERE event_name = 'DubAutoCopyInitiated'
        AND (properties->>'creatorType' = 'premiumCreator'
          OR properties->>'creatorType' ILIKE '%premium%')) AS total_premium_copies,
      COUNT(*) FILTER (WHERE event_name = 'DubAutoCopyInitiated'
        AND (properties->>'creatorType' IS NULL
          OR (properties->>'creatorType' != 'premiumCreator'
            AND properties->>'creatorType' NOT ILIKE '%premium%'))) AS total_regular_copies,

      -- Portfolio views with premium/regular split
      COUNT(*) FILTER (WHERE event_name = 'Viewed Portfolio Details'
        AND (properties->>'creatorType' = 'premiumCreator'
          OR properties->>'creatorType' ILIKE '%premium%')) AS premium_pdp_views,
      COUNT(*) FILTER (WHERE event_name = 'Viewed Portfolio Details'
        AND (properties->>'creatorType' IS NULL
          OR (properties->>'creatorType' != 'premiumCreator'
            AND properties->>'creatorType' NOT ILIKE '%premium%'))) AS regular_pdp_views,

      -- Creator profile views with premium/regular split
      COUNT(*) FILTER (WHERE event_name = 'Viewed Creator Profile'
        AND (properties->>'creatorType' = 'premiumCreator'
          OR properties->>'creatorType' ILIKE '%premium%')) AS premium_creator_profile_views,
      COUNT(*) FILTER (WHERE event_name = 'Viewed Creator Profile'
        AND (properties->>'creatorType' IS NULL
          OR (properties->>'creatorType' != 'premiumCreator'
            AND properties->>'creatorType' NOT ILIKE '%premium%'))) AS regular_creator_profile_views,

      -- Other event counts (no premium/regular split)
      COUNT(*) FILTER (WHERE event_name = 'AchTransferInitiated') AS total_ach_transfers,
      COUNT(*) FILTER (WHERE event_name = 'Viewed Creator Paywall') AS paywall_views,
      COUNT(*) FILTER (WHERE event_name = 'SubscriptionCreated') AS total_subscriptions,
      COUNT(*) FILTER (WHERE event_name = '$ae_session') AS app_sessions,
      COUNT(*) FILTER (WHERE event_name = 'Viewed Stripe Modal') AS stripe_modal_views,
      COUNT(*) FILTER (WHERE event_name = 'Tapped Creator Card') AS creator_card_taps,
      COUNT(*) FILTER (WHERE event_name = 'Tapped Portfolio Card') AS portfolio_card_taps,

      -- Metadata
      COUNT(*) AS events_count_per_user
    FROM raw_mixpanel_events_staging
    WHERE event_time >= v_cutoff_date  -- CRITICAL: Only last 60 days
    GROUP BY distinct_id
  )
  INSERT INTO subscribers_insights (
    distinct_id,
    linked_bank_account,
    total_copies,
    total_regular_copies,
    total_premium_copies,
    regular_pdp_views,
    premium_pdp_views,
    regular_creator_profile_views,
    premium_creator_profile_views,
    total_ach_transfers,
    paywall_views,
    total_subscriptions,
    app_sessions,
    stripe_modal_views,
    creator_card_taps,
    portfolio_card_taps,
    updated_at,
    events_processed
  )
  SELECT
    event_aggregates.distinct_id,
    event_aggregates.linked_bank_account,
    event_aggregates.total_copies,
    event_aggregates.total_regular_copies,
    event_aggregates.total_premium_copies,
    event_aggregates.regular_pdp_views,
    event_aggregates.premium_pdp_views,
    event_aggregates.regular_creator_profile_views,
    event_aggregates.premium_creator_profile_views,
    event_aggregates.total_ach_transfers,
    event_aggregates.paywall_views,
    event_aggregates.total_subscriptions,
    event_aggregates.app_sessions,
    event_aggregates.stripe_modal_views,
    event_aggregates.creator_card_taps,
    event_aggregates.portfolio_card_taps,
    synced_at,
    event_aggregates.events_count_per_user
  FROM event_aggregates
  ON CONFLICT (distinct_id) DO UPDATE SET
    -- Account properties: Use OR for linked_bank_account (once true, stays true)
    linked_bank_account = subscribers_insights.linked_bank_account OR EXCLUDED.linked_bank_account,

    -- Event metrics: REPLACE with new totals (60-day rolling window)
    total_copies = EXCLUDED.total_copies,
    total_regular_copies = EXCLUDED.total_regular_copies,
    total_premium_copies = EXCLUDED.total_premium_copies,
    regular_pdp_views = EXCLUDED.regular_pdp_views,
    premium_pdp_views = EXCLUDED.premium_pdp_views,
    regular_creator_profile_views = EXCLUDED.regular_creator_profile_views,
    premium_creator_profile_views = EXCLUDED.premium_creator_profile_views,
    total_ach_transfers = EXCLUDED.total_ach_transfers,
    paywall_views = EXCLUDED.paywall_views,
    total_subscriptions = EXCLUDED.total_subscriptions,
    app_sessions = EXCLUDED.app_sessions,
    stripe_modal_views = EXCLUDED.stripe_modal_views,
    creator_card_taps = EXCLUDED.creator_card_taps,
    portfolio_card_taps = EXCLUDED.portfolio_card_taps,

    -- Metadata: update with latest values
    updated_at = EXCLUDED.updated_at,
    events_processed = EXCLUDED.events_processed;

  -- Count profiles processed
  GET DIAGNOSTICS v_profiles_processed = ROW_COUNT;

  -- Return stats
  RETURN QUERY SELECT v_profiles_processed, v_events_processed;
END;
$$;

COMMENT ON FUNCTION process_raw_events_to_profiles(timestamptz) IS
'Processes raw events from staging table into user profiles in subscribers_insights.
Uses set-based SQL for 10-50x performance vs JavaScript loops.
CRITICAL: Only aggregates events from last 60 days (rolling window).
Events older than 60 days remain in staging but are not counted.
Returns (profiles_processed, events_processed).';

-- ============================================================================
-- Part 3: Helper function to clean old events (optional maintenance)
-- ============================================================================

CREATE OR REPLACE FUNCTION cleanup_old_events(keep_days integer DEFAULT 90)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted bigint;
  v_cutoff_date timestamptz;
BEGIN
  -- Calculate cutoff date
  v_cutoff_date := NOW() - (keep_days || ' days')::interval;

  -- Delete old events
  DELETE FROM raw_mixpanel_events_staging
  WHERE event_time < v_cutoff_date;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION cleanup_old_events(integer) IS
'Deletes events older than specified days (default 90) from staging table.
This is optional maintenance to prevent unbounded growth.
Should be run monthly or when staging table gets too large.';

GRANT EXECUTE ON FUNCTION cleanup_old_events(integer) TO service_role, authenticated;
