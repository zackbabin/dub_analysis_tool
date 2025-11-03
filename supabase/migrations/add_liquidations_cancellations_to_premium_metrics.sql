-- Add total_liquidations and total_cancellations columns to premium_creator_portfolio_metrics
-- Maps to metrics "G. Total Liquidations" and "H. Total Cancellations" from Mixpanel chart 85810770

ALTER TABLE premium_creator_portfolio_metrics
ADD COLUMN IF NOT EXISTS total_liquidations integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_cancellations integer DEFAULT 0;

COMMENT ON COLUMN premium_creator_portfolio_metrics.total_liquidations IS 'Total liquidations from Mixpanel chart 85810770 metric G';
COMMENT ON COLUMN premium_creator_portfolio_metrics.total_cancellations IS 'Total subscription cancellations from Mixpanel chart 85810770 metric H';

-- Drop and recreate the view to include new columns (CASCADE to drop dependent materialized views)
DROP VIEW IF EXISTS premium_creator_portfolio_metrics_latest CASCADE;

CREATE VIEW premium_creator_portfolio_metrics_latest AS
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
  total_liquidations,
  total_cancellations,
  synced_at
FROM premium_creator_portfolio_metrics
ORDER BY creator_id, portfolio_ticker, synced_at DESC;

COMMENT ON VIEW premium_creator_portfolio_metrics_latest IS
'Latest premium creator portfolio metrics. Includes PDP views, profile views, copies, subscriptions, paywall views, stripe modal views, liquidations, and cancellations from Mixpanel chart 85810770.';

-- Recreate portfolio_creator_engagement_metrics materialized view with new columns
CREATE MATERIALIZED VIEW portfolio_creator_engagement_metrics AS
SELECT
  upce.portfolio_ticker,
  upce.creator_id,
  upce.creator_username,

  -- Existing metrics from user_portfolio_creator_engagement
  COUNT(DISTINCT upce.distinct_id) AS unique_viewers,
  SUM(upce.pdp_view_count) AS total_pdp_views,
  SUM(CASE WHEN upce.did_copy THEN upce.copy_count ELSE 0 END) AS total_copies,
  SUM(upce.liquidation_count) AS total_liquidations,

  -- Columns from premium_creator_portfolio_metrics_latest
  COALESCE(pcpm.total_profile_views, 0) AS total_profile_views,
  COALESCE(pcpm.total_subscriptions, 0) AS total_subscriptions,
  COALESCE(pcpm.total_paywall_views, 0) AS total_paywall_views,
  COALESCE(pcpm.total_stripe_modal_views, 0) AS total_stripe_modal_views,
  COALESCE(pcpm.total_cancellations, 0) AS total_cancellations,

  -- Conversion rate calculation
  ROUND(
    (SUM(CASE WHEN upce.did_copy THEN 1 ELSE 0 END)::NUMERIC / NULLIF(COUNT(DISTINCT upce.distinct_id), 0)) * 100,
    2
  ) AS conversion_rate_pct

FROM user_portfolio_creator_engagement upce

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
  pcpm.total_stripe_modal_views,
  pcpm.total_cancellations;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_portfolio_creator_engagement_metrics_ticker
ON portfolio_creator_engagement_metrics (portfolio_ticker);

CREATE INDEX IF NOT EXISTS idx_portfolio_creator_engagement_metrics_creator
ON portfolio_creator_engagement_metrics (creator_id);

CREATE INDEX IF NOT EXISTS idx_portfolio_creator_engagement_profile_views
ON portfolio_creator_engagement_metrics (total_profile_views DESC);

CREATE INDEX IF NOT EXISTS idx_portfolio_creator_engagement_subscriptions
ON portfolio_creator_engagement_metrics (total_subscriptions DESC);

-- Recreate hidden_gems_portfolios materialized view
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
