-- Phase 3: Database Query Optimization - Apply All Indexes
-- Execute this script to create all performance indexes
-- Safe to run multiple times (uses IF NOT EXISTS)

-- ============================================================================
-- Base Table Indexes (from indexes.sql)
-- ============================================================================

-- Indexes for user_portfolio_creator_views (subscriptions)
CREATE INDEX IF NOT EXISTS idx_user_portfolio_creator_views_distinct_id
ON user_portfolio_creator_views(distinct_id);

CREATE INDEX IF NOT EXISTS idx_user_portfolio_creator_views_portfolio_creator
ON user_portfolio_creator_views(portfolio_ticker, creator_id);

CREATE INDEX IF NOT EXISTS idx_user_portfolio_creator_views_did_subscribe
ON user_portfolio_creator_views(did_subscribe);

CREATE INDEX IF NOT EXISTS idx_user_portfolio_creator_views_creator
ON user_portfolio_creator_views(creator_id);

-- Indexes for user_portfolio_creator_copies (copies)
CREATE INDEX IF NOT EXISTS idx_user_portfolio_creator_copies_distinct_id
ON user_portfolio_creator_copies(distinct_id);

CREATE INDEX IF NOT EXISTS idx_user_portfolio_creator_copies_portfolio_creator
ON user_portfolio_creator_copies(portfolio_ticker, creator_id);

CREATE INDEX IF NOT EXISTS idx_user_portfolio_creator_copies_did_copy
ON user_portfolio_creator_copies(did_copy);

CREATE INDEX IF NOT EXISTS idx_user_portfolio_creator_copies_creator
ON user_portfolio_creator_copies(creator_id);

-- Composite indexes for pattern analysis queries (analyze-subscription-patterns, analyze-copy-patterns)
CREATE INDEX IF NOT EXISTS idx_user_portfolio_creator_views_distinct_creator
ON user_portfolio_creator_views(distinct_id, creator_id);

CREATE INDEX IF NOT EXISTS idx_user_portfolio_creator_copies_distinct_creator
ON user_portfolio_creator_copies(distinct_id, creator_id);

-- Indexes for portfolio_view_events (sequence analysis)
CREATE INDEX IF NOT EXISTS idx_portfolio_view_events_distinct_id
ON portfolio_view_events(distinct_id);

CREATE INDEX IF NOT EXISTS idx_portfolio_view_events_event_time
ON portfolio_view_events(event_time);

CREATE INDEX IF NOT EXISTS idx_portfolio_view_events_distinct_time
ON portfolio_view_events(distinct_id, event_time);

-- Indexes for time_funnels
CREATE INDEX IF NOT EXISTS idx_time_funnels_distinct_id
ON time_funnels(distinct_id);

CREATE INDEX IF NOT EXISTS idx_time_funnels_funnel_type
ON time_funnels(funnel_type);

CREATE INDEX IF NOT EXISTS idx_time_funnels_distinct_funnel
ON time_funnels(distinct_id, funnel_type);

-- ============================================================================
-- Materialized View Indexes
-- ============================================================================

-- Indexes for main_analysis materialized view
CREATE INDEX IF NOT EXISTS idx_main_analysis_distinct_id ON main_analysis (distinct_id);
CREATE INDEX IF NOT EXISTS idx_main_analysis_did_copy ON main_analysis (did_copy);
CREATE INDEX IF NOT EXISTS idx_main_analysis_did_subscribe ON main_analysis (did_subscribe);
CREATE INDEX IF NOT EXISTS idx_main_analysis_total_copies ON main_analysis (total_copies);
CREATE INDEX IF NOT EXISTS idx_main_analysis_total_subscriptions ON main_analysis (total_subscriptions);
CREATE INDEX IF NOT EXISTS idx_main_analysis_time_to_first_copy ON main_analysis (time_to_first_copy_days) WHERE time_to_first_copy_days IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_main_analysis_time_to_linked_bank ON main_analysis (time_to_linked_bank_days) WHERE time_to_linked_bank_days IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_main_analysis_time_to_funded ON main_analysis (time_to_funded_account_days) WHERE time_to_funded_account_days IS NOT NULL;

-- Indexes for subscription_engagement_summary materialized view
CREATE INDEX IF NOT EXISTS idx_subscription_engagement_summary_did_subscribe
ON subscription_engagement_summary (did_subscribe);

-- Indexes for copy_engagement_summary materialized view
CREATE INDEX IF NOT EXISTS idx_copy_engagement_summary_did_copy
ON copy_engagement_summary (did_copy);

-- Indexes for portfolio_creator_engagement_metrics materialized view
CREATE INDEX IF NOT EXISTS idx_portfolio_creator_engagement_portfolio
ON portfolio_creator_engagement_metrics (portfolio_ticker);

CREATE INDEX IF NOT EXISTS idx_portfolio_creator_engagement_creator
ON portfolio_creator_engagement_metrics (creator_id);

CREATE INDEX IF NOT EXISTS idx_portfolio_creator_engagement_views
ON portfolio_creator_engagement_metrics (total_pdp_views DESC);

-- Indexes for hidden_gems_portfolios materialized view
CREATE INDEX IF NOT EXISTS idx_hidden_gems_portfolios_ticker
ON hidden_gems_portfolios (portfolio_ticker);

-- ============================================================================
-- Summary
-- ============================================================================

DO $$
DECLARE
  index_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO index_count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname LIKE 'idx_%';

  RAISE NOTICE 'Phase 3 indexes applied successfully!';
  RAISE NOTICE 'Total indexes in public schema: %', index_count;
END $$;
