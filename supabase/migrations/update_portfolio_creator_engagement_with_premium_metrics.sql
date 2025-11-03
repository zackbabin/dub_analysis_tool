-- Migration: Update portfolio_creator_engagement_metrics to join premium creator metrics
-- Date: 2025-11-03
-- Purpose: Modify materialized view to LEFT JOIN premium_creator_portfolio_metrics_latest
--          This populates the 4 new columns with data from chart 85810770

-- ============================================================================
-- STEP 1: Drop dependent views
-- ============================================================================
DROP MATERIALIZED VIEW IF EXISTS hidden_gems_portfolios CASCADE;

-- ============================================================================
-- STEP 2: Drop and recreate portfolio_creator_engagement_metrics with JOIN
-- ============================================================================
DROP MATERIALIZED VIEW IF EXISTS portfolio_creator_engagement_metrics CASCADE;

CREATE MATERIALIZED VIEW portfolio_creator_engagement_metrics AS
SELECT
  upce.portfolio_ticker,
  upce.creator_id,
  upce.creator_username,

  -- Existing metrics from user_portfolio_creator_engagement (columns 4-8)
  COUNT(DISTINCT upce.distinct_id) AS unique_viewers,
  SUM(upce.pdp_view_count) AS total_pdp_views,
  SUM(CASE WHEN upce.did_copy THEN upce.copy_count ELSE 0 END) AS total_copies,
  SUM(upce.liquidation_count) AS total_liquidations,

  -- NEW COLUMNS from premium_creator_portfolio_metrics_latest (columns 9-12)
  -- Use COALESCE to handle NULLs when no premium data exists
  COALESCE(pcpm.total_profile_views, 0) AS total_profile_views,
  COALESCE(pcpm.total_subscriptions, 0) AS total_subscriptions,
  COALESCE(pcpm.total_paywall_views, 0) AS total_paywall_views,
  COALESCE(pcpm.total_stripe_modal_views, 0) AS total_stripe_modal_views,

  -- Conversion rate calculation (column 13)
  ROUND(
    (SUM(CASE WHEN upce.did_copy THEN 1 ELSE 0 END)::NUMERIC / NULLIF(COUNT(DISTINCT upce.distinct_id), 0)) * 100,
    2
  ) AS conversion_rate_pct

FROM user_portfolio_creator_engagement upce

-- LEFT JOIN to premium creator metrics (will be NULL until sync populates data)
LEFT JOIN premium_creator_portfolio_metrics_latest pcpm
  ON upce.creator_id = pcpm.creator_id
  AND upce.portfolio_ticker = pcpm.portfolio_ticker

GROUP BY
  upce.portfolio_ticker,
  upce.creator_id,
  upce.creator_username,
  pcpm.total_profile_views,
  pcpm.total_subscriptions,
  pcpm.total_paywall_views,
  pcpm.total_stripe_modal_views;

-- ============================================================================
-- STEP 3: Recreate indexes
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_portfolio_creator_engagement_metrics_ticker
ON portfolio_creator_engagement_metrics (portfolio_ticker);

CREATE INDEX IF NOT EXISTS idx_portfolio_creator_engagement_metrics_creator
ON portfolio_creator_engagement_metrics (creator_id);

CREATE INDEX IF NOT EXISTS idx_portfolio_creator_engagement_profile_views
ON portfolio_creator_engagement_metrics (total_profile_views DESC);

CREATE INDEX IF NOT EXISTS idx_portfolio_creator_engagement_subscriptions
ON portfolio_creator_engagement_metrics (total_subscriptions DESC);

-- ============================================================================
-- STEP 4: Recreate hidden_gems_portfolios (dependent view)
-- ============================================================================
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
-- STEP 5: Verify migration
-- ============================================================================
-- Check column structure
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'portfolio_creator_engagement_metrics'
-- ORDER BY ordinal_position;

-- Check data (should show 0 for new columns until sync runs)
-- SELECT
--   creator_id,
--   creator_username,
--   portfolio_ticker,
--   total_pdp_views,
--   total_profile_views,
--   total_copies,
--   total_subscriptions
-- FROM portfolio_creator_engagement_metrics
-- WHERE creator_id IN (SELECT creator_id FROM premium_creators LIMIT 5)
-- LIMIT 10;

COMMENT ON MATERIALIZED VIEW portfolio_creator_engagement_metrics IS
'Aggregated portfolio-creator engagement metrics. Combines user_portfolio_creator_engagement data with premium_creator_portfolio_metrics (chart 85810770). Refresh after sync-creator-data completes.';
