-- Flush data from subscribers_insights table
-- WARNING: This deletes all user data. Use with caution!

-- ==============================================================================
-- SAFETY CHECK: Show current row counts before flushing
-- ==============================================================================

SELECT
  'subscribers_insights' as table_name,
  COUNT(*) as current_row_count,
  MAX(updated_at) as latest_update
FROM subscribers_insights;

-- ==============================================================================
-- OPTION 1: TRUNCATE (fastest, resets sequences, cannot be rolled back)
-- ==============================================================================

-- Uncomment to use TRUNCATE (faster but more destructive):
-- TRUNCATE TABLE subscribers_insights CASCADE;

-- ==============================================================================
-- OPTION 2: DELETE (slower, can be rolled back if in a transaction)
-- ==============================================================================

-- Recommended: Use DELETE for safety (can be rolled back)

BEGIN;

-- Delete all rows from subscribers_insights
DELETE FROM subscribers_insights;

-- Verify deletion
SELECT
  'subscribers_insights' as table_name,
  COUNT(*) as remaining_rows
FROM subscribers_insights;

-- Uncomment to commit changes:
-- COMMIT;

-- Or rollback if you changed your mind:
ROLLBACK;

-- ==============================================================================
-- POST-FLUSH: Refresh materialized views that depend on these tables
-- ==============================================================================

-- After flushing, you should refresh views that depend on this data:
-- REFRESH MATERIALIZED VIEW main_analysis;
-- REFRESH MATERIALIZED VIEW copy_engagement_summary;
-- REFRESH MATERIALIZED VIEW subscription_engagement_summary;
-- REFRESH MATERIALIZED VIEW portfolio_creator_engagement_metrics;
-- REFRESH MATERIALIZED VIEW premium_creator_breakdown;

-- ==============================================================================
-- NOTES
-- ==============================================================================

-- CASCADE behavior:
-- - TRUNCATE CASCADE will also delete data from tables that reference this table
-- - DELETE does not cascade by default (foreign key constraints may prevent deletion)

-- To re-populate after flushing:
-- 1. Run sync-mixpanel-user-events to fetch event data
-- 2. Run sync-mixpanel-user-properties-v2 to fetch user properties
-- 3. Refresh materialized views
