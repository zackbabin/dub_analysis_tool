-- Migration: Create intermediate table for Premium Creator Portfolio Metrics
-- Date: 2025-11-03
-- Purpose: Store raw data from Mixpanel chart 85810770
--          This table will be joined with portfolio_creator_engagement_metrics materialized view
--          to add total_profile_views, total_subscriptions, total_paywall_views, total_stripe_modal_views

-- ============================================================================
-- STEP 1: Create intermediate table
-- ============================================================================
-- This table stores portfolio-level metrics from chart 85810770
-- Structure matches the nested Mixpanel response:
-- creatorUsername -> creatorId -> portfolioTicker -> metrics

CREATE TABLE IF NOT EXISTS premium_creator_portfolio_metrics (
  id BIGSERIAL PRIMARY KEY,
  creator_id TEXT NOT NULL,
  creator_username TEXT,
  portfolio_ticker TEXT NOT NULL,

  -- Metrics from Mixpanel chart 85810770
  total_pdp_views INTEGER DEFAULT 0,           -- A. Total Events of Viewed Portfolio Details
  total_profile_views INTEGER DEFAULT 0,        -- B. Total Profile Views
  total_copies INTEGER DEFAULT 0,               -- C. Total Copies
  total_subscriptions INTEGER DEFAULT 0,        -- D. Total Subscriptions
  total_paywall_views INTEGER DEFAULT 0,        -- E. Total Paywall Views
  total_stripe_modal_views INTEGER DEFAULT 0,   -- F. Total Stripe Modal Views

  synced_at TIMESTAMPTZ DEFAULT NOW(),

  -- Ensure one row per creator-portfolio combination per sync
  UNIQUE(creator_id, portfolio_ticker, synced_at)
);

-- Create indexes for JOIN performance
CREATE INDEX IF NOT EXISTS idx_premium_creator_portfolio_metrics_creator_portfolio
ON premium_creator_portfolio_metrics (creator_id, portfolio_ticker);

CREATE INDEX IF NOT EXISTS idx_premium_creator_portfolio_metrics_synced
ON premium_creator_portfolio_metrics (synced_at DESC);

-- ============================================================================
-- STEP 2: Create view to get latest sync data
-- ============================================================================
-- This view returns only the most recent sync's data for each creator-portfolio pair
CREATE OR REPLACE VIEW premium_creator_portfolio_metrics_latest AS
SELECT DISTINCT ON (creator_id, portfolio_ticker)
  creator_id,
  creator_username,
  portfolio_ticker,
  total_pdp_views,
  total_profile_views,
  total_copies,
  total_subscriptions,
  total_paywall_views,
  total_stripe_modal_views,
  synced_at
FROM premium_creator_portfolio_metrics
ORDER BY creator_id, portfolio_ticker, synced_at DESC;

-- ============================================================================
-- STEP 3: Verify table creation
-- ============================================================================
-- Run this to verify:
-- SELECT * FROM premium_creator_portfolio_metrics LIMIT 5;
-- SELECT * FROM premium_creator_portfolio_metrics_latest LIMIT 5;

COMMENT ON TABLE premium_creator_portfolio_metrics IS
'Raw portfolio-level metrics from Mixpanel chart 85810770. Synced by sync-creator-data Edge Function.';

COMMENT ON VIEW premium_creator_portfolio_metrics_latest IS
'Returns the latest sync data for each creator-portfolio combination.';
