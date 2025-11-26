-- Migration: Remove total_deposit_count column from subscribers_insights table
-- This field is no longer needed and is being removed from Mixpanel Engage API requests

-- Step 1: Drop dependent views CASCADE (will drop copy_engagement_summary and subscription_engagement_summary)
DROP MATERIALIZED VIEW IF EXISTS main_analysis CASCADE;

-- Step 2: Recreate main_analysis WITHOUT total_deposit_count
CREATE MATERIALIZED VIEW main_analysis AS
WITH unique_engagement AS (
  -- Calculate unique engagement metrics from engagement table (uses user_id)
  SELECT
    user_id,
    COUNT(DISTINCT creator_id) as unique_creators_viewed,
    COUNT(DISTINCT portfolio_ticker) as unique_portfolios_viewed
  FROM user_portfolio_creator_engagement
  GROUP BY user_id
)
SELECT
  -- Include BOTH user_id and distinct_id from subscribers_insights
  si.user_id,
  si.distinct_id,
  si.income,
  si.net_worth,
  si.investing_activity,
  si.investing_experience_years,
  si.investing_objective,
  si.investment_type,
  si.acquisition_survey,
  si.available_copy_credits,
  si.buying_power,
  si.total_deposits,
  -- REMOVED: si.total_deposit_count
  si.active_created_portfolios,
  si.lifetime_created_portfolios,
  si.total_copies,
  si.total_regular_copies,
  si.total_premium_copies,
  si.regular_pdp_views,
  si.premium_pdp_views,
  si.paywall_views,
  si.regular_creator_views,
  si.premium_creator_views,
  si.total_subscriptions,
  si.stripe_modal_views,
  si.app_sessions,
  si.creator_card_taps,
  si.portfolio_card_taps,
  si.total_bank_links,
  si.discover_tab_views,
  si.leaderboard_tab_views,
  si.premium_tab_views,
  si.total_ach_deposits,

  -- Calculate derived metrics
  (COALESCE(si.regular_creator_views, 0) + COALESCE(si.premium_creator_views, 0)) as total_profile_views,
  (COALESCE(si.regular_pdp_views, 0) + COALESCE(si.premium_pdp_views, 0)) as total_pdp_views,

  -- Add unique engagement metrics from granular tables
  COALESCE(ue.unique_creators_viewed, 0) as unique_creators_viewed,
  COALESCE(ue.unique_portfolios_viewed, 0) as unique_portfolios_viewed,

  -- Boolean flags
  CASE WHEN si.total_copies > 0 THEN 1 ELSE 0 END as did_copy,
  CASE WHEN si.total_subscriptions > 0 THEN 1 ELSE 0 END as did_subscribe

FROM subscribers_insights si
LEFT JOIN unique_engagement ue ON si.user_id = ue.user_id;

-- Create unique index on user_id (primary key for main_analysis)
CREATE UNIQUE INDEX IF NOT EXISTS idx_main_analysis_user_id ON main_analysis(user_id);

-- Create index on distinct_id for Engage API compatibility
CREATE INDEX IF NOT EXISTS idx_main_analysis_distinct_id ON main_analysis(distinct_id);

-- Grant permissions
GRANT SELECT ON main_analysis TO authenticated, anon, service_role;

COMMENT ON MATERIALIZED VIEW main_analysis IS
'Main analysis view combining user properties from subscribers_insights with engagement metrics.
Includes both user_id (primary) and distinct_id (for Engage API compatibility).
Updated 2025-11-26 to remove total_deposit_count column.';

-- Step 3: Recreate copy_engagement_summary (was dropped by CASCADE)
CREATE MATERIALIZED VIEW copy_engagement_summary AS
SELECT
  did_copy,
  COUNT(DISTINCT distinct_id) AS total_users,
  ROUND(AVG(total_profile_views), 2) AS avg_profile_views,
  ROUND(AVG(total_pdp_views), 2) AS avg_pdp_views,
  ROUND(AVG(unique_creators_viewed), 2) AS avg_unique_creators,
  ROUND(AVG(unique_portfolios_viewed), 2) AS avg_unique_portfolios,
  -- Add event sequence metrics if available
  (SELECT mean_unique_portfolios FROM event_sequence_metrics LIMIT 1) AS mean_unique_portfolios,
  (SELECT median_unique_portfolios FROM event_sequence_metrics LIMIT 1) AS median_unique_portfolios
FROM main_analysis
GROUP BY did_copy;

GRANT SELECT ON copy_engagement_summary TO anon, authenticated, service_role;

-- Step 4: Recreate subscription_engagement_summary (was dropped by CASCADE)
CREATE MATERIALIZED VIEW subscription_engagement_summary AS
SELECT
  did_subscribe,
  COUNT(DISTINCT distinct_id) AS total_users,
  ROUND(AVG(total_profile_views), 2) AS avg_profile_views,
  ROUND(AVG(total_pdp_views), 2) AS avg_pdp_views,
  ROUND(AVG(unique_creators_viewed), 2) AS avg_unique_creators,
  ROUND(AVG(unique_portfolios_viewed), 2) AS avg_unique_portfolios
FROM main_analysis
GROUP BY did_subscribe;

GRANT SELECT ON subscription_engagement_summary TO anon, authenticated, service_role;

-- Step 5: Recreate refresh functions
CREATE OR REPLACE FUNCTION refresh_copy_engagement_summary()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW copy_engagement_summary;
  RAISE NOTICE '✅ Refreshed copy_engagement_summary';
END;
$$;

CREATE OR REPLACE FUNCTION refresh_subscription_engagement_summary()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW subscription_engagement_summary;
  RAISE NOTICE '✅ Refreshed subscription_engagement_summary';
END;
$$;

-- Step 6: Now safe to drop the column from subscribers_insights
ALTER TABLE subscribers_insights DROP COLUMN IF EXISTS total_deposit_count;

-- Step 7: Refresh all materialized views with data
REFRESH MATERIALIZED VIEW main_analysis;
REFRESH MATERIALIZED VIEW copy_engagement_summary;
REFRESH MATERIALIZED VIEW subscription_engagement_summary;

-- Log completion
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Successfully removed total_deposit_count';
  RAISE NOTICE '   - Dropped column from subscribers_insights table';
  RAISE NOTICE '   - Recreated main_analysis without total_deposit_count';
  RAISE NOTICE '   - Recreated copy_engagement_summary';
  RAISE NOTICE '   - Recreated subscription_engagement_summary';
  RAISE NOTICE '   - All materialized views refreshed with data';
  RAISE NOTICE '';
END $$;
