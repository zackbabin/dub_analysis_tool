-- Database schema for portfolio copies analysis
-- Execute these commands in Supabase SQL Editor

-- 1. Create table for user_portfolio_creator_copies (similar to user_portfolio_creator_views)
CREATE TABLE IF NOT EXISTS user_portfolio_creator_copies (
  id BIGSERIAL PRIMARY KEY,
  distinct_id TEXT NOT NULL,
  portfolio_ticker TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  creator_username TEXT,
  pdp_view_count INTEGER NOT NULL DEFAULT 0,
  did_copy BOOLEAN NOT NULL DEFAULT FALSE,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_copy_pairs_distinct_id ON user_portfolio_creator_copies(distinct_id);
CREATE INDEX IF NOT EXISTS idx_copy_pairs_portfolio ON user_portfolio_creator_copies(portfolio_ticker);
CREATE INDEX IF NOT EXISTS idx_copy_pairs_creator ON user_portfolio_creator_copies(creator_id);
CREATE INDEX IF NOT EXISTS idx_copy_pairs_did_copy ON user_portfolio_creator_copies(did_copy);
CREATE INDEX IF NOT EXISTS idx_copy_pairs_synced_at ON user_portfolio_creator_copies(synced_at DESC);

-- 2. Create view for copy conversion analysis by engagement level
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

-- 3. Create view for copy engagement summary
CREATE OR REPLACE VIEW copy_engagement_summary AS
SELECT
  did_copy,
  COUNT(DISTINCT distinct_id) as total_users,
  ROUND(AVG(profile_views), 2) as avg_profile_views,
  ROUND(AVG(pdp_views), 2) as avg_pdp_views,
  ROUND(AVG(unique_creators), 2) as avg_unique_creators,
  ROUND(AVG(unique_portfolios), 2) as avg_unique_portfolios
FROM (
  SELECT
    distinct_id,
    did_copy,
    COUNT(DISTINCT creator_id) as profile_views,
    SUM(pdp_view_count) as pdp_views,
    COUNT(DISTINCT creator_id) as unique_creators,
    COUNT(DISTINCT portfolio_ticker) as unique_portfolios
  FROM user_portfolio_creator_copies
  GROUP BY distinct_id, did_copy
) user_stats
GROUP BY did_copy;

-- 4. Create view for top converting portfolio-creator pairs
CREATE OR REPLACE VIEW top_converting_portfolio_creator_copy_pairs AS
SELECT
  portfolio_ticker,
  creator_id,
  creator_username,
  COUNT(DISTINCT distinct_id) as total_views,
  SUM(CASE WHEN did_copy THEN 1 ELSE 0 END) as copiers,
  ROUND(
    (SUM(CASE WHEN did_copy THEN 1 ELSE 0 END)::NUMERIC / COUNT(DISTINCT distinct_id)) * 100,
    2
  ) as conversion_rate_pct
FROM user_portfolio_creator_copies
GROUP BY portfolio_ticker, creator_id, creator_username
HAVING COUNT(DISTINCT distinct_id) >= 5  -- Minimum 5 views to be included
ORDER BY conversion_rate_pct DESC, total_views DESC
LIMIT 100;

-- Grant permissions (adjust as needed for your setup)
-- GRANT SELECT ON user_portfolio_creator_copies TO authenticated;
-- GRANT SELECT ON copy_conversion_by_engagement TO authenticated;
-- GRANT SELECT ON copy_engagement_summary TO authenticated;
-- GRANT SELECT ON top_converting_portfolio_creator_copy_pairs TO authenticated;
