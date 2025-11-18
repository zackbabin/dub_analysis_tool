-- Update process_raw_events_to_profiles function to use new column names
-- This function is no longer needed for Insights API approach, but keeping it updated for backward compatibility

-- Drop and recreate the function with updated column names
DROP FUNCTION IF EXISTS process_raw_events_to_profiles(timestamp with time zone);

CREATE OR REPLACE FUNCTION process_raw_events_to_profiles(synced_at timestamp with time zone)
RETURNS TABLE(profiles_processed bigint, events_processed bigint)
LANGUAGE plpgsql
AS $$
DECLARE
  v_profiles_processed bigint;
  v_events_processed bigint;
BEGIN
  -- Count events to be processed (last 60 days)
  SELECT COUNT(*) INTO v_events_processed
  FROM raw_mixpanel_events_staging
  WHERE event_time >= (synced_at - INTERVAL '60 days');

  -- Aggregate raw events into user profiles using set-based SQL
  -- Only process events from last 60 days for rolling 60-day window
  INSERT INTO subscribers_insights (
    distinct_id,
    total_copies,
    total_regular_copies,
    total_premium_copies,
    regular_pdp_views,
    premium_pdp_views,
    paywall_views,
    regular_creator_views,
    premium_creator_views,
    total_subscriptions,
    app_sessions,
    stripe_modal_views,
    creator_card_taps,
    portfolio_card_taps,
    updated_at
  )
  SELECT
    distinct_id,

    -- B. Total Copies (DubAutoCopyInitiated - all)
    COUNT(*) FILTER (WHERE event_name = 'DubAutoCopyInitiated') AS total_copies,

    -- C. Total Regular Copies (DubAutoCopyInitiated - NOT premium)
    COUNT(*) FILTER (WHERE event_name = 'DubAutoCopyInitiated'
      AND (properties->>'creatorType' IS NULL
        OR properties->>'creatorType' NOT ILIKE '%premium%')) AS total_regular_copies,

    -- D. Total Premium Copies (DubAutoCopyInitiated - premium)
    COUNT(*) FILTER (WHERE event_name = 'DubAutoCopyInitiated'
      AND (properties->>'creatorType' ILIKE '%premium%'
        OR properties->>'creatorType' ILIKE '%premium%')) AS total_premium_copies,

    -- E. Regular PDP Views (Viewed Portfolio Details - NOT premium)
    COUNT(*) FILTER (WHERE event_name = 'Viewed Portfolio Details'
      AND (properties->>'creatorType' IS NULL
        OR properties->>'creatorType' NOT ILIKE '%premium%')) AS regular_pdp_views,

    -- F. Premium PDP Views (Viewed Portfolio Details - premium)
    COUNT(*) FILTER (WHERE event_name = 'Viewed Portfolio Details'
      AND (properties->>'creatorType' ILIKE '%premium%'
        OR properties->>'creatorType' ILIKE '%premium%')) AS premium_pdp_views,

    -- G. Paywall Views
    COUNT(*) FILTER (WHERE event_name = 'Viewed Creator Paywall') AS paywall_views,

    -- H. Regular Creator Profile Views (Viewed Creator Profile - NOT premium)
    COUNT(*) FILTER (WHERE event_name = 'Viewed Creator Profile'
      AND (properties->>'creatorType' IS NULL
        OR properties->>'creatorType' NOT ILIKE '%premium%')) AS regular_creator_views,

    -- I. Premium Creator Profile Views (Viewed Creator Profile - premium)
    COUNT(*) FILTER (WHERE event_name = 'Viewed Creator Profile'
      AND (properties->>'creatorType' ILIKE '%premium%'
        OR properties->>'creatorType' ILIKE '%premium%')) AS premium_creator_views,

    -- J. Total Subscriptions
    COUNT(*) FILTER (WHERE event_name = 'SubscriptionCreated') AS total_subscriptions,

    -- K. App Sessions
    COUNT(*) FILTER (WHERE event_name = '$ae_session') AS app_sessions,

    -- O. Stripe Modal Views
    COUNT(*) FILTER (WHERE event_name = 'Viewed Stripe Modal') AS stripe_modal_views,

    -- P. Creator Card Taps
    COUNT(*) FILTER (WHERE event_name = 'Tapped Creator Card') AS creator_card_taps,

    -- Q. Portfolio Card Taps
    COUNT(*) FILTER (WHERE event_name = 'Tapped Portfolio Card') AS portfolio_card_taps,

    synced_at AS updated_at

  FROM raw_mixpanel_events_staging
  WHERE event_time >= (synced_at - INTERVAL '60 days')
  GROUP BY distinct_id

  ON CONFLICT (distinct_id) DO UPDATE SET
    total_copies = EXCLUDED.total_copies,
    total_regular_copies = EXCLUDED.total_regular_copies,
    total_premium_copies = EXCLUDED.total_premium_copies,
    regular_pdp_views = EXCLUDED.regular_pdp_views,
    premium_pdp_views = EXCLUDED.premium_pdp_views,
    paywall_views = EXCLUDED.paywall_views,
    regular_creator_views = EXCLUDED.regular_creator_views,
    premium_creator_views = EXCLUDED.premium_creator_views,
    total_subscriptions = EXCLUDED.total_subscriptions,
    app_sessions = EXCLUDED.app_sessions,
    stripe_modal_views = EXCLUDED.stripe_modal_views,
    creator_card_taps = EXCLUDED.creator_card_taps,
    portfolio_card_taps = EXCLUDED.portfolio_card_taps,
    updated_at = EXCLUDED.updated_at;

  GET DIAGNOSTICS v_profiles_processed = ROW_COUNT;

  RETURN QUERY SELECT v_profiles_processed, v_events_processed;
END;
$$;

COMMENT ON FUNCTION process_raw_events_to_profiles IS
'DEPRECATED: This function processes Export API events. For new syncs, use sync-mixpanel-user-events-v2 with Insights API.
Aggregates raw Mixpanel events from staging table into user profiles. Processes last 60 days of events for rolling window.';
