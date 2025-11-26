-- Migration: Fix main_analysis to properly join on user_id
-- Created: 2025-11-26
-- Purpose: Fix unique_engagement CTE and join to use user_id instead of distinct_id
--
-- Issue: user_portfolio_creator_engagement was renamed to use user_id, but
-- the schema file still referenced distinct_id causing join failures

DROP MATERIALIZED VIEW IF EXISTS main_analysis CASCADE;

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
  -- Use user_id as primary identifier
  si.user_id,
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
  si.discover_tab_views,
  si.leaderboard_tab_views,
  si.premium_tab_views,
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
FROM subscribers_insights si
LEFT JOIN unique_engagement ue ON si.user_id = ue.user_id;

-- Create indexes for faster queries on materialized view
CREATE UNIQUE INDEX IF NOT EXISTS idx_main_analysis_user_id ON main_analysis (user_id);

-- Indexes for filtering and aggregation queries
CREATE INDEX IF NOT EXISTS idx_main_analysis_did_copy ON main_analysis (did_copy);
CREATE INDEX IF NOT EXISTS idx_main_analysis_did_subscribe ON main_analysis (did_subscribe);

-- Grant permissions
GRANT SELECT ON main_analysis TO authenticated, anon, service_role;

-- Log the changes
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Fixed main_analysis to use user_id for joins';
  RAISE NOTICE '   - unique_engagement CTE now groups by user_id';
  RAISE NOTICE '   - Join between subscribers_insights and unique_engagement uses user_id';
  RAISE NOTICE '';
END $$;
