-- Database schema for portfolio copies analysis
-- Execute these commands in Supabase SQL Editor
-- Note: user_portfolio_creator_copies is a VIEW, not a table (created by sync process)

-- 1. Create view for copy conversion analysis by engagement level
CREATE OR REPLACE VIEW copy_conversion_by_engagement AS
WITH user_engagement AS (
  SELECT
    distinct_id,
    did_copy,
    COUNT(DISTINCT creator_id) as profile_views,
    SUM(pdp_view_count) as pdp_views
  FROM user_portfolio_creator_copies
  GROUP BY distinct_id, did_copy
),
bucketed_engagement AS (
  SELECT
    distinct_id,
    did_copy,
    CASE
      WHEN profile_views = 0 THEN '0'
      WHEN profile_views BETWEEN 1 AND 2 THEN '1-2'
      WHEN profile_views BETWEEN 3 AND 5 THEN '3-5'
      WHEN profile_views BETWEEN 6 AND 10 THEN '6-10'
      ELSE '10+'
    END as profile_views_bucket,
    CASE
      WHEN pdp_views = 0 THEN '0'
      WHEN pdp_views BETWEEN 1 AND 2 THEN '1-2'
      WHEN pdp_views BETWEEN 3 AND 5 THEN '3-5'
      WHEN pdp_views BETWEEN 6 AND 10 THEN '6-10'
      ELSE '10+'
    END as pdp_views_bucket
  FROM user_engagement
)
SELECT
  profile_views_bucket,
  pdp_views_bucket,
  COUNT(*) as total_users,
  SUM(CASE WHEN did_copy THEN 1 ELSE 0 END) as copiers,
  ROUND(
    (SUM(CASE WHEN did_copy THEN 1 ELSE 0 END)::NUMERIC / COUNT(*)) * 100,
    2
  ) as conversion_rate_pct
FROM bucketed_engagement
GROUP BY profile_views_bucket, pdp_views_bucket
ORDER BY profile_views_bucket, pdp_views_bucket;

-- 3. Create materialized view for copy engagement summary
-- Aggregates engagement metrics by copy status from main_analysis
DROP MATERIALIZED VIEW IF EXISTS copy_engagement_summary CASCADE;
CREATE MATERIALIZED VIEW copy_engagement_summary AS
SELECT
  did_copy,
  COUNT(DISTINCT distinct_id) as total_users,
  ROUND(AVG(total_profile_views), 2) as avg_profile_views,
  ROUND(AVG(total_pdp_views), 2) as avg_pdp_views,
  ROUND(AVG(unique_creators_viewed), 2) as avg_unique_creators,
  ROUND(AVG(unique_portfolios_viewed), 2) as avg_unique_portfolios
FROM main_analysis
GROUP BY did_copy;

-- Create indexes on materialized view
CREATE INDEX IF NOT EXISTS idx_copy_engagement_summary_did_copy
ON copy_engagement_summary (did_copy);

-- 4. Create view for top converting portfolio-creator pairs
CREATE OR REPLACE VIEW top_converting_portfolio_creator_copy_pairs AS
SELECT
  portfolio_ticker,
  creator_id,
  creator_username,
  SUM(pdp_view_count + profile_view_count) as total_views,
  COUNT(DISTINCT distinct_id) as unique_viewers,
  SUM(CASE WHEN did_copy THEN 1 ELSE 0 END) as total_copies,
  ROUND(
    (SUM(CASE WHEN did_copy THEN 1 ELSE 0 END)::NUMERIC / COUNT(DISTINCT distinct_id)) * 100,
    2
  ) as conversion_rate_pct
FROM user_portfolio_creator_copies
GROUP BY portfolio_ticker, creator_id, creator_username
HAVING COUNT(DISTINCT distinct_id) >= 5  -- Minimum 5 views to be included
ORDER BY conversion_rate_pct DESC, total_views DESC
LIMIT 10;

-- Grant permissions (adjust as needed for your setup)
-- GRANT SELECT ON user_portfolio_creator_copies TO authenticated;
-- GRANT SELECT ON copy_conversion_by_engagement TO authenticated;
-- GRANT SELECT ON copy_engagement_summary TO authenticated;
-- GRANT SELECT ON top_converting_portfolio_creator_copy_pairs TO authenticated;
