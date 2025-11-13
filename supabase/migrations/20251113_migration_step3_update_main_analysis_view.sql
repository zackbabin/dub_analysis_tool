-- Migration Step 3: Update main_analysis View
-- Changes source table from subscribers_insights to subscribers_insights_v2
-- Removes references to dropped columns (discover_tab_views, leaderboard_tab_views, premium_tab_views)

DROP MATERIALIZED VIEW IF EXISTS main_analysis CASCADE;

CREATE MATERIALIZED VIEW main_analysis AS
WITH unique_engagement AS (
  -- Only calculate metrics that aren't in subscribers_insights_v2
  SELECT
    distinct_id,
    COUNT(DISTINCT creator_id) as unique_creators_viewed,
    COUNT(DISTINCT portfolio_ticker) as unique_portfolios_viewed
  FROM user_portfolio_creator_engagement
  GROUP BY distinct_id
)
SELECT
  -- Map all columns directly from subscribers_insights_v2
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

  -- Calculate derived metrics from subscribers_insights_v2 columns
  (COALESCE(si.regular_creator_profile_views, 0) + COALESCE(si.premium_creator_profile_views, 0)) as total_profile_views,
  (COALESCE(si.regular_pdp_views, 0) + COALESCE(si.premium_pdp_views, 0)) as total_pdp_views,

  -- Add unique engagement metrics from granular tables
  COALESCE(ue.unique_creators_viewed, 0) as unique_creators_viewed,
  COALESCE(ue.unique_portfolios_viewed, 0) as unique_portfolios_viewed,

  -- Boolean flags for filtering
  CASE WHEN si.total_copies > 0 THEN 1 ELSE 0 END as did_copy,
  CASE WHEN si.total_subscriptions > 0 THEN 1 ELSE 0 END as did_subscribe

-- CHANGED: Source table from subscribers_insights to subscribers_insights_v2
FROM subscribers_insights_v2 si
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

-- Create function to refresh main_analysis (if not exists)
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
