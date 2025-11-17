-- Add unique indexes to engagement summary materialized views
-- This enables REFRESH MATERIALIZED VIEW CONCURRENTLY for non-blocking refreshes
-- Date: 2025-11-17

-- Add unique index on copy_engagement_summary
-- did_copy is unique (only 2 values: true/false)
CREATE UNIQUE INDEX IF NOT EXISTS copy_engagement_summary_did_copy_idx
ON copy_engagement_summary(did_copy);

-- Add unique index on subscription_engagement_summary
-- did_subscribe is unique (only 2 values: true/false)
CREATE UNIQUE INDEX IF NOT EXISTS subscription_engagement_summary_did_subscribe_idx
ON subscription_engagement_summary(did_subscribe);

COMMENT ON INDEX copy_engagement_summary_did_copy_idx IS
'Unique index to enable concurrent refresh of copy_engagement_summary materialized view';

COMMENT ON INDEX subscription_engagement_summary_did_subscribe_idx IS
'Unique index to enable concurrent refresh of subscription_engagement_summary materialized view';
