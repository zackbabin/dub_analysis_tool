-- Create function for incremental upsert of subscriber insights
-- Event metrics (counts) are ADDED to existing values
-- Account properties updated with OR logic for linked_bank_account

CREATE OR REPLACE FUNCTION upsert_subscribers_incremental(profiles jsonb)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  profile jsonb;
BEGIN
  -- Iterate through each profile in the array
  FOR profile IN SELECT * FROM jsonb_array_elements(profiles)
  LOOP
    INSERT INTO subscribers_insights_v2 (
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
      events_processed,
      first_event_time,
      last_event_time
    )
    VALUES (
      (profile->>'distinct_id')::text,
      (profile->>'linked_bank_account')::boolean,
      (profile->>'total_copies')::integer,
      (profile->>'total_regular_copies')::integer,
      (profile->>'total_premium_copies')::integer,
      (profile->>'regular_pdp_views')::integer,
      (profile->>'premium_pdp_views')::integer,
      (profile->>'regular_creator_profile_views')::integer,
      (profile->>'premium_creator_profile_views')::integer,
      (profile->>'total_ach_transfers')::integer,
      (profile->>'paywall_views')::integer,
      (profile->>'total_subscriptions')::integer,
      (profile->>'app_sessions')::integer,
      (profile->>'stripe_modal_views')::integer,
      (profile->>'creator_card_taps')::integer,
      (profile->>'portfolio_card_taps')::integer,
      (profile->>'updated_at')::timestamptz,
      (profile->>'events_processed')::integer,
      (profile->>'first_event_time')::timestamptz,
      (profile->>'last_event_time')::timestamptz
    )
    ON CONFLICT (distinct_id) DO UPDATE SET
      -- Account properties: Use OR for linked_bank_account (once true, stays true)
      linked_bank_account = subscribers_insights_v2.linked_bank_account OR EXCLUDED.linked_bank_account,

      -- Event metrics: ADD new counts to existing totals (INCREMENTAL)
      total_copies = COALESCE(subscribers_insights_v2.total_copies, 0) + COALESCE(EXCLUDED.total_copies, 0),
      total_regular_copies = COALESCE(subscribers_insights_v2.total_regular_copies, 0) + COALESCE(EXCLUDED.total_regular_copies, 0),
      total_premium_copies = COALESCE(subscribers_insights_v2.total_premium_copies, 0) + COALESCE(EXCLUDED.total_premium_copies, 0),
      regular_pdp_views = COALESCE(subscribers_insights_v2.regular_pdp_views, 0) + COALESCE(EXCLUDED.regular_pdp_views, 0),
      premium_pdp_views = COALESCE(subscribers_insights_v2.premium_pdp_views, 0) + COALESCE(EXCLUDED.premium_pdp_views, 0),
      regular_creator_profile_views = COALESCE(subscribers_insights_v2.regular_creator_profile_views, 0) + COALESCE(EXCLUDED.regular_creator_profile_views, 0),
      premium_creator_profile_views = COALESCE(subscribers_insights_v2.premium_creator_profile_views, 0) + COALESCE(EXCLUDED.premium_creator_profile_views, 0),
      total_ach_transfers = COALESCE(subscribers_insights_v2.total_ach_transfers, 0) + COALESCE(EXCLUDED.total_ach_transfers, 0),
      paywall_views = COALESCE(subscribers_insights_v2.paywall_views, 0) + COALESCE(EXCLUDED.paywall_views, 0),
      total_subscriptions = COALESCE(subscribers_insights_v2.total_subscriptions, 0) + COALESCE(EXCLUDED.total_subscriptions, 0),
      app_sessions = COALESCE(subscribers_insights_v2.app_sessions, 0) + COALESCE(EXCLUDED.app_sessions, 0),
      stripe_modal_views = COALESCE(subscribers_insights_v2.stripe_modal_views, 0) + COALESCE(EXCLUDED.stripe_modal_views, 0),
      creator_card_taps = COALESCE(subscribers_insights_v2.creator_card_taps, 0) + COALESCE(EXCLUDED.creator_card_taps, 0),
      portfolio_card_taps = COALESCE(subscribers_insights_v2.portfolio_card_taps, 0) + COALESCE(EXCLUDED.portfolio_card_taps, 0),

      -- Metadata: update with latest values
      updated_at = EXCLUDED.updated_at,
      events_processed = COALESCE(subscribers_insights_v2.events_processed, 0) + COALESCE(EXCLUDED.events_processed, 0),
      first_event_time = LEAST(subscribers_insights_v2.first_event_time, EXCLUDED.first_event_time),
      last_event_time = GREATEST(subscribers_insights_v2.last_event_time, EXCLUDED.last_event_time);
  END LOOP;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION upsert_subscribers_incremental(jsonb) TO service_role;

-- Test the function (optional - comment out in production)
-- SELECT upsert_subscribers_incremental('[
--   {
--     "distinct_id": "test_user_123",
--     "linked_bank_account": true,
--     "total_copies": 8,
--     "total_regular_copies": 5,
--     "total_premium_copies": 3,
--     "regular_pdp_views": 10,
--     "premium_pdp_views": 5,
--     "total_subscriptions": 1,
--     "updated_at": "2025-11-13T00:00:00Z",
--     "events_processed": 10,
--     "first_event_time": "2025-11-13T00:00:00Z",
--     "last_event_time": "2025-11-13T01:00:00Z"
--   }
-- ]'::jsonb);
