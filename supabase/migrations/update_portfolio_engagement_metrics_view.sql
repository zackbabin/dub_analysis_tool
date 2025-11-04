-- Migration: Update portfolio_creator_engagement_metrics view to join creator-level metrics correctly
-- Date: 2025-11-03
-- Purpose: Fix the view to join with premium_creator_metrics (creator-level) instead of
--          trying to get subscription metrics from premium_creator_portfolio_metrics (portfolio-level)
-- Note: Views were already dropped by create_premium_creator_metrics_table.sql

-- Recreate portfolio_creator_engagement_metrics with correct joins
CREATE MATERIALIZED VIEW portfolio_creator_engagement_metrics AS
SELECT
  upce.portfolio_ticker,
  upce.creator_id,
  upce.creator_username,

  -- Count distinct users who viewed (from rows with pdp_view_count > 0)
  COUNT(DISTINCT CASE WHEN upce.pdp_view_count > 0 THEN upce.distinct_id END) AS unique_viewers,

  -- Count distinct users who copied (from rows with did_copy = true)
  COUNT(DISTINCT CASE WHEN upce.did_copy THEN upce.distinct_id END) AS unique_copiers,

  -- Portfolio-level aggregate metrics from premium_creator_portfolio_metrics
  -- Use MAX since values should be same across all user rows for this portfolio
  MAX(COALESCE(pcpm.total_pdp_views, 0)) AS total_pdp_views,
  MAX(COALESCE(pcpm.total_profile_views, 0)) AS total_profile_views,
  MAX(COALESCE(pcpm.total_copies, 0)) AS total_copies,
  MAX(COALESCE(pcpm.total_liquidations, 0)) AS total_liquidations,

  -- Creator-level subscription metrics from premium_creator_metrics
  -- These are the same for all portfolios of a creator, so we use MAX to get the value
  MAX(COALESCE(pcm.total_subscriptions, 0)) AS total_subscriptions,
  MAX(COALESCE(pcm.total_paywall_views, 0)) AS total_paywall_views,
  MAX(COALESCE(pcm.total_stripe_modal_views, 0)) AS total_stripe_modal_views,
  MAX(COALESCE(pcm.total_cancellations, 0)) AS total_cancellations,

  -- Conversion rate: users who copied / users who viewed
  ROUND(
    (COUNT(DISTINCT CASE WHEN upce.did_copy THEN upce.distinct_id END)::NUMERIC /
     NULLIF(COUNT(DISTINCT CASE WHEN upce.pdp_view_count > 0 THEN upce.distinct_id END), 0)) * 100,
    2
  ) AS conversion_rate_pct

FROM user_portfolio_creator_engagement upce

-- Join portfolio-level metrics (PDP views, profile views, copies, liquidations)
LEFT JOIN premium_creator_portfolio_metrics_latest pcpm
  ON upce.creator_id = pcpm.creator_id
  AND upce.portfolio_ticker = pcpm.portfolio_ticker

-- Join creator-level metrics (subscriptions, paywall views, stripe modal views, cancellations)
LEFT JOIN premium_creator_metrics_latest pcm
  ON upce.creator_id = pcm.creator_id

GROUP BY
  upce.portfolio_ticker,
  upce.creator_id,
  upce.creator_username;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_portfolio_creator_engagement_metrics_ticker
ON portfolio_creator_engagement_metrics (portfolio_ticker);

CREATE INDEX IF NOT EXISTS idx_portfolio_creator_engagement_metrics_creator
ON portfolio_creator_engagement_metrics (creator_id);

CREATE INDEX IF NOT EXISTS idx_portfolio_creator_engagement_profile_views
ON portfolio_creator_engagement_metrics (total_profile_views DESC);

CREATE INDEX IF NOT EXISTS idx_portfolio_creator_engagement_subscriptions
ON portfolio_creator_engagement_metrics (total_subscriptions DESC);

-- Recreate hidden_gems_portfolios
-- Hidden Gems = portfolios with many viewers but few copiers (high ratio indicates low conversion)
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

CREATE INDEX IF NOT EXISTS idx_hidden_gems_portfolios_ticker
ON hidden_gems_portfolios (portfolio_ticker);

COMMENT ON MATERIALIZED VIEW portfolio_creator_engagement_metrics IS
'Aggregated portfolio-creator engagement metrics. Joins portfolio-level metrics from premium_creator_portfolio_metrics and creator-level subscription metrics from premium_creator_metrics. Refresh after sync.';

COMMENT ON MATERIALIZED VIEW hidden_gems_portfolios IS
'Hidden gem portfolios: many unique viewers but few unique copiers (ratio >= 5). Indicates high interest but low conversion. Refreshed via refresh_portfolio_engagement_views().';
