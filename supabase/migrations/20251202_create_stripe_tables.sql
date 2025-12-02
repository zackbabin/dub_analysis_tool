-- Migration: Create Stripe subscription tables
-- Date: 2025-12-02
-- Purpose: Store Stripe Connected Accounts and Subscriptions data for Premium Creator Analysis

-- ============================================================================
-- STEP 1: Create stripe_connected_accounts table
-- ============================================================================

CREATE TABLE IF NOT EXISTS stripe_connected_accounts (
  id BIGSERIAL PRIMARY KEY,
  stripe_account_id TEXT NOT NULL UNIQUE,

  -- Creator identification (from individual.account field in Stripe)
  creator_name TEXT,
  creator_username TEXT, -- For future mapping to internal creator system

  -- Account details
  account_type TEXT, -- Standard, Express, Custom
  charges_enabled BOOLEAN DEFAULT false,
  payouts_enabled BOOLEAN DEFAULT false,

  -- Store full account object for reference
  metadata JSONB,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_stripe_accounts_account_id
ON stripe_connected_accounts (stripe_account_id);

CREATE INDEX IF NOT EXISTS idx_stripe_accounts_creator_username
ON stripe_connected_accounts (creator_username);

CREATE INDEX IF NOT EXISTS idx_stripe_accounts_synced_at
ON stripe_connected_accounts (synced_at DESC);

-- ============================================================================
-- STEP 2: Create stripe_subscriptions table
-- ============================================================================

CREATE TABLE IF NOT EXISTS stripe_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  stripe_subscription_id TEXT NOT NULL UNIQUE,

  -- Foreign key to connected account
  stripe_account_id TEXT NOT NULL,

  -- Subscription details
  stripe_customer_id TEXT,
  stripe_price_id TEXT,
  status TEXT NOT NULL, -- active, canceled, incomplete, past_due, etc.

  -- Refund/cancellation tracking
  is_refunded BOOLEAN DEFAULT false,
  cancellation_reason TEXT, -- From cancellation_details.reason

  -- Timestamps from Stripe
  subscription_created_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,

  -- Store full subscription object for reference
  metadata JSONB,

  -- Sync tracking
  synced_at TIMESTAMPTZ DEFAULT NOW(),

  -- Foreign key constraint
  FOREIGN KEY (stripe_account_id)
    REFERENCES stripe_connected_accounts(stripe_account_id)
    ON DELETE CASCADE
);

-- Create indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_stripe_subscriptions_subscription_id
ON stripe_subscriptions (stripe_subscription_id);

CREATE INDEX IF NOT EXISTS idx_stripe_subscriptions_account_id
ON stripe_subscriptions (stripe_account_id);

CREATE INDEX IF NOT EXISTS idx_stripe_subscriptions_status
ON stripe_subscriptions (status);

CREATE INDEX IF NOT EXISTS idx_stripe_subscriptions_created_at
ON stripe_subscriptions (subscription_created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stripe_subscriptions_synced_at
ON stripe_subscriptions (synced_at DESC);

-- Composite index for common queries
CREATE INDEX IF NOT EXISTS idx_stripe_subscriptions_account_status
ON stripe_subscriptions (stripe_account_id, status);

-- ============================================================================
-- STEP 3: Create sync log table
-- ============================================================================

CREATE TABLE IF NOT EXISTS stripe_sync_log (
  id BIGSERIAL PRIMARY KEY,
  sync_type TEXT NOT NULL, -- 'full', 'incremental', 'accounts_only', 'subscriptions_only'
  status TEXT NOT NULL, -- 'started', 'completed', 'failed'

  -- Sync statistics
  accounts_synced INTEGER DEFAULT 0,
  subscriptions_synced INTEGER DEFAULT 0,
  errors_count INTEGER DEFAULT 0,

  -- Error details
  error_message TEXT,
  error_details JSONB,

  -- Timestamps
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_stripe_sync_log_started_at
ON stripe_sync_log (started_at DESC);

-- ============================================================================
-- STEP 4: Create aggregated view for UI
-- ============================================================================

CREATE OR REPLACE VIEW stripe_subscription_metrics_by_account AS
WITH subscription_stats AS (
  SELECT
    stripe_account_id,

    -- Total subscriptions (all time, excluding refunded)
    COUNT(*) FILTER (WHERE NOT is_refunded) AS total_subscriptions_net,

    -- Active subscriptions (status='active' AND not expired AND not refunded)
    COUNT(*) FILTER (
      WHERE status = 'active'
      AND NOT is_refunded
      AND (current_period_end IS NULL OR current_period_end > NOW())
    ) AS active_subscriptions_net,

    -- Additional metrics for future use
    COUNT(*) FILTER (WHERE is_refunded) AS total_refunded,
    COUNT(*) FILTER (WHERE status = 'canceled') AS total_canceled,

    MAX(synced_at) AS last_synced_at
  FROM stripe_subscriptions
  GROUP BY stripe_account_id
)
SELECT
  sca.stripe_account_id,
  sca.creator_name,
  sca.creator_username,
  sca.account_type,
  COALESCE(ss.total_subscriptions_net, 0) AS total_subscriptions_net,
  COALESCE(ss.active_subscriptions_net, 0) AS active_subscriptions_net,
  COALESCE(ss.total_refunded, 0) AS total_refunded,
  COALESCE(ss.total_canceled, 0) AS total_canceled,
  COALESCE(ss.last_synced_at, sca.synced_at) AS last_synced_at
FROM stripe_connected_accounts sca
LEFT JOIN subscription_stats ss ON sca.stripe_account_id = ss.stripe_account_id
ORDER BY total_subscriptions_net DESC NULLS LAST;

-- ============================================================================
-- STEP 5: Grant permissions
-- ============================================================================

GRANT SELECT ON stripe_connected_accounts TO anon, authenticated;
GRANT SELECT ON stripe_subscriptions TO anon, authenticated;
GRANT SELECT ON stripe_sync_log TO anon, authenticated;
GRANT SELECT ON stripe_subscription_metrics_by_account TO anon, authenticated;

-- ============================================================================
-- STEP 6: Add comments
-- ============================================================================

COMMENT ON TABLE stripe_connected_accounts IS
'Stores Stripe Connected Account data for premium creators. Synced by sync-stripe-subscriptions Edge Function.';

COMMENT ON TABLE stripe_subscriptions IS
'Stores subscription data for each Connected Account. Tracks refunds via cancellation_details.reason === payment_disputed.';

COMMENT ON TABLE stripe_sync_log IS
'Tracks sync operations for Stripe data, including success/failure and statistics.';

COMMENT ON VIEW stripe_subscription_metrics_by_account IS
'Aggregated subscription metrics by Connected Account. Shows net values (excluding refunded subscriptions).';
