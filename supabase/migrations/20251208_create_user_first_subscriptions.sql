-- Migration: Create user_first_subscriptions table
-- Created: 2025-12-08
-- Purpose: Store timestamp of first premium subscription per user
--          Used by analyze-subscription-sequences to analyze conversion paths

CREATE TABLE IF NOT EXISTS user_first_subscriptions (
  user_id TEXT PRIMARY KEY,
  first_subscription_time TIMESTAMPTZ NOT NULL,
  first_app_open_time TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_user_first_subscriptions_subscription_time
  ON user_first_subscriptions(first_subscription_time);

CREATE INDEX IF NOT EXISTS idx_user_first_subscriptions_both_timestamps
  ON user_first_subscriptions(user_id)
  WHERE first_subscription_time IS NOT NULL AND first_app_open_time IS NOT NULL;

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON user_first_subscriptions TO service_role, authenticated;

COMMENT ON TABLE user_first_subscriptions IS
'Stores timestamp of first premium subscription per user (net refunds).
Data source: Mixpanel chart 87078016 - Total Subscriptions (net refunds)
Populated by sync-first-subscription-users edge function.
Used by analyze-subscription-sequences to analyze creator/portfolio viewing patterns before subscription.';

-- =======================
-- Log Migration
-- =======================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Created user_first_subscriptions table';
  RAISE NOTICE '   - Stores first subscription timestamp per user';
  RAISE NOTICE '   - Data source: Mixpanel chart 87078016';
  RAISE NOTICE '   - Used for subscription conversion path analysis';
  RAISE NOTICE '';
END $$;
