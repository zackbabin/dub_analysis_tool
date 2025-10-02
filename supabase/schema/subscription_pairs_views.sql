-- Subscription Engagement Analysis Views
-- These views analyze user engagement with portfolio-creator pairs and subscription conversions

-- View: subscription_engagement_summary
-- Aggregates engagement metrics by subscription status
CREATE OR REPLACE VIEW subscription_engagement_summary AS
SELECT
  did_subscribe,
  COUNT(DISTINCT distinct_id) as total_users,
  ROUND(AVG(profile_views), 2) as avg_profile_views,
  ROUND(AVG(pdp_views), 2) as avg_pdp_views,
  ROUND(AVG(unique_creators), 2) as avg_unique_creators,
  ROUND(AVG(unique_portfolios), 2) as avg_unique_portfolios
FROM (
  SELECT
    distinct_id,
    did_subscribe,
    SUM(pdp_view_count) as pdp_views,
    COUNT(DISTINCT creator_id) as unique_creators,
    COUNT(DISTINCT portfolio_ticker) as unique_portfolios,
    0 as profile_views  -- Placeholder, will be updated if profile view data is available
  FROM user_portfolio_creator_views
  GROUP BY distinct_id, did_subscribe
) user_engagement
GROUP BY did_subscribe;

-- View: top_converting_portfolio_creator_pairs
-- Shows top portfolio-creator combinations by subscription conversion rate
CREATE OR REPLACE VIEW top_converting_portfolio_creator_pairs AS
SELECT
  portfolio_ticker,
  creator_id,
  creator_username,
  SUM(pdp_view_count + profile_view_count) as total_views,
  COUNT(DISTINCT distinct_id) as unique_viewers,
  SUM(CASE WHEN did_subscribe THEN 1 ELSE 0 END) as subscribers,
  ROUND(
    (SUM(CASE WHEN did_subscribe THEN 1 ELSE 0 END)::NUMERIC / COUNT(DISTINCT distinct_id)) * 100,
    2
  ) as conversion_rate_pct
FROM user_portfolio_creator_views
GROUP BY portfolio_ticker, creator_id, creator_username
HAVING COUNT(DISTINCT distinct_id) >= 5  -- Minimum 5 views to be included
ORDER BY conversion_rate_pct DESC, total_views DESC
LIMIT 100;

-- Grant permissions (adjust as needed for your setup)
GRANT SELECT ON subscription_engagement_summary TO authenticated, anon;
GRANT SELECT ON top_converting_portfolio_creator_pairs TO authenticated, anon;
