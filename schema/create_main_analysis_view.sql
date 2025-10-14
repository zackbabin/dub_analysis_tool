-- Create or update main_analysis view to include time funnel data
-- This view joins user engagement data with time-to-conversion metrics
-- Execute this in Supabase SQL Editor

DROP MATERIALIZED VIEW IF EXISTS main_analysis CASCADE;

CREATE MATERIALIZED VIEW main_analysis AS
WITH copy_engagement AS (
  SELECT
    distinct_id,
    SUM(profile_view_count) as total_profile_views_calc,
    SUM(pdp_view_count) as total_pdp_views_calc,
    COUNT(DISTINCT creator_id) as unique_creators_viewed,
    COUNT(DISTINCT portfolio_ticker) as unique_portfolios_viewed,
    SUM(CASE WHEN did_copy THEN 1 ELSE 0 END) as total_copies_calc,
    MAX(CASE WHEN did_copy THEN 1 ELSE 0 END) as did_copy
  FROM user_portfolio_creator_engagement
  WHERE did_copy = true
  GROUP BY distinct_id
),
subscription_engagement AS (
  SELECT
    distinct_id,
    SUM(CASE WHEN did_subscribe THEN 1 ELSE 0 END) as total_subscriptions_calc,
    MAX(CASE WHEN did_subscribe THEN 1 ELSE 0 END) as did_subscribe
  FROM user_portfolio_creator_engagement
  WHERE did_subscribe = true
  GROUP BY distinct_id
),
time_metrics AS (
  SELECT
    distinct_id,
    MAX(CASE WHEN funnel_type = 'time_to_first_copy' THEN time_in_days END) as time_to_first_copy_days,
    MAX(CASE WHEN funnel_type = 'time_to_linked_bank' THEN time_in_days END) as time_to_linked_bank_days,
    MAX(CASE WHEN funnel_type = 'time_to_funded_account' THEN time_in_days END) as time_to_funded_account_days
  FROM time_funnels
  GROUP BY distinct_id
)
SELECT
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
  COALESCE(ce.total_copies_calc, si.total_copies, 0) as total_copies,
  si.total_regular_copies,
  si.total_premium_copies,
  si.regular_pdp_views,
  si.premium_pdp_views,
  si.paywall_views,
  si.regular_creator_profile_views,
  si.premium_creator_profile_views,
  COALESCE(se.total_subscriptions_calc, si.total_subscriptions, 0) as total_subscriptions,
  si.stripe_modal_views,
  si.app_sessions,
  si.discover_tab_views,
  si.leaderboard_tab_views,
  si.premium_tab_views,
  si.creator_card_taps,
  si.portfolio_card_taps,
  si.subscribed_within_7_days,
  COALESCE(ce.total_profile_views_calc, 0) as total_profile_views,
  COALESCE(ce.total_pdp_views_calc, 0) as total_pdp_views,
  COALESCE(ce.unique_creators_viewed, 0) as unique_creators_viewed,
  COALESCE(ce.unique_portfolios_viewed, 0) as unique_portfolios_viewed,
  COALESCE(ce.did_copy, 0) as did_copy,
  COALESCE(se.did_subscribe, 0) as did_subscribe,
  tm.time_to_first_copy_days,
  tm.time_to_linked_bank_days,
  tm.time_to_funded_account_days
FROM subscribers_insights si
LEFT JOIN copy_engagement ce ON si.distinct_id = ce.distinct_id
LEFT JOIN subscription_engagement se ON si.distinct_id = se.distinct_id
LEFT JOIN time_metrics tm ON si.distinct_id = tm.distinct_id;

-- Create indexes for faster queries on materialized view
CREATE INDEX IF NOT EXISTS idx_main_analysis_distinct_id ON main_analysis (distinct_id);

-- Indexes for filtering and aggregation queries
CREATE INDEX IF NOT EXISTS idx_main_analysis_did_copy ON main_analysis (did_copy);
CREATE INDEX IF NOT EXISTS idx_main_analysis_did_subscribe ON main_analysis (did_subscribe);
CREATE INDEX IF NOT EXISTS idx_main_analysis_total_copies ON main_analysis (total_copies);
CREATE INDEX IF NOT EXISTS idx_main_analysis_total_subscriptions ON main_analysis (total_subscriptions);

-- Indexes for time funnel analysis
CREATE INDEX IF NOT EXISTS idx_main_analysis_time_to_first_copy ON main_analysis (time_to_first_copy_days) WHERE time_to_first_copy_days IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_main_analysis_time_to_linked_bank ON main_analysis (time_to_linked_bank_days) WHERE time_to_linked_bank_days IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_main_analysis_time_to_funded ON main_analysis (time_to_funded_account_days) WHERE time_to_funded_account_days IS NOT NULL;

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
