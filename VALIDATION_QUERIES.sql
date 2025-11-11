-- ============================================================================
-- VALIDATION QUERIES FOR PREMIUM CREATOR VIEWS
-- Run these queries to verify database state and diagnose 404 errors
-- ============================================================================

-- ============================================================================
-- SECTION 1: Check if views exist
-- ============================================================================

-- Check all premium creator views
SELECT
    table_name,
    table_type,
    CASE
        WHEN table_type = 'BASE TABLE' THEN 'Table'
        WHEN table_type = 'VIEW' THEN 'Regular View'
        WHEN table_type = 'MATERIALIZED VIEW' THEN 'Materialized View'
    END as view_type
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN (
    'premium_creators',
    'user_portfolio_creator_engagement',
    'portfolio_creator_engagement_metrics',
    'premium_creator_breakdown',
    'premium_creator_summary_stats',
    'premium_creator_top_5_stocks',
    'premium_creator_affinity_display',
    'premium_creator_copy_affinity_base',
    'portfolio_breakdown_with_metrics'
)
ORDER BY table_name;

-- Expected results:
-- premium_creators → BASE TABLE
-- user_portfolio_creator_engagement → BASE TABLE
-- portfolio_creator_engagement_metrics → MATERIALIZED VIEW
-- premium_creator_breakdown → MATERIALIZED VIEW
-- premium_creator_summary_stats → VIEW
-- premium_creator_top_5_stocks → VIEW
-- premium_creator_affinity_display → VIEW
-- premium_creator_copy_affinity_base → VIEW
-- portfolio_breakdown_with_metrics → MATERIALIZED VIEW

-- ============================================================================
-- SECTION 2: Check row counts (verify data exists)
-- ============================================================================

-- Count rows in each view/table
SELECT 'premium_creators' as table_name, COUNT(*) as row_count
FROM premium_creators
UNION ALL
SELECT 'user_portfolio_creator_engagement', COUNT(*)
FROM user_portfolio_creator_engagement
UNION ALL
SELECT 'portfolio_creator_engagement_metrics', COUNT(*)
FROM portfolio_creator_engagement_metrics
UNION ALL
SELECT 'premium_creator_breakdown', COUNT(*)
FROM premium_creator_breakdown
UNION ALL
SELECT 'premium_creator_summary_stats', COUNT(*)
FROM premium_creator_summary_stats
UNION ALL
SELECT 'premium_creator_top_5_stocks', COUNT(*)
FROM premium_creator_top_5_stocks
UNION ALL
SELECT 'premium_creator_affinity_display', COUNT(*)
FROM premium_creator_affinity_display
UNION ALL
SELECT 'portfolio_breakdown_with_metrics', COUNT(*)
FROM portfolio_breakdown_with_metrics;

-- Expected results:
-- premium_creators → 20 rows (should match number of premium creators)
-- user_portfolio_creator_engagement → 1000+ rows (user-level granular data)
-- portfolio_creator_engagement_metrics → 100+ rows (portfolio-creator pairs)
-- premium_creator_breakdown → 20 rows (one per premium creator)
-- premium_creator_summary_stats → 1 row (summary stats)
-- premium_creator_top_5_stocks → 20 rows (one per premium creator)
-- premium_creator_affinity_display → 20 rows (one per premium creator)
-- portfolio_breakdown_with_metrics → 100+ rows (portfolio-creator pairs)

-- ============================================================================
-- SECTION 3: Check specific views causing 404 errors
-- ============================================================================

-- Test 1: premium_creator_summary_stats (used by metric cards)
SELECT * FROM premium_creator_summary_stats;
-- Should return 1 row with columns:
-- avg_copy_cvr, avg_subscription_cvr, median_all_time_performance, median_copy_capital, total_creators

-- Test 2: premium_creator_top_5_stocks (used by Portfolio Assets Breakdown)
SELECT * FROM premium_creator_top_5_stocks
ORDER BY total_copies DESC NULLS LAST
LIMIT 5;
-- Should return 5 rows with columns:
-- creator_username, top_5_stocks (JSON array), total_copies

-- ============================================================================
-- SECTION 4: Verify premium_creator_breakdown shows all creators
-- ============================================================================

-- Compare premium_creators vs premium_creator_breakdown
SELECT
    pc.creator_username,
    CASE
        WHEN pcb.creator_username IS NOT NULL THEN '✅ In breakdown'
        ELSE '❌ Missing from breakdown'
    END as status,
    COALESCE(pcb.total_copies, 0) as total_copies,
    COALESCE(pcb.total_liquidations, 0) as total_liquidations
FROM premium_creators pc
LEFT JOIN premium_creator_breakdown pcb ON pc.creator_username = pcb.creator_username
ORDER BY pc.creator_username;

-- Expected: All creators should show "✅ In breakdown"
-- If any show "❌ Missing", run: REFRESH MATERIALIZED VIEW premium_creator_breakdown;

-- ============================================================================
-- SECTION 5: Verify data flow (Total Copies & Total Liquidations)
-- ============================================================================

-- Check data at each aggregation level for one creator
WITH test_creator AS (
    SELECT creator_username, creator_id
    FROM premium_creators
    LIMIT 1
)
SELECT
    'user_portfolio_creator_engagement' as source,
    COUNT(*) as records,
    SUM(copy_count) as total_copies,
    SUM(liquidation_count) as total_liquidations
FROM user_portfolio_creator_engagement upce
WHERE upce.creator_id = (SELECT creator_id FROM test_creator)

UNION ALL

SELECT
    'portfolio_creator_engagement_metrics',
    COUNT(*),
    SUM(total_copies),
    SUM(total_liquidations)
FROM portfolio_creator_engagement_metrics pcem
WHERE pcem.creator_id = (SELECT creator_id FROM test_creator)

UNION ALL

SELECT
    'premium_creator_breakdown',
    COUNT(*),
    SUM(total_copies),
    SUM(total_liquidations)
FROM premium_creator_breakdown pcb
WHERE pcb.creator_username = (SELECT creator_username FROM test_creator);

-- Expected: Total copies and liquidations should match across all three levels

-- ============================================================================
-- SECTION 6: Check view dependencies
-- ============================================================================

-- Check which views depend on portfolio_creator_engagement_metrics
SELECT
    dependent_ns.nspname as dependent_schema,
    dependent_view.relname as dependent_view,
    source_table.relname as source_table
FROM pg_depend
JOIN pg_rewrite ON pg_depend.objid = pg_rewrite.oid
JOIN pg_class as dependent_view ON pg_rewrite.ev_class = dependent_view.oid
JOIN pg_class as source_table ON pg_depend.refobjid = source_table.oid
JOIN pg_namespace dependent_ns ON dependent_ns.oid = dependent_view.relnamespace
WHERE source_table.relname = 'portfolio_creator_engagement_metrics'
AND dependent_ns.nspname = 'public';

-- Expected: Should show premium_creator_breakdown, portfolio_breakdown_with_metrics, etc.

-- ============================================================================
-- SECTION 7: Check for view definition errors
-- ============================================================================

-- Get view definitions to check for syntax errors
SELECT
    table_name,
    view_definition
FROM information_schema.views
WHERE table_schema = 'public'
AND table_name IN (
    'premium_creator_summary_stats',
    'premium_creator_top_5_stocks',
    'premium_creator_affinity_display',
    'premium_creator_copy_affinity_base'
);

-- ============================================================================
-- SECTION 8: Check column structure
-- ============================================================================

-- Verify premium_creator_top_5_stocks has total_copies column
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
AND table_name = 'premium_creator_top_5_stocks'
ORDER BY ordinal_position;

-- Expected columns:
-- creator_username (text)
-- top_5_stocks (json array)
-- total_copies (bigint) ← Must have this for sorting in UI

-- Verify premium_creator_summary_stats has all required columns
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
AND table_name = 'premium_creator_summary_stats'
ORDER BY ordinal_position;

-- Expected columns:
-- avg_copy_cvr (numeric)
-- avg_subscription_cvr (numeric)
-- median_all_time_performance (numeric)
-- median_copy_capital (numeric)
-- total_creators (bigint)

-- ============================================================================
-- SECTION 9: Check materialized view freshness
-- ============================================================================

-- Check when materialized views were last refreshed
-- (Note: PostgreSQL doesn't track this by default, but we can check sync_logs)
SELECT
    source,
    status,
    started_at,
    completed_at,
    total_records_inserted
FROM sync_logs
WHERE source IN ('mixpanel_engagement', 'portfolio_performance')
ORDER BY started_at DESC
LIMIT 10;

-- Expected: Recent successful syncs for mixpanel_engagement

-- ============================================================================
-- SECTION 10: Quick fix commands (if views are missing)
-- ============================================================================

-- If premium_creator_breakdown exists but is empty, refresh it:
-- REFRESH MATERIALIZED VIEW premium_creator_breakdown;

-- If portfolio_creator_engagement_metrics exists but is empty, refresh it:
-- REFRESH MATERIALIZED VIEW portfolio_creator_engagement_metrics;

-- If portfolio_breakdown_with_metrics exists but is empty, refresh it:
-- REFRESH MATERIALIZED VIEW portfolio_breakdown_with_metrics;

-- Refresh all at once (run these in sequence):
-- REFRESH MATERIALIZED VIEW portfolio_creator_engagement_metrics;
-- REFRESH MATERIALIZED VIEW premium_creator_breakdown;
-- REFRESH MATERIALIZED VIEW portfolio_breakdown_with_metrics;

-- ============================================================================
-- SECTION 11: Diagnostic query for missing views
-- ============================================================================

-- If a view is completely missing, check if it was dropped
SELECT
    'premium_creator_summary_stats' as view_name,
    CASE
        WHEN EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public'
            AND table_name = 'premium_creator_summary_stats'
        ) THEN '✅ EXISTS'
        ELSE '❌ MISSING - Run restore_all_premium_creator_views.sql'
    END as status

UNION ALL

SELECT
    'premium_creator_top_5_stocks',
    CASE
        WHEN EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public'
            AND table_name = 'premium_creator_top_5_stocks'
        ) THEN '✅ EXISTS'
        ELSE '❌ MISSING - Run add_total_copies_to_premium_creator_top_5_stocks.sql'
    END

UNION ALL

SELECT
    'premium_creator_breakdown',
    CASE
        WHEN EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public'
            AND table_name = 'premium_creator_breakdown'
        ) THEN '✅ EXISTS'
        ELSE '❌ MISSING - Run fix_premium_creator_breakdown_group_by.sql'
    END;
