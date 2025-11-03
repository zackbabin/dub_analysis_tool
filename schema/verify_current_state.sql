-- Pre-Migration Verification Queries
-- Run these queries BEFORE running add_premium_creator_metrics.sql
-- This ensures we know exactly what exists in production

-- ============================================================================
-- QUERY 1: Check if portfolio_creator_engagement_metrics exists and its type
-- ============================================================================
SELECT
  schemaname,
  matviewname as view_name,
  'MATERIALIZED VIEW' as object_type,
  ispopulated,
  definition
FROM pg_matviews
WHERE matviewname = 'portfolio_creator_engagement_metrics'

UNION ALL

SELECT
  schemaname,
  viewname as view_name,
  'VIEW' as object_type,
  NULL as ispopulated,
  definition
FROM pg_views
WHERE viewname = 'portfolio_creator_engagement_metrics';

-- ============================================================================
-- QUERY 2: Get current columns in portfolio_creator_engagement_metrics
-- ============================================================================
SELECT
  ordinal_position,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'portfolio_creator_engagement_metrics'
ORDER BY ordinal_position;

-- ============================================================================
-- QUERY 3: Check what views/tables depend on portfolio_creator_engagement_metrics
-- ============================================================================
SELECT DISTINCT
  dependent_ns.nspname as dependent_schema,
  dependent_view.relname as dependent_view,
  dependent_view.relkind as object_type
FROM pg_depend
JOIN pg_rewrite ON pg_depend.objid = pg_rewrite.oid
JOIN pg_class as dependent_view ON pg_rewrite.ev_class = dependent_view.oid
JOIN pg_class as source_table ON pg_depend.refobjid = source_table.oid
JOIN pg_namespace dependent_ns ON dependent_ns.oid = dependent_view.relnamespace
WHERE source_table.relname = 'portfolio_creator_engagement_metrics'
  AND dependent_view.relname != 'portfolio_creator_engagement_metrics';

-- ============================================================================
-- QUERY 4: Get current indexes on portfolio_creator_engagement_metrics
-- ============================================================================
SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'portfolio_creator_engagement_metrics'
ORDER BY indexname;

-- ============================================================================
-- QUERY 5: Check if user_portfolio_creator_copies view exists (data source)
-- ============================================================================
SELECT
  viewname,
  definition
FROM pg_views
WHERE viewname = 'user_portfolio_creator_copies';

-- ============================================================================
-- QUERY 6: Check user_portfolio_creator_engagement table structure (underlying data)
-- ============================================================================
SELECT
  ordinal_position,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'user_portfolio_creator_engagement'
ORDER BY ordinal_position;

-- ============================================================================
-- QUERY 7: Sample data to verify creator_id and portfolio_ticker mapping
-- ============================================================================
SELECT
  creator_id,
  creator_username,
  portfolio_ticker,
  COUNT(*) as row_count
FROM user_portfolio_creator_engagement
GROUP BY creator_id, creator_username, portfolio_ticker
ORDER BY row_count DESC
LIMIT 5;

-- ============================================================================
-- QUERY 8: Check if hidden_gems_portfolios exists
-- ============================================================================
SELECT
  matviewname,
  ispopulated,
  definition
FROM pg_matviews
WHERE matviewname = 'hidden_gems_portfolios';

-- ============================================================================
-- EXPECTED RESULTS CHECKLIST
-- ============================================================================
-- After running these queries, verify:
--
-- ✓ Query 1: Should return 1 row showing it's a MATERIALIZED VIEW
-- ✓ Query 2: Should show columns matching hidden_gems_view.sql definition:
--   - portfolio_ticker (text)
--   - creator_id (text)
--   - creator_username (text)
--   - unique_viewers (bigint)
--   - total_pdp_views (bigint)
--   - total_copies (bigint)
--   - conversion_rate_pct (numeric)
--   PLUS check if total_liquidations exists (from CSV schema)
--
-- ✓ Query 3: Should show dependent objects like:
--   - hidden_gems_portfolios
--
-- ✓ Query 4: Should show 3 indexes:
--   - idx_portfolio_creator_engagement_portfolio
--   - idx_portfolio_creator_engagement_creator
--   - idx_portfolio_creator_engagement_views
--
-- ✓ Query 5: Should return the view definition
-- ✓ Query 6: Should show the underlying table structure
-- ✓ Query 7: Should return sample data with valid creator/portfolio mappings
-- ✓ Query 8: Should show hidden_gems_portfolios materialized view
--
-- If any of these don't match expectations, DO NOT proceed with migration
-- until we understand the current state!
