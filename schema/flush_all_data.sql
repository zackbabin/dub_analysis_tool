-- ============================================================================
-- FLUSH ALL DATA - Removes all data while preserving table/view structures
-- ============================================================================
-- WARNING: This will delete ALL data from ALL tables and views!
-- Run this only when you want to start completely fresh.
-- ============================================================================

-- Step 1: Truncate all base tables (removes all rows, keeps structure)
TRUNCATE TABLE conversion_pattern_combinations RESTART IDENTITY CASCADE;
TRUNCATE TABLE creator_subscriptions_by_price RESTART IDENTITY CASCADE;
TRUNCATE TABLE creators_insights RESTART IDENTITY CASCADE;
TRUNCATE TABLE portfolio_view_events RESTART IDENTITY CASCADE;
TRUNCATE TABLE subscribers_insights RESTART IDENTITY CASCADE;
TRUNCATE TABLE sync_logs RESTART IDENTITY CASCADE;
TRUNCATE TABLE time_funnels RESTART IDENTITY CASCADE;
TRUNCATE TABLE user_portfolio_creator_copies RESTART IDENTITY CASCADE;
TRUNCATE TABLE user_portfolio_creator_views RESTART IDENTITY CASCADE;

-- Step 2: Refresh all materialized views (will be empty since base tables are empty)
REFRESH MATERIALIZED VIEW copy_engagement_summary;
REFRESH MATERIALIZED VIEW hidden_gems_portfolios;
REFRESH MATERIALIZED VIEW main_analysis;
REFRESH MATERIALIZED VIEW portfolio_creator_engagement_metrics;
REFRESH MATERIALIZED VIEW subscription_engagement_summary;

-- Step 3: Verify all tables and views are now empty
SELECT
    'VERIFICATION RESULTS' as status,
    '===================' as separator;

SELECT 'BASE TABLES' as category;
SELECT 'conversion_pattern_combinations' as table_name, COUNT(*) as row_count FROM conversion_pattern_combinations
UNION ALL
SELECT 'creator_subscriptions_by_price', COUNT(*) FROM creator_subscriptions_by_price
UNION ALL
SELECT 'creators_insights', COUNT(*) FROM creators_insights
UNION ALL
SELECT 'portfolio_view_events', COUNT(*) FROM portfolio_view_events
UNION ALL
SELECT 'subscribers_insights', COUNT(*) FROM subscribers_insights
UNION ALL
SELECT 'sync_logs', COUNT(*) FROM sync_logs
UNION ALL
SELECT 'time_funnels', COUNT(*) FROM time_funnels
UNION ALL
SELECT 'user_portfolio_creator_copies', COUNT(*) FROM user_portfolio_creator_copies
UNION ALL
SELECT 'user_portfolio_creator_views', COUNT(*) FROM user_portfolio_creator_views;

SELECT '' as separator;
SELECT 'MATERIALIZED VIEWS' as category;
SELECT 'copy_engagement_summary' as view_name, COUNT(*) as row_count FROM copy_engagement_summary
UNION ALL
SELECT 'hidden_gems_portfolios', COUNT(*) FROM hidden_gems_portfolios
UNION ALL
SELECT 'main_analysis', COUNT(*) FROM main_analysis
UNION ALL
SELECT 'portfolio_creator_engagement_metrics', COUNT(*) FROM portfolio_creator_engagement_metrics
UNION ALL
SELECT 'subscription_engagement_summary', COUNT(*) FROM subscription_engagement_summary;

-- Success message
SELECT '✅ ALL DATA FLUSHED SUCCESSFULLY' as result;
SELECT 'All tables and views are now empty and ready for fresh data.' as message;
