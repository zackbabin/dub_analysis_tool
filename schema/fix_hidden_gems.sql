-- Fix script for hidden gems materialized views
-- Run this if you're getting errors about missing columns

-- Drop existing views (if they exist)
DROP MATERIALIZED VIEW IF EXISTS hidden_gems_portfolios CASCADE;
DROP MATERIALIZED VIEW IF EXISTS portfolio_creator_engagement_metrics CASCADE;
DROP VIEW IF EXISTS creator_profile_view_metrics CASCADE;

-- Recreate portfolio_creator_engagement_metrics
CREATE MATERIALIZED VIEW portfolio_creator_engagement_metrics AS
SELECT
  portfolio_ticker,
  creator_id,
  creator_username,
  COUNT(DISTINCT distinct_id) as unique_viewers,
  SUM(pdp_view_count) as total_pdp_views,
  SUM(CASE WHEN did_copy THEN 1 ELSE 0 END) as total_copies,
  ROUND(
    (SUM(CASE WHEN did_copy THEN 1 ELSE 0 END)::NUMERIC / NULLIF(COUNT(DISTINCT distinct_id), 0)) * 100,
    2
  ) as conversion_rate_pct
FROM user_portfolio_creator_copies
GROUP BY portfolio_ticker, creator_id, creator_username;

-- Recreate creator_profile_view_metrics
CREATE OR REPLACE VIEW creator_profile_view_metrics AS
SELECT
  creator_id,
  COUNT(DISTINCT distinct_id) as total_profile_views
FROM user_portfolio_creator_copies
GROUP BY creator_id;

-- Recreate hidden_gems_portfolios
CREATE MATERIALIZED VIEW hidden_gems_portfolios AS
WITH engagement_with_profile_views AS (
  SELECT
    pce.portfolio_ticker,
    pce.creator_id,
    pce.creator_username,
    pce.unique_viewers,
    pce.total_pdp_views,
    pce.total_copies,
    pce.conversion_rate_pct,
    COALESCE(cpv.total_profile_views, 0) as total_profile_views
  FROM portfolio_creator_engagement_metrics pce
  LEFT JOIN creator_profile_view_metrics cpv ON pce.creator_id = cpv.creator_id
),
percentile_thresholds AS (
  SELECT
    PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY total_pdp_views) as pdp_views_p50,
    PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY total_profile_views) as profile_views_p50
  FROM engagement_with_profile_views
)
SELECT
  e.portfolio_ticker,
  e.creator_id,
  e.creator_username,
  e.unique_viewers as unique_views,
  e.total_pdp_views,
  e.total_profile_views,
  e.total_copies,
  ROUND(
    (e.total_copies::NUMERIC / NULLIF(e.unique_viewers, 0)) * 100,
    2
  ) as conversion_rate_pct
FROM engagement_with_profile_views e
CROSS JOIN percentile_thresholds p
WHERE
  -- Must be in top 50% for either PDP views OR profile views
  (e.total_pdp_views >= p.pdp_views_p50 OR e.total_profile_views >= p.profile_views_p50)
  -- Low conversion rate (<=25%)
  AND ROUND((e.total_copies::NUMERIC / NULLIF(e.unique_viewers, 0)) * 100, 2) <= 25
ORDER BY e.total_pdp_views DESC
LIMIT 100;

-- Verify results
SELECT 'Hidden gems count' as metric, COUNT(*) as value FROM hidden_gems_portfolios;

-- Show sample results
SELECT
  portfolio_ticker,
  creator_username,
  total_pdp_views,
  total_profile_views,
  unique_views,
  total_copies,
  conversion_rate_pct
FROM hidden_gems_portfolios
ORDER BY total_pdp_views DESC
LIMIT 10;
