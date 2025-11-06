-- Verification Script: Performance Optimization Safety Check
-- Date: 2025-11-06
-- Purpose: Verify that performance optimizations don't impact data or functionality
-- Run this BEFORE and AFTER applying performance_optimization_immediate.sql

-- ============================================================================
-- STEP 1: Capture Baseline Metrics (Run BEFORE migration)
-- ============================================================================

-- Count records in key tables
SELECT 'user_portfolio_creator_engagement' as table_name, COUNT(*) as record_count
FROM user_portfolio_creator_engagement
UNION ALL
SELECT 'user_creator_engagement', COUNT(*)
FROM user_creator_engagement
UNION ALL
SELECT 'subscribers_insights', COUNT(*)
FROM subscribers_insights
UNION ALL
SELECT 'premium_creator_metrics', COUNT(*)
FROM premium_creator_metrics
ORDER BY table_name;

-- Count records in materialized views
SELECT 'portfolio_creator_engagement_metrics' as view_name, COUNT(*) as record_count
FROM portfolio_creator_engagement_metrics
UNION ALL
SELECT 'hidden_gems_portfolios', COUNT(*)
FROM hidden_gems_portfolios
ORDER BY view_name;

-- Sample data checksums (to verify no data changes)
SELECT
  'user_portfolio_creator_engagement' as table_name,
  COUNT(*) as total_rows,
  COUNT(DISTINCT distinct_id) as unique_users,
  COUNT(DISTINCT portfolio_ticker) as unique_portfolios,
  COUNT(DISTINCT creator_id) as unique_creators,
  SUM(pdp_view_count) as total_pdp_views,
  SUM(copy_count) as total_copies,
  COUNT(*) FILTER (WHERE did_copy = true) as rows_with_copies
FROM user_portfolio_creator_engagement;

SELECT
  'portfolio_creator_engagement_metrics' as view_name,
  COUNT(*) as total_rows,
  SUM(unique_viewers) as total_unique_viewers,
  SUM(unique_copiers) as total_unique_copiers,
  SUM(total_pdp_views) as sum_pdp_views,
  SUM(total_copies) as sum_copies
FROM portfolio_creator_engagement_metrics;

SELECT
  'hidden_gems_portfolios' as view_name,
  COUNT(*) as total_gems,
  AVG(unique_viewers) as avg_viewers,
  AVG(unique_copiers) as avg_copiers,
  AVG(conversion_rate_pct) as avg_conversion_rate
FROM hidden_gems_portfolios;

-- ============================================================================
-- STEP 2: Verify Index Creation (Run AFTER migration)
-- ============================================================================

-- Check that all new indexes were created
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'idx_upce_creator_portfolio',
    'idx_upce_did_copy_creator',
    'idx_upce_portfolio_pdp_views',
    'idx_upce_engagement_coverage',
    'idx_uce_creator_profile_views',
    'idx_uce_distinct_creator',
    'idx_subscribers_total_subscriptions',
    'idx_subscribers_premium_copies',
    'idx_subscribers_distinct_id',
    'idx_pcm_creator_id',
    'idx_pcm_creator_synced',
    'idx_portfolio_creator_engagement_metrics_pk',
    'idx_hidden_gems_portfolios_pk'
  )
ORDER BY tablename, indexname;

-- Verify unique indexes exist (required for CONCURRENTLY)
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('portfolio_creator_engagement_metrics', 'hidden_gems_portfolios')
  AND indexdef LIKE '%UNIQUE%'
ORDER BY tablename;

-- ============================================================================
-- STEP 3: Verify Data Integrity (Run AFTER migration)
-- ============================================================================

-- Re-run baseline queries and compare counts (should be IDENTICAL)
SELECT 'user_portfolio_creator_engagement' as table_name, COUNT(*) as record_count
FROM user_portfolio_creator_engagement
UNION ALL
SELECT 'user_creator_engagement', COUNT(*)
FROM user_creator_engagement
UNION ALL
SELECT 'subscribers_insights', COUNT(*)
FROM subscribers_insights
UNION ALL
SELECT 'premium_creator_metrics', COUNT(*)
FROM premium_creator_metrics
ORDER BY table_name;

-- Verify materialized view data unchanged
SELECT 'portfolio_creator_engagement_metrics' as view_name, COUNT(*) as record_count
FROM portfolio_creator_engagement_metrics
UNION ALL
SELECT 'hidden_gems_portfolios', COUNT(*)
FROM hidden_gems_portfolios
ORDER BY view_name;

-- Verify checksums match baseline (should be IDENTICAL)
SELECT
  'user_portfolio_creator_engagement' as table_name,
  COUNT(*) as total_rows,
  COUNT(DISTINCT distinct_id) as unique_users,
  COUNT(DISTINCT portfolio_ticker) as unique_portfolios,
  COUNT(DISTINCT creator_id) as unique_creators,
  SUM(pdp_view_count) as total_pdp_views,
  SUM(copy_count) as total_copies,
  COUNT(*) FILTER (WHERE did_copy = true) as rows_with_copies
FROM user_portfolio_creator_engagement;

SELECT
  'portfolio_creator_engagement_metrics' as view_name,
  COUNT(*) as total_rows,
  SUM(unique_viewers) as total_unique_viewers,
  SUM(unique_copiers) as total_unique_copiers,
  SUM(total_pdp_views) as sum_pdp_views,
  SUM(total_copies) as sum_copies
FROM portfolio_creator_engagement_metrics;

SELECT
  'hidden_gems_portfolios' as view_name,
  COUNT(*) as total_gems,
  AVG(unique_viewers) as avg_viewers,
  AVG(unique_copiers) as avg_copiers,
  AVG(conversion_rate_pct) as avg_conversion_rate
FROM hidden_gems_portfolios;

-- ============================================================================
-- STEP 4: Verify Function Updates (Run AFTER migration)
-- ============================================================================

-- Check that refresh functions were updated
SELECT
  proname as function_name,
  prosrc as function_body
FROM pg_proc
WHERE proname IN (
  'refresh_portfolio_engagement_views',
  'refresh_subscription_engagement_summary',
  'refresh_copy_engagement_summary',
  'refresh_hidden_gems'
)
ORDER BY proname;

-- Verify CONCURRENTLY is in function definitions
SELECT
  proname as function_name,
  CASE
    WHEN prosrc LIKE '%CONCURRENTLY%' THEN 'YES - Non-blocking'
    ELSE 'NO - Blocking'
  END as uses_concurrently
FROM pg_proc
WHERE proname IN (
  'refresh_portfolio_engagement_views',
  'refresh_hidden_gems'
)
ORDER BY proname;

-- ============================================================================
-- STEP 5: Test Refresh Functions (Run AFTER migration)
-- ============================================================================

-- Test non-blocking refresh (should complete without errors)
SELECT refresh_portfolio_engagement_views();

-- Verify views still work after refresh
SELECT COUNT(*) as count_after_refresh
FROM portfolio_creator_engagement_metrics;

SELECT COUNT(*) as count_after_refresh
FROM hidden_gems_portfolios;

-- ============================================================================
-- STEP 6: Performance Validation (Run AFTER migration)
-- ============================================================================

-- Check index usage (idx_scan should increase over time)
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan as times_used,
  idx_tup_read as tuples_read,
  idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
  AND tablename IN (
    'user_portfolio_creator_engagement',
    'user_creator_engagement',
    'subscribers_insights',
    'premium_creator_metrics'
  )
ORDER BY tablename, indexname;

-- Check table statistics were collected
SELECT
  schemaname,
  tablename,
  last_analyze,
  last_autoanalyze,
  n_tup_ins as inserts,
  n_tup_upd as updates,
  n_tup_del as deletes
FROM pg_stat_user_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'user_portfolio_creator_engagement',
    'user_creator_engagement',
    'subscribers_insights',
    'premium_creator_metrics'
  )
ORDER BY tablename;

-- ============================================================================
-- EXPECTED RESULTS
-- ============================================================================
-- BEFORE vs AFTER Migration:
-- ✓ All record counts should be IDENTICAL
-- ✓ All checksums should be IDENTICAL
-- ✓ All data aggregations should be IDENTICAL
-- ✓ 13 new indexes should exist
-- ✓ 2 unique indexes should exist (for CONCURRENTLY)
-- ✓ Refresh functions should contain "CONCURRENTLY"
-- ✓ Refresh functions should execute without errors
-- ✓ Views should return same data after refresh

-- SUCCESS CRITERIA:
-- If all counts match and views refresh without errors, optimization is SAFE
