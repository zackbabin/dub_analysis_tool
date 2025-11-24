-- Fix total_copies calculation in portfolio_creator_engagement_metrics
-- Problem: JOIN to portfolio_creator_copy_metrics causing duplicates
-- Solution: Calculate everything directly from user_portfolio_creator_engagement
-- Date: 2024-11-24

DROP MATERIALIZED VIEW IF EXISTS hidden_gems_portfolios CASCADE;
DROP MATERIALIZED VIEW IF EXISTS portfolio_creator_engagement_metrics CASCADE;

-- Recreate portfolio_creator_engagement_metrics with simple aggregation
-- No JOINs needed - calculate everything from user-level data
CREATE MATERIALIZED VIEW portfolio_creator_engagement_metrics AS
SELECT
  portfolio_ticker,
  creator_id,
  creator_username,

  -- Count distinct users
  COUNT(DISTINCT CASE WHEN pdp_view_count > 0 THEN distinct_id END) AS unique_viewers,
  COUNT(DISTINCT CASE WHEN did_copy THEN distinct_id END) AS unique_copiers,

  -- Sum metrics from user-level data
  SUM(pdp_view_count) AS total_pdp_views,
  SUM(CASE WHEN did_copy THEN copy_count ELSE 0 END) AS total_copies,
  COALESCE(SUM(liquidation_count), 0) AS total_liquidations,

  -- Placeholder columns for compatibility
  0 AS total_profile_views,
  0 AS total_subscriptions,
  0 AS total_paywall_views,
  0 AS total_stripe_modal_views,
  0 AS total_cancellations,

  -- Conversion rate
  ROUND(
    (COUNT(DISTINCT CASE WHEN did_copy THEN distinct_id END)::NUMERIC /
     NULLIF(COUNT(DISTINCT CASE WHEN pdp_view_count > 0 THEN distinct_id END), 0)) * 100,
    2
  ) AS conversion_rate_pct

FROM user_portfolio_creator_engagement

GROUP BY portfolio_ticker, creator_id, creator_username;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_portfolio_creator_engagement_metrics_ticker
ON portfolio_creator_engagement_metrics (portfolio_ticker);

CREATE INDEX IF NOT EXISTS idx_portfolio_creator_engagement_metrics_creator
ON portfolio_creator_engagement_metrics (creator_id);

CREATE INDEX IF NOT EXISTS idx_portfolio_creator_engagement_profile_views
ON portfolio_creator_engagement_metrics (total_profile_views DESC);

CREATE INDEX IF NOT EXISTS idx_portfolio_creator_engagement_subscriptions
ON portfolio_creator_engagement_metrics (total_subscriptions DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_portfolio_creator_engagement_metrics_pk
ON portfolio_creator_engagement_metrics(portfolio_ticker, creator_id);

COMMENT ON MATERIALIZED VIEW portfolio_creator_engagement_metrics IS
'Aggregated portfolio-creator engagement metrics calculated from user_portfolio_creator_engagement. Refresh after sync.';

-- Recreate hidden_gems_portfolios
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_hidden_gems_portfolios_pk
ON hidden_gems_portfolios(portfolio_ticker, creator_id);

COMMENT ON MATERIALIZED VIEW hidden_gems_portfolios IS
'Hidden gem portfolios: many unique viewers but few unique copiers (ratio >= 5). Total_copies calculated from user-level data.';

-- Log the fix
DO $$
BEGIN
  RAISE NOTICE '✅ Fixed total_copies calculation - no JOINs, pure aggregation from user data';
  RAISE NOTICE '   Run refresh_portfolio_engagement_views() to populate with data';
END $$;
