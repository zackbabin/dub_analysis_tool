-- Create or update main_analysis view (SIMPLIFIED)
-- This view maps all columns from subscribers_insights and calculates derived metrics
-- All base metrics are already aggregated in subscribers_insights by the sync process
-- Execute this in Supabase SQL Editor

DROP MATERIALIZED VIEW IF EXISTS main_analysis CASCADE;

CREATE MATERIALIZED VIEW main_analysis AS
WITH unique_engagement AS (
  -- Only calculate metrics that aren't in subscribers_insights
  SELECT
    user_id,
    COUNT(DISTINCT creator_id) as unique_creators_viewed,
    COUNT(DISTINCT portfolio_ticker) as unique_portfolios_viewed
  FROM user_portfolio_creator_engagement
  GROUP BY user_id
)
SELECT
  -- Include BOTH user_id (primary) and distinct_id (for Engage API compatibility)
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
  si.total_ach_deposits,
  si.active_created_portfolios,
  si.lifetime_created_portfolios,
  si.total_copies,
  si.total_regular_copies,
  si.total_premium_copies,
  si.lifetime_copied_portfolios,
  si.active_copied_portfolios,
  si.regular_pdp_views,
  si.premium_pdp_views,
  si.paywall_views,
  si.regular_creator_views,
  si.premium_creator_views,
  si.total_subscriptions,
  si.stripe_modal_views,
  si.app_sessions,
  si.discover_tab_views,
  si.leaderboard_tab_views,
  si.premium_tab_views,
  si.creator_card_taps,
  si.portfolio_card_taps,
  si.total_bank_links,
  -- Calculate derived metrics from subscribers_insights columns
  (COALESCE(si.regular_creator_views, 0) + COALESCE(si.premium_creator_views, 0)) as total_profile_views,
  (COALESCE(si.regular_pdp_views, 0) + COALESCE(si.premium_pdp_views, 0)) as total_pdp_views,
  -- Add unique engagement metrics from granular tables
  COALESCE(ue.unique_creators_viewed, 0) as unique_creators_viewed,
  COALESCE(ue.unique_portfolios_viewed, 0) as unique_portfolios_viewed,
  -- Boolean flags for filtering
  CASE WHEN si.total_copies > 0 THEN 1 ELSE 0 END as did_copy,
  CASE WHEN si.total_subscriptions > 0 THEN 1 ELSE 0 END as did_subscribe,
  CASE WHEN si.total_ach_deposits > 0 THEN 1 ELSE 0 END as did_deposit
FROM subscribers_insights si
LEFT JOIN unique_engagement ue ON si.user_id = ue.user_id;

-- Create indexes for faster queries on materialized view
CREATE UNIQUE INDEX IF NOT EXISTS idx_main_analysis_user_id ON main_analysis (user_id);

-- Create index on distinct_id for Engage API compatibility
CREATE INDEX IF NOT EXISTS idx_main_analysis_distinct_id ON main_analysis (distinct_id);

-- Indexes for filtering and aggregation queries
CREATE INDEX IF NOT EXISTS idx_main_analysis_did_copy ON main_analysis (did_copy);
CREATE INDEX IF NOT EXISTS idx_main_analysis_did_subscribe ON main_analysis (did_subscribe);
CREATE INDEX IF NOT EXISTS idx_main_analysis_did_deposit ON main_analysis (did_deposit);
CREATE INDEX IF NOT EXISTS idx_main_analysis_total_copies ON main_analysis (total_copies);
CREATE INDEX IF NOT EXISTS idx_main_analysis_total_subscriptions ON main_analysis (total_subscriptions);

-- Create function to refresh main_analysis
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
