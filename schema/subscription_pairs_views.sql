-- Subscription Engagement Analysis Views
-- These views analyze user engagement with portfolio-creator pairs and subscription conversions

-- Materialized View: subscription_engagement_summary
-- Aggregates engagement metrics by subscription status
-- Refresh this after syncing new data: REFRESH MATERIALIZED VIEW subscription_engagement_summary;
DROP MATERIALIZED VIEW IF EXISTS subscription_engagement_summary CASCADE;
CREATE MATERIALIZED VIEW subscription_engagement_summary AS
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
    SUM(pdp_view_count + profile_view_count) as pdp_views,
    COUNT(DISTINCT creator_id) as unique_creators,
    COUNT(DISTINCT portfolio_ticker) as unique_portfolios,
    SUM(profile_view_count) as profile_views
  FROM user_portfolio_creator_views
  GROUP BY distinct_id, did_subscribe
) user_engagement
GROUP BY did_subscribe;

-- Grant permissions (adjust as needed for your setup)
GRANT SELECT ON subscription_engagement_summary TO authenticated, anon;

-- Note: top_converting_portfolio_creator_pairs view has been replaced with
-- logistic regression analysis in conversion_pattern_combinations table
-- Use analyze-subscription-patterns edge function to populate results
