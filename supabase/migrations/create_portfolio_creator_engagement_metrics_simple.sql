-- Create portfolio_creator_engagement_metrics materialized view
-- Simple version using only existing tables (no premium_creator_portfolio_metrics_latest dependency)
-- This aggregates user_portfolio_creator_engagement to portfolio-creator level

DROP MATERIALIZED VIEW IF EXISTS portfolio_creator_engagement_metrics CASCADE;

CREATE MATERIALIZED VIEW portfolio_creator_engagement_metrics AS
SELECT
  upce.portfolio_ticker,
  upce.creator_id,
  upce.creator_username,

  -- Aggregate user-level data to portfolio-creator level
  COUNT(DISTINCT upce.distinct_id) AS unique_viewers,
  SUM(upce.pdp_view_count) AS total_pdp_views,
  SUM(CASE WHEN upce.did_copy THEN upce.copy_count ELSE 0 END) AS total_copies,
  SUM(upce.liquidation_count) AS total_liquidations,

  -- Conversion rate: users who copied / total users
  ROUND(
    (SUM(CASE WHEN upce.did_copy THEN 1 ELSE 0 END)::NUMERIC / NULLIF(COUNT(DISTINCT upce.distinct_id), 0)) * 100,
    2
  ) AS conversion_rate_pct

FROM user_portfolio_creator_engagement upce

GROUP BY
  upce.portfolio_ticker,
  upce.creator_id,
  upce.creator_username;

-- Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_portfolio_creator_engagement_metrics_ticker
ON portfolio_creator_engagement_metrics (portfolio_ticker);

CREATE INDEX IF NOT EXISTS idx_portfolio_creator_engagement_metrics_creator
ON portfolio_creator_engagement_metrics (creator_id);

CREATE INDEX IF NOT EXISTS idx_portfolio_creator_engagement_copies
ON portfolio_creator_engagement_metrics (total_copies DESC);

CREATE INDEX IF NOT EXISTS idx_portfolio_creator_engagement_liquidations
ON portfolio_creator_engagement_metrics (total_liquidations DESC);

-- Grant permissions
GRANT SELECT ON portfolio_creator_engagement_metrics TO anon, authenticated;

-- Add comment
COMMENT ON MATERIALIZED VIEW portfolio_creator_engagement_metrics IS
'Portfolio-creator level aggregation of engagement metrics from user_portfolio_creator_engagement. Aggregates copies, liquidations, and PDP views. Refresh after syncing engagement data.';

-- Create hidden_gems_portfolios (dependent view)
DROP MATERIALIZED VIEW IF EXISTS hidden_gems_portfolios CASCADE;

CREATE MATERIALIZED VIEW hidden_gems_portfolios AS
SELECT
  portfolio_ticker,
  creator_id,
  creator_username,
  unique_viewers,
  total_pdp_views,
  total_copies,
  total_liquidations,
  conversion_rate_pct,
  -- Calculate viewer-to-copier ratio (high ratio = hidden gem)
  CASE
    WHEN total_copies > 0
    THEN ROUND((unique_viewers::NUMERIC / total_copies::NUMERIC), 2)
    ELSE NULL
  END AS viewer_copier_ratio
FROM portfolio_creator_engagement_metrics
WHERE unique_viewers >= 5  -- At least 5 viewers
  AND total_copies < 5     -- But fewer than 5 copies
  AND unique_viewers >= total_copies * 5  -- Ratio of at least 5:1
ORDER BY unique_viewers DESC, viewer_copier_ratio DESC;

-- Grant permissions
GRANT SELECT ON hidden_gems_portfolios TO anon, authenticated;

-- Add comment
COMMENT ON MATERIALIZED VIEW hidden_gems_portfolios IS
'Hidden gem portfolios: many unique viewers but few unique copiers (ratio >= 5). Indicates high interest but low conversion. Refreshed via refresh_portfolio_engagement_views().';

-- Refresh both views to populate with current data
REFRESH MATERIALIZED VIEW portfolio_creator_engagement_metrics;
REFRESH MATERIALIZED VIEW hidden_gems_portfolios;
