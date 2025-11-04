-- Migration: Remove unused columns from premium_creator_portfolio_metrics
-- Date: 2025-11-04
-- Purpose: Remove total_profile_views and total_copies columns that are not being used
--          These columns are always 0 because:
--          1. Mixpanel chart 85810770 doesn't return these metrics
--          2. All calculations use aggregated user-level data instead
--          3. portfolio_creator_engagement_metrics aggregates from user_portfolio_creator_engagement
--
-- Verified unused:
--   - Copy CVR: Uses SUM(copy_count) from user_portfolio_creator_engagement
--   - Liquidation Rate: Uses SUM(copy_count) from user_portfolio_creator_engagement
--   - Affinity Analysis: Uses COUNT(*) from user_portfolio_creator_engagement
--   - Premium Creator Breakdown: Now updated to use portfolio_creator_engagement_metrics

-- ============================================================================
-- STEP 1: Drop dependent views
-- ============================================================================

DROP VIEW IF EXISTS premium_creator_portfolio_metrics_latest CASCADE;

-- ============================================================================
-- STEP 2: Drop unused columns from table
-- ============================================================================

ALTER TABLE premium_creator_portfolio_metrics
DROP COLUMN IF EXISTS total_profile_views,
DROP COLUMN IF EXISTS total_copies;

-- ============================================================================
-- STEP 3: Recreate view without removed columns
-- ============================================================================

CREATE OR REPLACE VIEW premium_creator_portfolio_metrics_latest AS
SELECT DISTINCT ON (creator_id, portfolio_ticker)
  creator_id,
  creator_username,
  portfolio_ticker,
  total_pdp_views,
  total_liquidations,
  synced_at
FROM premium_creator_portfolio_metrics
ORDER BY creator_id, portfolio_ticker, synced_at DESC;

COMMENT ON VIEW premium_creator_portfolio_metrics_latest IS
'Returns the latest sync data for each creator-portfolio combination. Profile views and copies removed as they are aggregated from user-level data instead.';
