-- Migration: Drop premium_creator_portfolio_metrics table and related objects
-- Date: 2025-11-04
-- Purpose: Remove unused table - all portfolio metrics are now aggregated from user_portfolio_creator_engagement
--
-- Context:
--   - The comprehensive_fix_simple_architecture.sql migration changed portfolio_creator_engagement_metrics
--     to aggregate all metrics from user-level data (SUM(pdp_view_count), SUM(copy_count), etc.)
--   - premium_creator_portfolio_metrics was only storing total_pdp_views from Mixpanel chart 85810770
--   - This data is redundant since we already have it in user_portfolio_creator_engagement
--   - Removing this table simplifies architecture and eliminates a Mixpanel API call from sync
--
-- Impact:
--   - Saves 1 Mixpanel API call per sync (chart 85810770)
--   - Reduces sync time and complexity
--   - All existing queries continue to work (they use portfolio_creator_engagement_metrics)

-- ============================================================================
-- STEP 1: Drop dependent view
-- ============================================================================

DROP VIEW IF EXISTS premium_creator_portfolio_metrics_latest CASCADE;

-- ============================================================================
-- STEP 2: Drop the table
-- ============================================================================

DROP TABLE IF EXISTS premium_creator_portfolio_metrics CASCADE;

-- ============================================================================
-- Architecture Notes
-- ============================================================================

-- Portfolio metrics are now sourced from:
--   - user_portfolio_creator_engagement (base table)
--   - portfolio_creator_engagement_metrics (materialized view with aggregations)
--     - total_pdp_views: SUM(upce.pdp_view_count)
--     - total_copies: SUM(CASE WHEN upce.did_copy THEN upce.copy_count ELSE 0 END)
--     - total_liquidations: SUM(upce.liquidation_count)
--     - total_profile_views: from user_creator_engagement aggregate
--     - Subscription metrics: from premium_creator_metrics

COMMENT ON SCHEMA public IS
'Premium creator portfolio metrics removed 2025-11-04. All portfolio metrics aggregated from user_portfolio_creator_engagement.';
