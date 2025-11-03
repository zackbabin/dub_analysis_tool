-- Fix Hidden Gems to work with separated view/copy events
-- Problem: pdp_view_count and copy_count never appear in the same row (Mixpanel separates these events)
-- Solution: Calculate portfolio-level metrics by counting distinct users who viewed vs copied

DROP MATERIALIZED VIEW IF EXISTS hidden_gems_portfolios;
DROP MATERIALIZED VIEW IF EXISTS portfolio_creator_engagement_metrics;

-- Recreate portfolio_creator_engagement_metrics with user-level aggregation
CREATE MATERIALIZED VIEW portfolio_creator_engagement_metrics AS
SELECT
  upce.portfolio_ticker,
  upce.creator_id,
  upce.creator_username,

  -- Count distinct users who viewed (from rows with pdp_view_count > 0)
  COUNT(DISTINCT CASE WHEN upce.pdp_view_count > 0 THEN upce.distinct_id END) AS unique_viewers,

  -- Sum total PDP views
  SUM(upce.pdp_view_count) AS total_pdp_views,

  -- Count distinct users who copied (from rows with did_copy = true)
  COUNT(DISTINCT CASE WHEN upce.did_copy THEN upce.distinct_id END) AS unique_copiers,

  -- Sum total copies
  SUM(CASE WHEN upce.did_copy THEN upce.copy_count ELSE 0 END) AS total_copies,

  -- Sum total liquidations
  SUM(upce.liquidation_count) AS total_liquidations,

  -- Premium metrics from joined table (use MAX since values should be same across rows)
  MAX(COALESCE(pcpm.total_profile_views, 0)) AS total_profile_views,
  MAX(COALESCE(pcpm.total_subscriptions, 0)) AS total_subscriptions,
  MAX(COALESCE(pcpm.total_paywall_views, 0)) AS total_paywall_views,
  MAX(COALESCE(pcpm.total_stripe_modal_views, 0)) AS total_stripe_modal_views,
  MAX(COALESCE(pcpm.total_cancellations, 0)) AS total_cancellations,

  -- Conversion rate: users who copied / users who viewed
  ROUND(
    (COUNT(DISTINCT CASE WHEN upce.did_copy THEN upce.distinct_id END)::NUMERIC /
     NULLIF(COUNT(DISTINCT CASE WHEN upce.pdp_view_count > 0 THEN upce.distinct_id END), 0)) * 100,
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

-- Recreate hidden_gems_portfolios with new logic
-- Hidden Gems = portfolios with many viewers but few copiers (low conversion)
CREATE MATERIALIZED VIEW hidden_gems_portfolios AS
SELECT
  portfolio_ticker,
  creator_id,
  creator_username,
  unique_viewers as unique_views,
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
'Aggregated portfolio-creator engagement metrics. Counts unique viewers and unique copiers from separate event rows. Refresh after sync.';

COMMENT ON MATERIALIZED VIEW hidden_gems_portfolios IS
'Hidden gem portfolios: many unique viewers but few unique copiers (ratio >= 5). Indicates high interest but low conversion. Refreshed via refresh_portfolio_engagement_views().';
