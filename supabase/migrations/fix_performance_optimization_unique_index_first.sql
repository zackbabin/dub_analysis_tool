-- Fix: Add unique indexes BEFORE attempting CONCURRENTLY refresh
-- Date: 2025-11-06
-- Issue: CONCURRENTLY requires unique index to exist first
-- Solution: Create unique indexes, then update functions

-- ============================================================================
-- STEP 1: Create unique indexes on materialized views FIRST
-- ============================================================================

-- Drop and recreate if index exists but isn't unique
DROP INDEX IF EXISTS idx_portfolio_creator_engagement_metrics_pk;
DROP INDEX IF EXISTS idx_hidden_gems_portfolios_pk;

-- Create unique index on portfolio_creator_engagement_metrics
-- This is safe because (portfolio_ticker, creator_id) is the natural primary key
CREATE UNIQUE INDEX idx_portfolio_creator_engagement_metrics_pk
ON portfolio_creator_engagement_metrics(portfolio_ticker, creator_id);

-- Create unique index on hidden_gems_portfolios
-- This is safe because it's derived from portfolio_creator_engagement_metrics
CREATE UNIQUE INDEX idx_hidden_gems_portfolios_pk
ON hidden_gems_portfolios(portfolio_ticker, creator_id);

-- ============================================================================
-- STEP 2: Now update refresh functions to use CONCURRENTLY (safely)
-- ============================================================================

CREATE OR REPLACE FUNCTION refresh_portfolio_engagement_views()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Now CONCURRENTLY will work because unique indexes exist
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
-- STEP 3: Update other refresh functions (conditional CONCURRENTLY)
-- ============================================================================

CREATE OR REPLACE FUNCTION refresh_subscription_engagement_summary()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Check if subscription_engagement_summary has unique index
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
    AND tablename = 'subscription_engagement_summary'
    AND indexdef LIKE '%UNIQUE%'
  ) THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY subscription_engagement_summary;
  ELSE
    -- Fall back to blocking refresh if no unique index
    REFRESH MATERIALIZED VIEW subscription_engagement_summary;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_copy_engagement_summary()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Check if copy_engagement_summary has unique index
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
    AND tablename = 'copy_engagement_summary'
    AND indexdef LIKE '%UNIQUE%'
  ) THEN
    REFRESH MATERIALIZED VIEW CONCURRENTLY copy_engagement_summary;
  ELSE
    -- Fall back to blocking refresh if no unique index
    REFRESH MATERIALIZED VIEW copy_engagement_summary;
  END IF;
END;
$$;

-- ============================================================================
-- STEP 4: Test the fix
-- ============================================================================

-- Test that refresh now works without errors
SELECT refresh_portfolio_engagement_views();

-- Verify views still return correct data
SELECT COUNT(*) as portfolio_metrics_count
FROM portfolio_creator_engagement_metrics;

SELECT COUNT(*) as hidden_gems_count
FROM hidden_gems_portfolios;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
-- Run this to confirm unique indexes exist:
-- SELECT tablename, indexname, indexdef
-- FROM pg_indexes
-- WHERE schemaname = 'public'
--   AND tablename IN ('portfolio_creator_engagement_metrics', 'hidden_gems_portfolios')
--   AND indexdef LIKE '%UNIQUE%';

-- Expected output: 2 unique indexes
