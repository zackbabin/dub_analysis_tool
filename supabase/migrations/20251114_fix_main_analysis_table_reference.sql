-- Fix main_analysis to reference subscribers_insights instead of subscribers_insights_v2
-- Problem: main_analysis view references subscribers_insights_v2 which doesn't exist anymore
-- Solution: Update view to reference subscribers_insights (the correct table name)
-- Date: 2025-11-14

DROP MATERIALIZED VIEW IF EXISTS main_analysis CASCADE;

CREATE MATERIALIZED VIEW main_analysis AS
WITH unique_engagement AS (
  -- Only calculate metrics that aren't in subscribers_insights
  SELECT
    distinct_id,
    COUNT(DISTINCT creator_id) as unique_creators_viewed,
    COUNT(DISTINCT portfolio_ticker) as unique_portfolios_viewed
  FROM user_portfolio_creator_engagement
  GROUP BY distinct_id
)
SELECT
  -- Map all columns directly from subscribers_insights
  si.distinct_id,
  si.income,
  si.net_worth,
  si.investing_activity,
  si.investing_experience_years,
  si.investing_objective,
  si.investment_type,
  si.acquisition_survey,
  si.linked_bank_account,
  si.available_copy_credits,
  si.buying_power,
  si.total_deposits,
  si.total_deposit_count,
  si.total_withdrawals,
  si.total_withdrawal_count,
  si.active_created_portfolios,
  si.lifetime_created_portfolios,
  si.active_copied_portfolios,
  si.lifetime_copied_portfolios,
  si.total_copies,
  si.total_regular_copies,
  si.total_premium_copies,
  si.regular_pdp_views,
  si.premium_pdp_views,
  si.paywall_views,
  si.regular_creator_profile_views,
  si.premium_creator_profile_views,
  si.total_subscriptions,
  si.stripe_modal_views,
  si.app_sessions,
  si.creator_card_taps,
  si.portfolio_card_taps,

  -- Calculate derived metrics from subscribers_insights columns
  (COALESCE(si.regular_creator_profile_views, 0) + COALESCE(si.premium_creator_profile_views, 0)) as total_profile_views,
  (COALESCE(si.regular_pdp_views, 0) + COALESCE(si.premium_pdp_views, 0)) as total_pdp_views,

  -- Add unique engagement metrics from granular tables
  COALESCE(ue.unique_creators_viewed, 0) as unique_creators_viewed,
  COALESCE(ue.unique_portfolios_viewed, 0) as unique_portfolios_viewed,

  -- Boolean flags for filtering
  CASE WHEN si.total_copies > 0 THEN 1 ELSE 0 END as did_copy,
  CASE WHEN si.total_subscriptions > 0 THEN 1 ELSE 0 END as did_subscribe

-- FIXED: Changed from subscribers_insights_v2 to subscribers_insights
FROM subscribers_insights si
LEFT JOIN unique_engagement ue ON si.distinct_id = ue.distinct_id;

-- Create indexes for faster queries on materialized view
CREATE INDEX IF NOT EXISTS idx_main_analysis_distinct_id ON main_analysis (distinct_id);

-- Indexes for filtering and aggregation queries
CREATE INDEX IF NOT EXISTS idx_main_analysis_did_copy ON main_analysis (did_copy);
CREATE INDEX IF NOT EXISTS idx_main_analysis_did_subscribe ON main_analysis (did_subscribe);
CREATE INDEX IF NOT EXISTS idx_main_analysis_total_copies ON main_analysis (total_copies);
CREATE INDEX IF NOT EXISTS idx_main_analysis_total_subscriptions ON main_analysis (total_subscriptions);

-- Refresh the view to populate with data
REFRESH MATERIALIZED VIEW main_analysis;

-- Recreate the refresh function (should already exist but ensure it's correct)
CREATE OR REPLACE FUNCTION refresh_main_analysis()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW main_analysis;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION refresh_main_analysis() TO authenticated, anon, service_role;
GRANT SELECT ON main_analysis TO authenticated, anon, service_role;

-- Verify row count
SELECT COUNT(*) as main_analysis_row_count FROM main_analysis;

COMMENT ON MATERIALIZED VIEW main_analysis IS
'Main analysis view combining user properties from subscribers_insights with engagement metrics. Updated to reference subscribers_insights table.';

-- ==============================================================================
-- RECREATE DEPENDENT VIEWS (dropped by CASCADE)
-- ==============================================================================

-- Recreate copy_engagement_summary (depends on main_analysis)
CREATE MATERIALIZED VIEW copy_engagement_summary AS
SELECT
  did_copy,
  COUNT(DISTINCT distinct_id) AS total_users,
  ROUND(AVG(total_profile_views), 2) AS avg_profile_views,
  ROUND(AVG(total_pdp_views), 2) AS avg_pdp_views,
  ROUND(AVG(unique_creators_viewed), 2) AS avg_unique_creators,
  ROUND(AVG(unique_portfolios_viewed), 2) AS avg_unique_portfolios
FROM main_analysis
GROUP BY did_copy;

-- Recreate subscription_engagement_summary (depends on main_analysis)
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

-- Refresh both engagement summary views to populate with data
REFRESH MATERIALIZED VIEW copy_engagement_summary;
REFRESH MATERIALIZED VIEW subscription_engagement_summary;

-- Recreate refresh functions for engagement summary views
CREATE OR REPLACE FUNCTION refresh_copy_engagement_summary()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW copy_engagement_summary;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_subscription_engagement_summary()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW subscription_engagement_summary;
END;
$$;

-- Grant permissions on engagement summary views
GRANT SELECT ON copy_engagement_summary TO anon, authenticated, service_role;
GRANT SELECT ON subscription_engagement_summary TO anon, authenticated, service_role;

-- Verify engagement summary views have data
SELECT
  'copy_engagement_summary' as view_name,
  COUNT(*) as row_count,
  SUM(total_users) as total_users_across_segments
FROM copy_engagement_summary

UNION ALL

SELECT
  'subscription_engagement_summary' as view_name,
  COUNT(*) as row_count,
  SUM(total_users) as total_users_across_segments
FROM subscription_engagement_summary;

-- Summary
DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ main_analysis fixed and refreshed';
  RAISE NOTICE '✅ copy_engagement_summary recreated and refreshed';
  RAISE NOTICE '✅ subscription_engagement_summary recreated and refreshed';
  RAISE NOTICE 'All views now reference subscribers_insights (not _v2)';
  RAISE NOTICE '========================================';
END $$;
