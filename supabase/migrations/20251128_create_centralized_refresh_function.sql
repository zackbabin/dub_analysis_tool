-- Migration: Create centralized refresh function for all materialized views
-- Created: 2025-11-28
-- Purpose: Single function to refresh all materialized views in correct dependency order
--
-- Benefits:
-- - Ensures views refresh in correct dependency order
-- - Single point of control for all refreshes
-- - Easier to maintain and update
-- - Prevents data staleness issues

-- Drop old individual refresh functions that are no longer needed
DROP FUNCTION IF EXISTS refresh_copy_engagement_summary();
DROP FUNCTION IF EXISTS refresh_subscription_engagement_summary();

-- Create centralized refresh function
CREATE OR REPLACE FUNCTION refresh_all_materialized_views()
RETURNS TEXT AS $$
DECLARE
  start_time TIMESTAMP;
  end_time TIMESTAMP;
  duration INTERVAL;
  result_text TEXT;
BEGIN
  start_time := clock_timestamp();

  RAISE NOTICE '';
  RAISE NOTICE '=== Starting Materialized View Refresh ===';
  RAISE NOTICE 'Time: %', start_time;
  RAISE NOTICE '';

  -- LEVEL 1: Base materialized views (no dependencies on other mat views)
  -- These can technically run in parallel but we do them sequentially for simplicity

  RAISE NOTICE '→ Level 1: Refreshing base materialized views...';

  -- 1. main_analysis (subscribers_insights + user_portfolio_creator_engagement)
  RAISE NOTICE '  → Refreshing main_analysis...';
  REFRESH MATERIALIZED VIEW main_analysis;
  RAISE NOTICE '  ✓ main_analysis refreshed';

  -- 2. portfolio_creator_engagement_metrics (user_portfolio_creator_engagement)
  RAISE NOTICE '  → Refreshing portfolio_creator_engagement_metrics...';
  REFRESH MATERIALIZED VIEW portfolio_creator_engagement_metrics;
  RAISE NOTICE '  ✓ portfolio_creator_engagement_metrics refreshed';

  -- 3. enriched_support_conversations (raw_support_conversations + subscribers_insights)
  RAISE NOTICE '  → Refreshing enriched_support_conversations...';
  -- Try concurrent first (has unique index), fall back to regular if needed
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY enriched_support_conversations;
    RAISE NOTICE '  ✓ enriched_support_conversations refreshed (CONCURRENT)';
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE '  ⚠ Concurrent refresh failed, using regular refresh';
      REFRESH MATERIALIZED VIEW enriched_support_conversations;
      RAISE NOTICE '  ✓ enriched_support_conversations refreshed (REGULAR)';
  END;

  RAISE NOTICE '';
  RAISE NOTICE '→ Level 2+: All other views are regular views and auto-update';
  RAISE NOTICE '  ✓ copy_engagement_summary (regular view, auto-updated)';
  RAISE NOTICE '  ✓ subscription_engagement_summary (regular view, auto-updated)';
  RAISE NOTICE '  ✓ hidden_gems_portfolios (regular view, auto-updated)';
  RAISE NOTICE '  ✓ premium_creator_breakdown (regular view, auto-updated)';
  RAISE NOTICE '  ✓ All other dependent views (auto-updated)';

  end_time := clock_timestamp();
  duration := end_time - start_time;

  RAISE NOTICE '';
  RAISE NOTICE '=== Materialized View Refresh Complete ===';
  RAISE NOTICE 'Duration: %', duration;
  RAISE NOTICE 'Refreshed: 3 materialized views';
  RAISE NOTICE 'Auto-updated: All regular views';
  RAISE NOTICE '';

  result_text := format('Successfully refreshed 3 materialized views in %s', duration);
  RETURN result_text;

EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE '';
    RAISE NOTICE '❌ ERROR during materialized view refresh';
    RAISE NOTICE 'Error: %', SQLERRM;
    RAISE NOTICE 'Detail: %', SQLSTATE;
    RAISE NOTICE '';
    RAISE EXCEPTION 'Materialized view refresh failed: %', SQLERRM;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION refresh_all_materialized_views() TO service_role;

-- Add comment
COMMENT ON FUNCTION refresh_all_materialized_views() IS
'Centralized function to refresh all materialized views in correct dependency order.
Refreshes 3 base materialized views:
1. main_analysis
2. portfolio_creator_engagement_metrics
3. enriched_support_conversations

All other views are regular views that auto-update.
Called by edge functions after data sync operations.';

-- Log the changes
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Created centralized refresh function';
  RAISE NOTICE '   - refresh_all_materialized_views()';
  RAISE NOTICE '   - Refreshes 3 materialized views in dependency order';
  RAISE NOTICE '   - All other views auto-update (regular views)';
  RAISE NOTICE '';
  RAISE NOTICE '✅ Removed obsolete refresh functions';
  RAISE NOTICE '   - refresh_copy_engagement_summary() (no longer needed)';
  RAISE NOTICE '   - refresh_subscription_engagement_summary() (no longer needed)';
  RAISE NOTICE '';
  RAISE NOTICE 'Edge functions should now call: refresh_all_materialized_views()';
  RAISE NOTICE '';
END $$;
