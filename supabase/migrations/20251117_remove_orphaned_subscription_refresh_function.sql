-- Remove orphaned refresh_subscription_engagement_summary function
-- The subscription_engagement_summary view was dropped in 20251115_drop_subscription_engagement_summary.sql
-- but the refresh function was still being created, causing warnings

DROP FUNCTION IF EXISTS refresh_subscription_engagement_summary();

COMMENT ON DATABASE postgres IS 'Removed orphaned refresh function for dropped subscription_engagement_summary view';
