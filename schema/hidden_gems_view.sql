-- Hidden Gems Analysis View
-- Identifies portfolios with high engagement (top 25% PDP/Profile views) but low copy conversion
-- Execute this in Supabase SQL Editor

-- Step 1: Create view that aggregates portfolio-creator engagement metrics
CREATE OR REPLACE VIEW portfolio_creator_engagement_metrics AS
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

-- Step 3: Create hidden gems view with dynamic percentile thresholds
CREATE OR REPLACE VIEW hidden_gems_portfolios AS
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
  e.total_pdp_views >= p.pdp_views_p50
  AND e.total_profile_views >= p.profile_views_p50
  AND ROUND((e.total_copies::NUMERIC / NULLIF(e.unique_viewers, 0)) * 100, 2) <= 10
  AND e.unique_viewers >= 5  -- Minimum sample size
ORDER BY e.total_pdp_views DESC
LIMIT 100;

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
