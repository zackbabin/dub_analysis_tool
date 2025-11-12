-- Create subscribers_insights_v2 table for Event Export API approach
-- Parallel implementation to test Export API without disrupting existing Insights API
-- Date: 2025-11-12

CREATE TABLE IF NOT EXISTS subscribers_insights_v2 (
  distinct_id TEXT PRIMARY KEY,

  -- User Profile Properties (from event properties)
  income TEXT,
  net_worth TEXT,
  investing_activity TEXT,
  investing_experience_years INT,
  investing_objective TEXT,
  investment_type TEXT,
  acquisition_survey TEXT,

  -- Account Properties (from event properties)
  -- Note: available_copy_credits and buying_power may not be available in events
  linked_bank_account BOOLEAN DEFAULT FALSE,
  available_copy_credits NUMERIC DEFAULT 0,
  buying_power NUMERIC DEFAULT 0,

  -- Financial Metrics (from event properties)
  -- Note: May not be fully available in events - will start with what we can get
  total_deposits NUMERIC DEFAULT 0,
  total_deposit_count INT DEFAULT 0,
  total_withdrawals NUMERIC DEFAULT 0,
  total_withdrawal_count INT DEFAULT 0,

  -- Portfolio Metrics (from event properties)
  -- Note: May not be available in events
  active_created_portfolios INT DEFAULT 0,
  lifetime_created_portfolios INT DEFAULT 0,

  -- Event-Counted Metrics (12 events from Export API)
  -- Simplified: No premium/regular split since we can't distinguish from events
  total_copies INT DEFAULT 0,                    -- Count: DubAutoCopyInitiated
  total_pdp_views INT DEFAULT 0,                 -- Count: Viewed Portfolio Details
  total_creator_profile_views INT DEFAULT 0,     -- Count: Viewed Creator Profile
  total_ach_transfers INT DEFAULT 0,             -- Count: AchTransferInitiated
  paywall_views INT DEFAULT 0,                   -- Count: Viewed Creator Paywall
  total_subscriptions INT DEFAULT 0,             -- Count: SubscriptionCreated
  app_sessions INT DEFAULT 0,                    -- Count: $ae_session
  discover_tab_views INT DEFAULT 0,              -- Count: Viewed Discover Tab
  stripe_modal_views INT DEFAULT 0,              -- Count: Viewed Stripe Modal
  creator_card_taps INT DEFAULT 0,               -- Count: Tapped Creator Card
  portfolio_card_taps INT DEFAULT 0,             -- Count: Tapped Portfolio Card

  -- Metrics Not Available (no matching events)
  -- Keeping columns for schema parity but will remain NULL/0
  leaderboard_tab_views INT DEFAULT 0,
  premium_tab_views INT DEFAULT 0,

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

CREATE INDEX IF NOT EXISTS idx_subscribers_v2_total_copies
ON subscribers_insights_v2(total_copies)
WHERE total_copies > 0;

CREATE INDEX IF NOT EXISTS idx_subscribers_v2_updated_at
ON subscribers_insights_v2(updated_at DESC);

-- Grant permissions
GRANT SELECT ON subscribers_insights_v2 TO anon, authenticated;

-- Add comments
COMMENT ON TABLE subscribers_insights_v2 IS
'Test table for Event Export API approach. Populated from raw Mixpanel events instead of Insights API aggregations. Parallel implementation to compare with subscribers_insights.';

COMMENT ON COLUMN subscribers_insights_v2.data_source IS
'Always "export_api" to distinguish from Insights API data in subscribers_insights table';

COMMENT ON COLUMN subscribers_insights_v2.events_processed IS
'Number of events that contributed to this user profile (for debugging/validation)';

COMMENT ON COLUMN subscribers_insights_v2.first_event_time IS
'Timestamp of earliest event for this user (from event properties.time)';

COMMENT ON COLUMN subscribers_insights_v2.last_event_time IS
'Timestamp of most recent event for this user (from event properties.time)';
