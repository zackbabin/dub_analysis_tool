-- Fix upsert_subscribers_incremental after removing first_event_time and last_event_time columns
-- The 20251116_remove_unused_timestamp_columns.sql removed columns that the function referenced
-- This fixes the function to work with the current schema
-- Date: 2025-11-16

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
      paywall_views,
      total_subscriptions,
      app_sessions,
      stripe_modal_views,
      creator_card_taps,
      portfolio_card_taps,
      updated_at
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
      (profile->>'paywall_views')::integer,
      (profile->>'total_subscriptions')::integer,
      (profile->>'app_sessions')::integer,
      (profile->>'stripe_modal_views')::integer,
      (profile->>'creator_card_taps')::integer,
      (profile->>'portfolio_card_taps')::integer,
      (profile->>'updated_at')::timestamptz
    )
    ON CONFLICT (distinct_id) DO UPDATE SET
      -- Account properties: Use OR for linked_bank_account (once true, stays true)
      linked_bank_account = subscribers_insights.linked_bank_account OR EXCLUDED.linked_bank_account,

      -- Event metrics: REPLACE with new totals (since we're fetching 45-day window each time)
      total_copies = EXCLUDED.total_copies,
      total_regular_copies = EXCLUDED.total_regular_copies,
      total_premium_copies = EXCLUDED.total_premium_copies,
      regular_pdp_views = EXCLUDED.regular_pdp_views,
      premium_pdp_views = EXCLUDED.premium_pdp_views,
      regular_creator_profile_views = EXCLUDED.regular_creator_profile_views,
      premium_creator_profile_views = EXCLUDED.premium_creator_profile_views,
      paywall_views = EXCLUDED.paywall_views,
      total_subscriptions = EXCLUDED.total_subscriptions,
      app_sessions = EXCLUDED.app_sessions,
      stripe_modal_views = EXCLUDED.stripe_modal_views,
      creator_card_taps = EXCLUDED.creator_card_taps,
      portfolio_card_taps = EXCLUDED.portfolio_card_taps,

      -- Metadata: update with latest values
      updated_at = EXCLUDED.updated_at;
  END LOOP;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION upsert_subscribers_incremental(jsonb) TO service_role;

COMMENT ON FUNCTION upsert_subscribers_incremental(jsonb) IS
'Upserts subscriber event data. REPLACES event counts (not incremental) since we fetch a 45-day rolling window each sync. Loop-based implementation - use upsert_subscribers_incremental_optimized for better performance.';
