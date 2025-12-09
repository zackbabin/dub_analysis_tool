-- Drop Stripe tables and views
-- All Stripe functionality has been removed from the application

-- Drop view first (depends on tables)
DROP VIEW IF EXISTS stripe_subscription_metrics_by_account CASCADE;

-- Drop tables (in reverse order of dependencies)
DROP TABLE IF EXISTS stripe_subscriptions CASCADE;
DROP TABLE IF EXISTS stripe_connected_accounts CASCADE;
DROP TABLE IF EXISTS stripe_sync_log CASCADE;

-- Verification
DO $$
BEGIN
  RAISE NOTICE '✅ Dropped all Stripe tables and views';
  RAISE NOTICE '   - stripe_subscription_metrics_by_account view';
  RAISE NOTICE '   - stripe_subscriptions table';
  RAISE NOTICE '   - stripe_connected_accounts table';
  RAISE NOTICE '   - stripe_sync_log table';
END $$;
