-- Create subscribers_insights_v2 table for Event Export API approach
-- Parallel implementation to test Export API without disrupting existing Insights API
-- Date: 2025-11-13 (Updated)

CREATE TABLE IF NOT EXISTS subscribers_insights_v2 (
  distinct_id TEXT PRIMARY KEY,

  -- Account Properties (from specific events)
  linked_bank_account BOOLEAN DEFAULT FALSE,

  -- Event-Counted Metrics - Premium Split (11 events from Export API)
  -- Premium/Regular determined by creatorType property in events
  premium_copies INT DEFAULT 0,                    -- Count: DubAutoCopyInitiated (creatorType=premiumCreator)
  premium_pdp_views INT DEFAULT 0,                 -- Count: Viewed Portfolio Details (creatorType=premiumCreator)
  premium_creator_profile_views INT DEFAULT 0,     -- Count: Viewed Creator Profile (creatorType=premiumCreator)

  -- Event-Counted Metrics - Regular Split
  regular_copies INT DEFAULT 0,                    -- Count: DubAutoCopyInitiated (creatorType!=premiumCreator)
  regular_pdp_views INT DEFAULT 0,                 -- Count: Viewed Portfolio Details (creatorType!=premiumCreator)
  regular_creator_profile_views INT DEFAULT 0,     -- Count: Viewed Creator Profile (creatorType!=premiumCreator)

  -- Event-Counted Metrics - No Premium/Regular Split
  total_ach_transfers INT DEFAULT 0,               -- Count: AchTransferInitiated
  paywall_views INT DEFAULT 0,                     -- Count: Viewed Creator Paywall
  total_subscriptions INT DEFAULT 0,               -- Count: SubscriptionCreated
  app_sessions INT DEFAULT 0,                      -- Count: $ae_session
  stripe_modal_views INT DEFAULT 0,                -- Count: Viewed Stripe Modal
  creator_card_taps INT DEFAULT 0,                 -- Count: Tapped Creator Card
  portfolio_card_taps INT DEFAULT 0,               -- Count: Tapped Portfolio Card

  -- Metadata
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  data_source TEXT DEFAULT 'export_api',

  -- Track sync metadata
  events_processed INT DEFAULT 0,  -- How many events contributed to this user's data
  first_event_time TIMESTAMPTZ,    -- Timestamp of user's first event
  last_event_time TIMESTAMPTZ      -- Timestamp of user's last event
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_subscribers_v2_distinct_id
ON subscribers_insights_v2(distinct_id);

CREATE INDEX IF NOT EXISTS idx_subscribers_v2_total_subscriptions
ON subscribers_insights_v2(total_subscriptions)
WHERE total_subscriptions > 0;

CREATE INDEX IF NOT EXISTS idx_subscribers_v2_premium_copies
ON subscribers_insights_v2(premium_copies)
WHERE premium_copies > 0;

CREATE INDEX IF NOT EXISTS idx_subscribers_v2_regular_copies
ON subscribers_insights_v2(regular_copies)
WHERE regular_copies > 0;

CREATE INDEX IF NOT EXISTS idx_subscribers_v2_updated_at
ON subscribers_insights_v2(updated_at DESC);

-- Grant permissions
GRANT SELECT ON subscribers_insights_v2 TO anon, authenticated;

-- Add comments
COMMENT ON TABLE subscribers_insights_v2 IS
'Event Export API implementation. Populated from raw Mixpanel events. Premium/regular splits determined by creatorType property in events.';

COMMENT ON COLUMN subscribers_insights_v2.data_source IS
'Always "export_api" to distinguish from Insights API data in subscribers_insights table';

COMMENT ON COLUMN subscribers_insights_v2.events_processed IS
'Number of events that contributed to this user profile (for debugging/validation)';

COMMENT ON COLUMN subscribers_insights_v2.first_event_time IS
'Timestamp of earliest event for this user (from event properties.time)';

COMMENT ON COLUMN subscribers_insights_v2.last_event_time IS
'Timestamp of most recent event for this user (from event properties.time)';
