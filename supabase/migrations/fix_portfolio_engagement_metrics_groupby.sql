-- Fix portfolio_creator_engagement_metrics GROUP BY issue
-- Problem: Grouping by premium metrics columns creates duplicate rows
-- Solution: Only group by portfolio/creator identifiers, aggregate the premium metrics

DROP MATERIALIZED VIEW IF EXISTS hidden_gems_portfolios;
DROP MATERIALIZED VIEW IF EXISTS portfolio_creator_engagement_metrics;

CREATE MATERIALIZED VIEW portfolio_creator_engagement_metrics AS
SELECT
  upce.portfolio_ticker,
  upce.creator_id,
  upce.creator_username,

  -- Metrics from user_portfolio_creator_engagement (aggregated)
  COUNT(DISTINCT upce.distinct_id) AS unique_viewers,
  SUM(upce.pdp_view_count) AS total_pdp_views,
  SUM(CASE WHEN upce.did_copy THEN upce.copy_count ELSE 0 END) AS total_copies,
  SUM(upce.liquidation_count) AS total_liquidations,

  -- Metrics from premium_creator_portfolio_metrics_latest (use MAX since they should be the same for all rows)
  MAX(COALESCE(pcpm.total_profile_views, 0)) AS total_profile_views,
  MAX(COALESCE(pcpm.total_subscriptions, 0)) AS total_subscriptions,
  MAX(COALESCE(pcpm.total_paywall_views, 0)) AS total_paywall_views,
  MAX(COALESCE(pcpm.total_stripe_modal_views, 0)) AS total_stripe_modal_views,
  MAX(COALESCE(pcpm.total_cancellations, 0)) AS total_cancellations,

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
FROM portfolio_creator_engagement_metrics
WHERE
  total_pdp_views >= 10
  AND (total_pdp_views::NUMERIC / NULLIF(total_copies, 0)) >= 5
  AND total_copies <= 100
ORDER BY total_pdp_views DESC;

CREATE INDEX IF NOT EXISTS idx_hidden_gems_portfolios_ticker
ON hidden_gems_portfolios (portfolio_ticker);

COMMENT ON MATERIALIZED VIEW portfolio_creator_engagement_metrics IS
'Aggregated portfolio-creator engagement metrics. Combines user_portfolio_creator_engagement data with premium_creator_portfolio_metrics_latest. Refresh after sync.';

COMMENT ON MATERIALIZED VIEW hidden_gems_portfolios IS
'Hidden gem portfolios: high PDP views but low copy conversion. Refreshed via refresh_portfolio_engagement_views().';
