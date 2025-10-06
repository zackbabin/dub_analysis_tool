-- Diagnostic query to understand hidden gems distribution
-- Run this in Supabase SQL Editor to see why only 3 results exist

-- Step 1: Check total portfolio-creator pairs in base table
SELECT
    'Total portfolio-creator pairs' as metric,
    COUNT(*) as count
FROM user_portfolio_creator_copies
GROUP BY 1;

-- Step 2: Check portfolio_creator_engagement_metrics exists and has data
SELECT
    'Engagement metrics count' as metric,
    COUNT(*) as count
FROM portfolio_creator_engagement_metrics
GROUP BY 1;

-- Step 3: Analyze percentile distribution for PDP views
WITH percentiles AS (
    SELECT
        PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY total_pdp_views) as p25,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY total_pdp_views) as p50,
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY total_pdp_views) as p75,
        PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY total_pdp_views) as p90
    FROM portfolio_creator_engagement_metrics
)
SELECT
    'PDP Views' as metric,
    'P25' as percentile,
    p25 as threshold
FROM percentiles
UNION ALL
SELECT 'PDP Views', 'P50 (Current)', p50 FROM percentiles
UNION ALL
SELECT 'PDP Views', 'P75', p75 FROM percentiles
UNION ALL
SELECT 'PDP Views', 'P90', p90 FROM percentiles;

-- Step 4: Distribution of unique_viewers to copies ratio
WITH ratios AS (
    SELECT
        portfolio_ticker,
        creator_username,
        unique_viewers,
        total_copies,
        total_pdp_views,
        ROUND((unique_viewers::NUMERIC / NULLIF(total_copies, 0)), 2) as viewers_to_copies_ratio,
        ROUND((total_copies::NUMERIC / NULLIF(unique_viewers, 0)) * 100, 2) as conversion_rate_pct
    FROM portfolio_creator_engagement_metrics
    WHERE total_copies > 0
)
SELECT
    'Ratio Distribution' as analysis,
    COUNT(*) FILTER (WHERE viewers_to_copies_ratio >= 10) as "ratio_>=_10:1",
    COUNT(*) FILTER (WHERE viewers_to_copies_ratio >= 7 AND viewers_to_copies_ratio < 10) as "ratio_7-10:1",
    COUNT(*) FILTER (WHERE viewers_to_copies_ratio >= 5 AND viewers_to_copies_ratio < 7) as "ratio_5-7:1",
    COUNT(*) FILTER (WHERE viewers_to_copies_ratio >= 3 AND viewers_to_copies_ratio < 5) as "ratio_3-5:1",
    COUNT(*) FILTER (WHERE viewers_to_copies_ratio < 3) as "ratio_<_3:1",
    COUNT(*) as total_with_copies
FROM ratios;

-- Step 5: How many portfolios pass different thresholds?
WITH percentile_thresholds AS (
    SELECT
        PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY total_pdp_views) as pdp_p25,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY total_pdp_views) as pdp_p50,
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY total_pdp_views) as pdp_p75
    FROM portfolio_creator_engagement_metrics
)
SELECT
    'Count at different thresholds' as analysis,
    COUNT(*) FILTER (
        WHERE pce.total_pdp_views >= p.pdp_p50
        AND (pce.unique_viewers::NUMERIC / NULLIF(pce.total_copies, 0)) >= 7
    ) as "P50_ratio_7:1 (Current)",
    COUNT(*) FILTER (
        WHERE pce.total_pdp_views >= p.pdp_p50
        AND (pce.unique_viewers::NUMERIC / NULLIF(pce.total_copies, 0)) >= 5
    ) as "P50_ratio_5:1",
    COUNT(*) FILTER (
        WHERE pce.total_pdp_views >= p.pdp_p25
        AND (pce.unique_viewers::NUMERIC / NULLIF(pce.total_copies, 0)) >= 7
    ) as "P25_ratio_7:1",
    COUNT(*) FILTER (
        WHERE pce.total_pdp_views >= p.pdp_p25
        AND (pce.unique_viewers::NUMERIC / NULLIF(pce.total_copies, 0)) >= 5
    ) as "P25_ratio_5:1"
FROM portfolio_creator_engagement_metrics pce
CROSS JOIN percentile_thresholds p
WHERE pce.total_copies > 0;

-- Step 6: Show current hidden gems with their stats
SELECT
    'Current Hidden Gems (3 results)' as section,
    portfolio_ticker,
    creator_username,
    unique_pdp_views,
    total_pdp_views,
    total_copies,
    unique_views_to_copies_ratio as "viewers:copies",
    conversion_rate_pct as "conv_rate_%"
FROM hidden_gems_portfolios
ORDER BY total_pdp_views DESC;

-- Step 7: Show what results would look like with relaxed criteria
-- Option A: P50 + 5:1 ratio
WITH percentile_thresholds AS (
    SELECT
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY total_pdp_views) as pdp_p50
    FROM portfolio_creator_engagement_metrics
)
SELECT
    'Option A: P50 + 5:1 ratio' as option,
    pce.portfolio_ticker,
    pce.creator_username,
    pce.unique_viewers as unique_pdp_views,
    pce.total_pdp_views,
    pce.total_copies,
    ROUND((pce.unique_viewers::NUMERIC / NULLIF(pce.total_copies, 0)), 2) as "viewers:copies",
    ROUND((pce.total_copies::NUMERIC / NULLIF(pce.unique_viewers, 0)) * 100, 2) as "conv_rate_%"
FROM portfolio_creator_engagement_metrics pce
CROSS JOIN percentile_thresholds p
WHERE pce.total_pdp_views >= p.pdp_p50
  AND (pce.unique_viewers::NUMERIC / NULLIF(pce.total_copies, 0)) >= 5
ORDER BY pce.total_pdp_views DESC
LIMIT 10;

-- Step 8: Option B: P25 + 7:1 ratio
WITH percentile_thresholds AS (
    SELECT
        PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY total_pdp_views) as pdp_p25
    FROM portfolio_creator_engagement_metrics
)
SELECT
    'Option B: P25 + 7:1 ratio' as option,
    pce.portfolio_ticker,
    pce.creator_username,
    pce.unique_viewers as unique_pdp_views,
    pce.total_pdp_views,
    pce.total_copies,
    ROUND((pce.unique_viewers::NUMERIC / NULLIF(pce.total_copies, 0)), 2) as "viewers:copies",
    ROUND((pce.total_copies::NUMERIC / NULLIF(pce.unique_viewers, 0)) * 100, 2) as "conv_rate_%"
FROM portfolio_creator_engagement_metrics pce
CROSS JOIN percentile_thresholds p
WHERE pce.total_pdp_views >= p.pdp_p25
  AND (pce.unique_viewers::NUMERIC / NULLIF(pce.total_copies, 0)) >= 7
ORDER BY pce.total_pdp_views DESC
LIMIT 10;

-- Step 9: Show conversion rate distribution for context
SELECT
    'Conversion Rate Ranges' as metric,
    COUNT(*) FILTER (WHERE conversion_rate_pct <= 5) as "<=5%",
    COUNT(*) FILTER (WHERE conversion_rate_pct > 5 AND conversion_rate_pct <= 10) as "5-10%",
    COUNT(*) FILTER (WHERE conversion_rate_pct > 10 AND conversion_rate_pct <= 15) as "10-15%",
    COUNT(*) FILTER (WHERE conversion_rate_pct > 15 AND conversion_rate_pct <= 20) as "15-20%",
    COUNT(*) FILTER (WHERE conversion_rate_pct > 20) as ">20%"
FROM portfolio_creator_engagement_metrics
WHERE total_copies > 0;
