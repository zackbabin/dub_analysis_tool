-- Migration: Add Premium Creator Metrics to portfolio_creator_engagement_metrics
-- Date: 2025-11-03
-- Purpose: Extend portfolio_creator_engagement_metrics to support Mixpanel chart 85810770
--          Adds 4 new columns: total_profile_views, total_subscriptions, total_paywall_views, total_stripe_modal_views
-- Impact: Zero impact on existing functionality (adds nullable columns)

-- ============================================================================
-- STEP 1: Verify current structure before migration
-- ============================================================================
-- Run this query first to confirm current columns:
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'portfolio_creator_engagement_metrics'
-- ORDER BY ordinal_position;

-- Expected columns before migration (VERIFIED 2025-11-03):
-- 1. portfolio_ticker (text)
-- 2. creator_id (text)
-- 3. creator_username (text)
-- 4. unique_viewers (bigint)
-- 5. total_pdp_views (bigint)
-- 6. total_copies (bigint)
-- 7. total_liquidations (bigint)
-- 8. conversion_rate_pct (numeric)

-- Expected columns AFTER migration:
-- 1-8: Same as above
-- 9. total_profile_views (integer) - NEW
-- 10. total_subscriptions (integer) - NEW
-- 11. total_paywall_views (integer) - NEW
-- 12. total_stripe_modal_views (integer) - NEW
-- 13. conversion_rate_pct (numeric) - MOVED to end

-- ============================================================================
-- STEP 2: Add new columns (safe operation - no data loss)
-- ============================================================================
-- Since portfolio_creator_engagement_metrics is a MATERIALIZED VIEW (not a table),
-- we need to:
-- 1. Drop dependent views
-- 2. Drop the materialized view
-- 3. Recreate with new columns
-- 4. Recreate dependent views
-- 5. Refresh materialized views

-- Drop dependent views first
DROP MATERIALIZED VIEW IF EXISTS hidden_gems_portfolios CASCADE;

-- Drop the main materialized view
DROP MATERIALIZED VIEW IF EXISTS portfolio_creator_engagement_metrics CASCADE;

-- Recreate portfolio_creator_engagement_metrics with NEW columns
-- IMPORTANT: This matches EXACT production structure verified on 2025-11-03
CREATE MATERIALIZED VIEW portfolio_creator_engagement_metrics AS
SELECT
  portfolio_ticker,
  creator_id,
  creator_username,

  -- Existing metrics (from user_portfolio_creator_engagement table)
  -- These match the current production columns 1-8
  COUNT(DISTINCT distinct_id) AS unique_viewers,
  SUM(pdp_view_count) AS total_pdp_views,
  SUM(CASE WHEN did_copy THEN copy_count ELSE 0 END) AS total_copies,
  SUM(liquidation_count) AS total_liquidations,

  -- NEW COLUMNS 9-12 (will be NULL until populated by sync process from chart 85810770)
  NULL::INTEGER as total_profile_views,
  NULL::INTEGER as total_subscriptions,
  NULL::INTEGER as total_paywall_views,
  NULL::INTEGER as total_stripe_modal_views,

  -- Conversion rate calculation (column 13)
  ROUND(
    (SUM(CASE WHEN did_copy THEN 1 ELSE 0 END)::NUMERIC / NULLIF(COUNT(DISTINCT distinct_id), 0)) * 100,
    2
  ) AS conversion_rate_pct

FROM user_portfolio_creator_engagement
GROUP BY portfolio_ticker, creator_id, creator_username;

-- Recreate indexes (matching current production - verified 2025-11-03)
-- Note: Production uses different naming than schema files
CREATE INDEX IF NOT EXISTS idx_portfolio_creator_engagement_metrics_ticker
ON portfolio_creator_engagement_metrics (portfolio_ticker);

CREATE INDEX IF NOT EXISTS idx_portfolio_creator_engagement_metrics_creator
ON portfolio_creator_engagement_metrics (creator_id);

-- Add new indexes for new columns
CREATE INDEX IF NOT EXISTS idx_portfolio_creator_engagement_profile_views
ON portfolio_creator_engagement_metrics (total_profile_views DESC);

CREATE INDEX IF NOT EXISTS idx_portfolio_creator_engagement_subscriptions
ON portfolio_creator_engagement_metrics (total_subscriptions DESC);

-- Recreate hidden_gems_portfolios (dependent view)
-- This matches EXACT production definition verified on 2025-11-03
CREATE MATERIALIZED VIEW hidden_gems_portfolios AS
SELECT
  portfolio_ticker,
  creator_id,
  creator_username,
  unique_viewers as unique_views,
  total_pdp_views,
  total_copies,
  ROUND(
    (total_pdp_views::NUMERIC / NULLIF(total_copies, 0)),
    2
  ) as pdp_views_to_copies_ratio,
  ROUND(
    (total_copies::NUMERIC / NULLIF(unique_viewers, 0)) * 100,
    2
  ) as conversion_rate_pct
FROM portfolio_creator_engagement_metrics pce
WHERE
  total_pdp_views >= 10
  AND (total_pdp_views::NUMERIC / NULLIF(total_copies, 0)) >= 5
  AND total_copies <= 100
ORDER BY total_pdp_views DESC;

CREATE INDEX IF NOT EXISTS idx_hidden_gems_portfolios_ticker
ON hidden_gems_portfolios (portfolio_ticker);

-- ============================================================================
-- STEP 3: Verify migration success
-- ============================================================================
-- Run this query after migration to verify new columns exist:
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'portfolio_creator_engagement_metrics'
-- ORDER BY ordinal_position;

-- Expected output should show 12 columns including:
-- - total_profile_views (integer)
-- - total_subscriptions (integer)
-- - total_paywall_views (integer)
-- - total_stripe_modal_views (integer)

-- ============================================================================
-- STEP 4: Test query for Premium Creator Analysis (4-card summary)
-- ============================================================================
-- This query will return the 4 metrics needed for the Premium Creator Analysis tab
-- Once the sync process populates the new columns with data from chart 85810770

-- Test query (will return NULLs until sync populates data):
SELECT
  SUM(pcem.total_pdp_views) as total_pdp_views,
  SUM(pcem.total_profile_views) as total_profile_views,
  SUM(pcem.total_copies) as total_copies,
  SUM(pcem.total_subscriptions) as total_subscriptions,
  SUM(pcem.total_paywall_views) as total_paywall_views,
  SUM(pcem.total_stripe_modal_views) as total_stripe_modal_views,
  COUNT(DISTINCT pcem.creator_id) as total_premium_creators
FROM portfolio_creator_engagement_metrics pcem
INNER JOIN premium_creators pc
  ON pcem.creator_id = pc.creator_id;

-- ============================================================================
-- ROLLBACK PLAN (if needed)
-- ============================================================================
-- To rollback this migration, simply re-run the original hidden_gems_view.sql
-- which recreates the views without the new columns
