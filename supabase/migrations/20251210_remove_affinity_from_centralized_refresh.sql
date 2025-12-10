-- Migration: Remove premium_creator_affinity_display from centralized refresh
-- Created: 2025-12-10
-- Purpose: Fix statement timeout by only refreshing affinity when creator data changes
-- Reason: Affinity table refresh is expensive and only needed when creator data changes,
--         not on every general sync. Should be called explicitly by sync-creator-data edge function.

-- Update centralized refresh function to remove affinity table
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

  RAISE NOTICE '→ Level 1: Refreshing base materialized views...';

  -- 1. main_analysis (subscribers_insights + user_portfolio_creator_engagement)
  RAISE NOTICE '  → Refreshing main_analysis...';
  REFRESH MATERIALIZED VIEW main_analysis;
  RAISE NOTICE '  ✓ main_analysis refreshed';

  -- 2. portfolio_creator_engagement_metrics (user_portfolio_creator_engagement)
  RAISE NOTICE '  → Refreshing portfolio_creator_engagement_metrics...';
  REFRESH MATERIALIZED VIEW portfolio_creator_engagement_metrics;
  RAISE NOTICE '  ✓ portfolio_creator_engagement_metrics refreshed';

  RAISE NOTICE '';
  RAISE NOTICE '→ Level 2+: All other views are regular views and auto-update';
  RAISE NOTICE '  ✓ enriched_support_conversations (regular view, auto-updated)';
  RAISE NOTICE '  ✓ copy_engagement_summary (regular view, auto-updated)';
  RAISE NOTICE '  ✓ subscription_engagement_summary (regular view, auto-updated)';
  RAISE NOTICE '  ✓ hidden_gems_portfolios (regular view, auto-updated)';
  RAISE NOTICE '  ✓ premium_creator_breakdown (regular view, auto-updated)';
  RAISE NOTICE '  ✓ All other dependent views (auto-updated)';
  RAISE NOTICE '';
  RAISE NOTICE '→ Note: premium_creator_affinity_display refreshed by sync-creator-data function';
  RAISE NOTICE '→ Note: premium_creator_retention_analysis refreshed by fetch-creator-retention function';

  end_time := clock_timestamp();
  duration := end_time - start_time;

  RAISE NOTICE '';
  RAISE NOTICE '=== Materialized View Refresh Complete ===';
  RAISE NOTICE 'Duration: %', duration;
  RAISE NOTICE 'Refreshed: 2 materialized views';
  RAISE NOTICE 'Auto-updated: All regular views';
  RAISE NOTICE '';

  result_text := format('Successfully refreshed 2 materialized views in %s', duration);
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

COMMENT ON FUNCTION refresh_all_materialized_views() IS
'Centralized function to refresh all materialized views in correct dependency order.
Refreshes 2 base materialized views:
1. main_analysis
2. portfolio_creator_engagement_metrics

Note:
- premium_creator_affinity_display refreshed explicitly by sync-creator-data edge function
- premium_creator_retention_analysis refreshed by fetch-creator-retention edge function
- All other views are regular views that auto-update

Called by edge functions after data sync operations.';

-- Log migration
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Removed premium_creator_affinity_display from centralized refresh';
  RAISE NOTICE '   - Only refreshes when creator data changes (via sync-creator-data)';
  RAISE NOTICE '   - Fixes timeout issue in centralized refresh';
  RAISE NOTICE '   - Now only refreshes 2 lightweight materialized views';
  RAISE NOTICE '';
END $$;
