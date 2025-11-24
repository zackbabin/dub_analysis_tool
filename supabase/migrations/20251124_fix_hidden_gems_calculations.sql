-- Fix hidden gems calculations
-- Problem 1: total_copies was summing copy_count across all users (inflated)
-- Problem 2: conversion_rate should be total_copies / unique_viewers, not unique_copiers / unique_viewers
-- Solution: total_copies should equal unique_copiers (distinct users who copied)
-- Date: 2024-11-24

DROP MATERIALIZED VIEW IF EXISTS hidden_gems_portfolios CASCADE;
DROP MATERIALIZED VIEW IF EXISTS portfolio_creator_engagement_metrics CASCADE;

CREATE MATERIALIZED VIEW portfolio_creator_engagement_metrics AS
SELECT
  portfolio_ticker,
  creator_id,
  MAX(creator_username) AS creator_username,

  -- User counts
  COUNT(DISTINCT CASE WHEN pdp_view_count > 0 THEN distinct_id END) AS unique_viewers,
  COUNT(DISTINCT CASE WHEN did_copy THEN distinct_id END) AS unique_copiers,

  -- Aggregated metrics
  SUM(pdp_view_count) AS total_pdp_views,

  -- total_copies = number of distinct users who copied (same as unique_copiers)
  -- This is the correct metric for conversion analysis
  COUNT(DISTINCT CASE WHEN did_copy THEN distinct_id END) AS total_copies,

  COALESCE(SUM(liquidation_count), 0) AS total_liquidations,

  -- Conversion rate: total copies / unique viewers
  ROUND(
    (COUNT(DISTINCT CASE WHEN did_copy THEN distinct_id END)::NUMERIC /
     NULLIF(COUNT(DISTINCT CASE WHEN pdp_view_count > 0 THEN distinct_id END), 0)) * 100,
    2
  ) AS conversion_rate_pct

FROM user_portfolio_creator_engagement

GROUP BY portfolio_ticker, creator_id;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_portfolio_creator_engagement_metrics_ticker
ON portfolio_creator_engagement_metrics (portfolio_ticker);

CREATE INDEX IF NOT EXISTS idx_portfolio_creator_engagement_metrics_creator
ON portfolio_creator_engagement_metrics (creator_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_portfolio_creator_engagement_metrics_pk
ON portfolio_creator_engagement_metrics(portfolio_ticker, creator_id);

COMMENT ON MATERIALIZED VIEW portfolio_creator_engagement_metrics IS
'Portfolio-creator engagement metrics. total_copies = unique users who copied (for accurate conversion rates).';

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
'Hidden gem portfolios: many unique viewers but few copies (ratio >= 5). Conversion rate = total_copies / unique_viewers.';

-- Log the fix
DO $$
BEGIN
  RAISE NOTICE '✅ Fixed hidden gems calculations';
  RAISE NOTICE '   - total_copies now equals unique_copiers (distinct users who copied)';
  RAISE NOTICE '   - conversion_rate = total_copies / unique_viewers';
  RAISE NOTICE '   - No longer summing copy_count which inflated numbers';
END $$;
