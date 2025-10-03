-- Debug script for hidden gems analysis
-- Run this to understand why only 1 result is showing

-- Step 1: Check how many portfolio-creator pairs exist
SELECT
    'Total portfolio-creator pairs' as metric,
    COUNT(*) as count
FROM user_portfolio_creator_copies;

-- Step 2: Check portfolio_creator_engagement_metrics
SELECT
    'Engagement metrics count' as metric,
    COUNT(*) as count
FROM portfolio_creator_engagement_metrics;

-- Step 3: Check percentile thresholds
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
)
SELECT
    'PDP Views P50' as metric,
    PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY total_pdp_views) as value
FROM engagement_with_profile_views
UNION ALL
SELECT
    'Profile Views P50' as metric,
    PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY total_profile_views) as value
FROM engagement_with_profile_views;

-- Step 4: Check how many pass engagement threshold
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
    'Pass engagement threshold' as metric,
    COUNT(*) as count
FROM engagement_with_profile_views e
CROSS JOIN percentile_thresholds p
WHERE (e.total_pdp_views >= p.pdp_views_p50 OR e.total_profile_views >= p.profile_views_p50);

-- Step 5: Check conversion rate distribution
WITH engagement_with_profile_views AS (
  SELECT
    pce.portfolio_ticker,
    pce.creator_id,
    pce.creator_username,
    pce.unique_viewers,
    pce.total_pdp_views,
    pce.total_copies,
    pce.conversion_rate_pct,
    COALESCE(cpv.total_profile_views, 0) as total_profile_views,
    ROUND((pce.total_copies::NUMERIC / NULLIF(pce.unique_viewers, 0)) * 100, 2) as calc_conv_rate
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
    'Pass both filters' as metric,
    COUNT(*) as count
FROM engagement_with_profile_views e
CROSS JOIN percentile_thresholds p
WHERE (e.total_pdp_views >= p.pdp_views_p50 OR e.total_profile_views >= p.profile_views_p50)
  AND e.calc_conv_rate <= 25;

-- Step 6: Show actual hidden_gems_portfolios results
SELECT
    'Hidden gems results' as info,
    COUNT(*) as count
FROM hidden_gems_portfolios;

-- Step 7: Show top 10 hidden gems
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
