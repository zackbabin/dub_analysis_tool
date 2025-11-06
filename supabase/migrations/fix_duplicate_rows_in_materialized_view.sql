-- Fix: Remove duplicate rows before creating unique index
-- Date: 2025-11-06
-- Issue: Materialized view has duplicate (portfolio_ticker, creator_id) combinations
-- Solution: Identify duplicates, understand root cause, rebuild view cleanly

-- ============================================================================
-- STEP 1: Diagnose the duplicate issue
-- ============================================================================

-- Find all duplicates in portfolio_creator_engagement_metrics
SELECT
  portfolio_ticker,
  creator_id,
  COUNT(*) as duplicate_count,
  ARRAY_AGG(creator_username) as usernames,
  ARRAY_AGG(unique_viewers) as viewer_counts,
  ARRAY_AGG(total_copies) as copy_counts
FROM portfolio_creator_engagement_metrics
GROUP BY portfolio_ticker, creator_id
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC;

-- Check if duplicates also exist in source table
SELECT
  portfolio_ticker,
  creator_id,
  COUNT(*) as row_count,
  COUNT(DISTINCT creator_username) as distinct_usernames
FROM user_portfolio_creator_engagement
WHERE (portfolio_ticker, creator_id) IN (
  SELECT portfolio_ticker, creator_id
  FROM portfolio_creator_engagement_metrics
  GROUP BY portfolio_ticker, creator_id
  HAVING COUNT(*) > 1
)
GROUP BY portfolio_ticker, creator_id;

-- ============================================================================
-- STEP 2: Drop and rebuild materialized view to eliminate duplicates
-- ============================================================================

-- Drop existing materialized view (this is safe - we'll recreate it immediately)
DROP MATERIALIZED VIEW IF EXISTS portfolio_creator_engagement_metrics CASCADE;

-- Recreate with GROUP BY to ensure no duplicates
-- This query is from comprehensive_fix_simple_architecture.sql
CREATE MATERIALIZED VIEW portfolio_creator_engagement_metrics AS
SELECT
  upce.portfolio_ticker,
  upce.creator_id,
  -- Use MAX to pick one username if there are variations (shouldn't happen but defensive)
  MAX(upce.creator_username) as creator_username,

  -- User-level counts
  COUNT(DISTINCT CASE WHEN upce.pdp_view_count > 0 THEN upce.distinct_id END) AS unique_viewers,
  COUNT(DISTINCT CASE WHEN upce.did_copy THEN upce.distinct_id END) AS unique_copiers,

  -- Totals from user-level data
  SUM(upce.pdp_view_count) AS total_pdp_views,
  SUM(CASE WHEN upce.did_copy THEN upce.copy_count ELSE 0 END) AS total_copies,
  SUM(upce.liquidation_count) AS total_liquidations,

  -- Profile views: aggregate from user_creator_engagement (creator-level)
  COALESCE(MAX(uce_agg.total_profile_views), 0) AS total_profile_views,

  -- Subscription metrics from premium_creator_metrics (creator-level only)
  COALESCE(MAX(pcm.total_subscriptions), 0) AS total_subscriptions,
  COALESCE(MAX(pcm.total_paywall_views), 0) AS total_paywall_views,
  COALESCE(MAX(pcm.total_stripe_modal_views), 0) AS total_stripe_modal_views,
  COALESCE(MAX(pcm.total_cancellations), 0) AS total_cancellations,

  -- Conversion rate
  ROUND(
    (COUNT(DISTINCT CASE WHEN upce.did_copy THEN upce.distinct_id END)::NUMERIC /
     NULLIF(COUNT(DISTINCT CASE WHEN upce.pdp_view_count > 0 THEN upce.distinct_id END), 0)) * 100,
    2
  ) AS conversion_rate_pct

FROM user_portfolio_creator_engagement upce

-- Get profile views per creator (aggregate across all users)
LEFT JOIN (
  SELECT
    creator_id,
    SUM(profile_view_count) as total_profile_views
  FROM user_creator_engagement
  GROUP BY creator_id
) uce_agg ON upce.creator_id = uce_agg.creator_id

-- Get creator-level subscription metrics
LEFT JOIN (
  SELECT
    creator_id,
    SUM(total_subscriptions) as total_subscriptions,
    SUM(total_paywall_views) as total_paywall_views,
    SUM(total_stripe_modal_views) as total_stripe_modal_views,
    SUM(total_cancellations) as total_cancellations
  FROM premium_creator_metrics
  GROUP BY creator_id
) pcm ON upce.creator_id = pcm.creator_id

GROUP BY
  upce.portfolio_ticker,
  upce.creator_id;

-- Add performance indexes
CREATE INDEX IF NOT EXISTS idx_portfolio_creator_engagement_metrics_ticker
ON portfolio_creator_engagement_metrics (portfolio_ticker);

CREATE INDEX IF NOT EXISTS idx_portfolio_creator_engagement_metrics_creator
ON portfolio_creator_engagement_metrics (creator_id);

-- ============================================================================
-- STEP 3: Verify no duplicates exist
-- ============================================================================

-- This should return 0 rows
SELECT
  portfolio_ticker,
  creator_id,
  COUNT(*) as duplicate_count
FROM portfolio_creator_engagement_metrics
GROUP BY portfolio_ticker, creator_id
HAVING COUNT(*) > 1;

-- ============================================================================
-- STEP 4: Now create unique index (should succeed)
-- ============================================================================

CREATE UNIQUE INDEX idx_portfolio_creator_engagement_metrics_pk
ON portfolio_creator_engagement_metrics(portfolio_ticker, creator_id);

-- ============================================================================
-- STEP 5: Rebuild hidden_gems_portfolios (depends on portfolio_creator_engagement_metrics)
-- ============================================================================

DROP MATERIALIZED VIEW IF EXISTS hidden_gems_portfolios;

CREATE MATERIALIZED VIEW hidden_gems_portfolios AS
SELECT
  portfolio_ticker,
  creator_id,
  creator_username,
  unique_viewers,
  total_pdp_views,
  unique_copiers,
  total_copies,
  ROUND(
    (unique_viewers::NUMERIC / NULLIF(unique_copiers, 0)),
    2
  ) as viewers_to_copiers_ratio,
  conversion_rate_pct
FROM portfolio_creator_engagement_metrics
WHERE
  unique_viewers >= 10
  AND unique_copiers > 0
  AND (unique_viewers::NUMERIC / NULLIF(unique_copiers, 0)) >= 5
  AND unique_copiers <= 100
ORDER BY unique_viewers DESC;

-- Create unique index on hidden_gems_portfolios
CREATE UNIQUE INDEX idx_hidden_gems_portfolios_pk
ON hidden_gems_portfolios(portfolio_ticker, creator_id);

-- ============================================================================
-- STEP 6: Update refresh functions (now safe to use CONCURRENTLY)
-- ============================================================================

CREATE OR REPLACE FUNCTION refresh_portfolio_engagement_views()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Now CONCURRENTLY will work because unique indexes exist and no duplicates
  REFRESH MATERIALIZED VIEW CONCURRENTLY portfolio_creator_engagement_metrics;
  REFRESH MATERIALIZED VIEW CONCURRENTLY hidden_gems_portfolios;

  RETURN 'Successfully refreshed portfolio engagement views (non-blocking)';
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error refreshing views: %', SQLERRM;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_hidden_gems()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY portfolio_creator_engagement_metrics;
  REFRESH MATERIALIZED VIEW CONCURRENTLY hidden_gems_portfolios;
END;
$$;

-- ============================================================================
-- STEP 7: Test the complete fix
-- ============================================================================

-- Verify no duplicates
SELECT 'Duplicate check' as test, COUNT(*) as should_be_zero
FROM (
  SELECT portfolio_ticker, creator_id, COUNT(*) as cnt
  FROM portfolio_creator_engagement_metrics
  GROUP BY portfolio_ticker, creator_id
  HAVING COUNT(*) > 1
) duplicates;

-- Verify unique indexes exist
SELECT 'Unique indexes' as test, COUNT(*) as should_be_2
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('portfolio_creator_engagement_metrics', 'hidden_gems_portfolios')
  AND indexdef LIKE '%UNIQUE%';

-- Test refresh function
SELECT refresh_portfolio_engagement_views() as refresh_test;

-- Verify data counts
SELECT
  'portfolio_creator_engagement_metrics' as view_name,
  COUNT(*) as total_rows,
  COUNT(DISTINCT portfolio_ticker) as unique_portfolios,
  COUNT(DISTINCT creator_id) as unique_creators
FROM portfolio_creator_engagement_metrics
UNION ALL
SELECT
  'hidden_gems_portfolios',
  COUNT(*),
  COUNT(DISTINCT portfolio_ticker),
  COUNT(DISTINCT creator_id)
FROM hidden_gems_portfolios;

-- ============================================================================
-- ROOT CAUSE ANALYSIS
-- ============================================================================
-- The duplicates likely occurred because:
-- 1. premium_creator_metrics wasn't grouped by creator_id in the LEFT JOIN
-- 2. If a creator has multiple rows in premium_creator_metrics with different synced_at,
--    the LEFT JOIN would create multiple rows per (portfolio_ticker, creator_id)
--
-- Fix: Changed LEFT JOIN to use aggregated subquery with GROUP BY creator_id
-- This ensures one row per creator_id before joining
