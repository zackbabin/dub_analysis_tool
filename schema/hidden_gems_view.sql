-- Hidden Gems Analysis View
-- Identifies portfolios with high engagement (top 50% PDP/Profile views) but low copy conversion
-- Execute this in Supabase SQL Editor

-- Step 1: Create materialized view that aggregates portfolio-creator engagement metrics
DROP MATERIALIZED VIEW IF EXISTS hidden_gems_portfolios CASCADE;
DROP MATERIALIZED VIEW IF EXISTS portfolio_creator_engagement_metrics CASCADE;
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

-- Step 2: Create view that calculates profile views per creator
CREATE OR REPLACE VIEW creator_profile_view_metrics AS
SELECT
  creator_id,
  COUNT(DISTINCT distinct_id) as total_profile_views
FROM user_portfolio_creator_copies
GROUP BY creator_id;

-- Step 3: Create hidden gems materialized view with PDP views to copies ratio threshold
CREATE MATERIALIZED VIEW hidden_gems_portfolios AS
WITH percentile_thresholds AS (
  SELECT
    PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY total_pdp_views) as pdp_views_p75
  FROM portfolio_creator_engagement_metrics
)
SELECT
  pce.portfolio_ticker,
  pce.creator_id,
  pce.creator_username,
  pce.unique_viewers as unique_views,
  pce.total_pdp_views,
  pce.total_copies,
  ROUND(
    (pce.total_pdp_views::NUMERIC / NULLIF(pce.total_copies, 0)),
    2
  ) as pdp_to_copies_ratio,
  ROUND(
    (pce.total_copies::NUMERIC / NULLIF(pce.unique_viewers, 0)) * 100,
    2
  ) as conversion_rate_pct
FROM portfolio_creator_engagement_metrics pce
CROSS JOIN percentile_thresholds p
WHERE
  -- Must be in top 25% for PDP views
  pce.total_pdp_views >= p.pdp_views_p75
  -- High PDP views to copies ratio (>= 7:1)
  AND (pce.total_pdp_views::NUMERIC / NULLIF(pce.total_copies, 0)) >= 7
ORDER BY pce.total_pdp_views DESC
LIMIT 10;

-- Step 4: Create summary stats view for hidden gems
CREATE OR REPLACE VIEW hidden_gems_summary AS
SELECT
  COUNT(*) as total_hidden_gems,
  ROUND(AVG(total_pdp_views), 1) as avg_pdp_views,
  ROUND(AVG(conversion_rate_pct), 2) as avg_conversion_rate
FROM hidden_gems_portfolios;

-- Grant permissions (adjust as needed for your setup)
-- GRANT SELECT ON portfolio_creator_engagement_metrics TO authenticated;
-- GRANT SELECT ON creator_profile_view_metrics TO authenticated;
-- GRANT SELECT ON hidden_gems_portfolios TO authenticated;
-- GRANT SELECT ON hidden_gems_summary TO authenticated;
