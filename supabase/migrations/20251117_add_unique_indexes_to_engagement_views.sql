-- Add unique indexes to engagement summary materialized views
-- This enables REFRESH MATERIALIZED VIEW CONCURRENTLY for non-blocking refreshes
-- Date: 2025-11-17

-- Add unique index on copy_engagement_summary
-- did_copy is unique (only 2 values: true/false)
CREATE UNIQUE INDEX IF NOT EXISTS copy_engagement_summary_did_copy_idx
ON copy_engagement_summary(did_copy);

COMMENT ON INDEX copy_engagement_summary_did_copy_idx IS
'Unique index to enable concurrent refresh of copy_engagement_summary materialized view';

-- Note: subscription_engagement_summary was dropped in 20251115_drop_subscription_engagement_summary.sql
-- so we don't create an index for it
