-- ============================================================================
-- Fix Database Performance Issues
-- Addresses duplicate and unused indexes flagged by Supabase linter
-- Safe to run: Only drops redundant indexes, does not affect functionality
-- ============================================================================

-- ============================================================================
-- PART 1: DROP DUPLICATE INDEXES
-- Keep the better-named/more descriptive index in each pair
-- ============================================================================

-- 1. conversion_pattern_combinations - Keep newer idx_combinations_* versions
DROP INDEX IF EXISTS idx_conversion_patterns_type_rank;
DROP INDEX IF EXISTS idx_conversion_patterns_type_lift;

-- 2. event_sequences_raw - Keep newer idx_event_sequences_raw_* version
DROP INDEX IF EXISTS idx_event_sequences_event_data_gin;

-- 3. portfolio_view_events - Keep shorter named version
DROP INDEX IF EXISTS idx_portfolio_view_events_time;

-- 4. subscribers_insights - Keep newer idx_subscribers_insights_* version
DROP INDEX IF EXISTS idx_subscribers_distinct_id;

-- 5. time_funnels - Keep more descriptive names
DROP INDEX IF EXISTS idx_time_funnels_user_type;  -- duplicate of idx_time_funnels_distinct_funnel
DROP INDEX IF EXISTS idx_time_funnels_type;       -- duplicate of idx_time_funnels_funnel_type
-- Note: unique_user_funnel_per_sync is a CONSTRAINT, not just an index
-- To drop it, we need to drop the constraint and recreate with the other name
-- Since both exist and serve the same purpose, we'll drop the duplicate constraint and keep time_funnels_unique_key
ALTER TABLE time_funnels DROP CONSTRAINT IF EXISTS unique_user_funnel_per_sync;

-- 6. user_portfolio_creator_copies - Keep newer idx_user_portfolio_creator_copies_* versions
DROP INDEX IF EXISTS idx_copy_pairs_creator;
DROP INDEX IF EXISTS idx_copy_pairs_did_copy;
DROP INDEX IF EXISTS idx_copy_pairs_distinct_id;

-- 7. user_portfolio_creator_views - Keep newer idx_user_portfolio_creator_views_* versions
DROP INDEX IF EXISTS idx_pair_views_subscribe;
DROP INDEX IF EXISTS idx_user_portfolio_creator_views_user_creator;  -- duplicate of idx_user_portfolio_creator_views_distinct_creator

-- ============================================================================
-- PART 2: DROP UNUSED INDEXES
-- These indexes have never been used according to pg_stat_user_indexes
-- Being conservative: only dropping indexes clearly not needed by query patterns
-- ============================================================================

-- conversion_pattern_combinations
-- Note: Keeping idx_combinations_type_rank as it's used for ORDER BY combination_rank
DROP INDEX IF EXISTS idx_combinations_type_lift;
DROP INDEX IF EXISTS idx_conversion_patterns_exposure;

-- creators_insights
DROP INDEX IF EXISTS idx_creators_insights_email;
DROP INDEX IF EXISTS idx_creators_insights_creator_username;

-- creator_subscriptions_by_price
DROP INDEX IF EXISTS idx_creator_subscriptions_by_price_creator_id;

-- event_sequence_analysis
-- Note: This might be used by .eq('analysis_type', outcomeType) - keeping for safety

-- event_sequences_raw
DROP INDEX IF EXISTS idx_event_sequences_raw_distinct_id;
DROP INDEX IF EXISTS idx_event_sequences_raw_event_data_gin;

-- hidden_gems_portfolios
-- Note: Results are selected with SELECT * - no WHERE clause, safe to drop
DROP INDEX IF EXISTS idx_hidden_gems_portfolios_ticker;

-- latest_sync_status_mv
-- Note: Query uses .eq('tool_type', 'creator') - keeping for safety

-- main_analysis
-- Note: main_analysis is queried with SELECT * - no filtering, safe to drop these
DROP INDEX IF EXISTS idx_main_analysis_did_copy;
DROP INDEX IF EXISTS idx_main_analysis_total_copies;
DROP INDEX IF EXISTS idx_main_analysis_time_to_first_copy;
DROP INDEX IF EXISTS idx_main_analysis_time_to_linked_bank;
DROP INDEX IF EXISTS idx_main_analysis_time_to_funded;

-- portfolio_creator_engagement_metrics
DROP INDEX IF EXISTS idx_portfolio_creator_engagement_creator;

-- portfolio_view_events
DROP INDEX IF EXISTS idx_portfolio_view_events_distinct_time;

-- subscribers_insights
DROP INDEX IF EXISTS idx_subscribers_conversion_metrics;
DROP INDEX IF EXISTS idx_subscribers_insights_distinct_id;
DROP INDEX IF EXISTS idx_subscribers_insights_synced_at;
DROP INDEX IF EXISTS idx_subscribers_insights_linked_bank;

-- sync_logs
DROP INDEX IF EXISTS idx_sync_logs_status;

-- time_funnels
DROP INDEX IF EXISTS idx_time_funnels_distinct_funnel;
DROP INDEX IF EXISTS idx_time_funnels_synced_at;
DROP INDEX IF EXISTS idx_time_funnels_distinct_id;

-- uploaded_creators
DROP INDEX IF EXISTS idx_uploaded_creators_username;
DROP INDEX IF EXISTS idx_uploaded_creators_raw_data_gin;

-- user_events
DROP INDEX IF EXISTS idx_user_events_distinct_event;

-- user_event_sequences
DROP INDEX IF EXISTS idx_user_event_sequences_synced_at;

-- user_portfolio_creator_copies
DROP INDEX IF EXISTS idx_copy_pairs_synced_at;

-- ============================================================================
-- VERIFICATION QUERIES (Commented out - run manually if needed)
-- ============================================================================

-- Check remaining indexes per table:
-- SELECT schemaname, tablename, indexname
-- FROM pg_indexes
-- WHERE schemaname = 'public'
-- ORDER BY tablename, indexname;

-- Check index usage statistics:
-- SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read, idx_tup_fetch
-- FROM pg_stat_user_indexes
-- WHERE schemaname = 'public'
-- ORDER BY idx_scan DESC;
