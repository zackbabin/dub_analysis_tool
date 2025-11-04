-- Migration: Create premium_creator_metrics table for creator-level metrics
-- Date: 2025-11-03
-- Purpose: Store creator-level subscription metrics separately from portfolio-level metrics
--          Subscriptions are at the creator level, not portfolio level
--          This prevents double-counting when aggregating by creator

-- ============================================================================
-- STEP 1: Drop dependent views (will be recreated by update_portfolio_engagement_metrics_view.sql)
-- ============================================================================

DROP MATERIALIZED VIEW IF EXISTS hidden_gems_portfolios CASCADE;
DROP MATERIALIZED VIEW IF EXISTS portfolio_creator_engagement_metrics CASCADE;
DROP VIEW IF EXISTS premium_creator_portfolio_metrics_latest CASCADE;

-- ============================================================================
-- STEP 2: Create creator-level metrics table
-- ============================================================================

CREATE TABLE IF NOT EXISTS premium_creator_metrics (
  id BIGSERIAL PRIMARY KEY,
  creator_id TEXT NOT NULL,
  creator_username TEXT,

  -- Creator-level subscription metrics from Mixpanel chart 85821646
  total_subscriptions INTEGER DEFAULT 0,
  total_paywall_views INTEGER DEFAULT 0,
  total_stripe_modal_views INTEGER DEFAULT 0,
  total_cancellations INTEGER DEFAULT 0,

  synced_at TIMESTAMPTZ DEFAULT NOW(),

  -- Ensure one row per creator per sync
  UNIQUE(creator_id, synced_at)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_premium_creator_metrics_creator
ON premium_creator_metrics (creator_id);

CREATE INDEX IF NOT EXISTS idx_premium_creator_metrics_synced
ON premium_creator_metrics (synced_at DESC);

-- ============================================================================
-- STEP 3: Create view to get latest sync data
-- ============================================================================

CREATE OR REPLACE VIEW premium_creator_metrics_latest AS
SELECT DISTINCT ON (creator_id)
  creator_id,
  creator_username,
  total_subscriptions,
  total_paywall_views,
  total_stripe_modal_views,
  total_cancellations,
  synced_at
FROM premium_creator_metrics
ORDER BY creator_id, synced_at DESC;

-- ============================================================================
-- STEP 4: Drop subscription columns from portfolio metrics table
-- ============================================================================
-- These columns should only exist at creator level, not portfolio level
-- Safe to drop now since we dropped dependent views in STEP 1

ALTER TABLE premium_creator_portfolio_metrics
DROP COLUMN IF EXISTS total_subscriptions,
DROP COLUMN IF EXISTS total_paywall_views,
DROP COLUMN IF EXISTS total_stripe_modal_views,
DROP COLUMN IF EXISTS total_cancellations;

-- ============================================================================
-- STEP 5: Recreate portfolio metrics latest view (without subscription columns)
-- ============================================================================

CREATE OR REPLACE VIEW premium_creator_portfolio_metrics_latest AS
SELECT DISTINCT ON (creator_id, portfolio_ticker)
  creator_id,
  creator_username,
  portfolio_ticker,
  total_pdp_views,
  total_profile_views,
  total_copies,
  total_liquidations,
  synced_at
FROM premium_creator_portfolio_metrics
ORDER BY creator_id, portfolio_ticker, synced_at DESC;

COMMENT ON TABLE premium_creator_metrics IS
'Creator-level subscription metrics from Mixpanel chart 85821646. Synced by sync-creator-data Edge Function.';

COMMENT ON VIEW premium_creator_metrics_latest IS
'Returns the latest sync data for each creator.';

COMMENT ON TABLE premium_creator_portfolio_metrics IS
'Portfolio-level metrics from Mixpanel chart 85810770. Does NOT include subscription metrics (those are in premium_creator_metrics).';
