-- Drop subscription_engagement_summary materialized view (no longer used)
-- The 4 subscriber vs non-subscriber engagement metric cards were removed from Premium Creator Analysis
-- Date: 2025-11-15

-- Drop the refresh function first
DROP FUNCTION IF EXISTS refresh_subscription_engagement_summary();

-- Drop the materialized view
DROP MATERIALIZED VIEW IF EXISTS subscription_engagement_summary;

-- Verification
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_matviews WHERE matviewname = 'subscription_engagement_summary'
  ) THEN
    RAISE EXCEPTION '⚠️ subscription_engagement_summary still exists!';
  ELSE
    RAISE NOTICE '✅ subscription_engagement_summary successfully dropped';
  END IF;
END $$;
