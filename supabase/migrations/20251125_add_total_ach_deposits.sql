-- Migration: Add total_ach_deposits column
-- Purpose: Track ACH deposits specifically for accurate Deposit Rate calculation
-- Date: 2025-11-25

-- Step 1: Add column to subscribers_insights
ALTER TABLE subscribers_insights 
ADD COLUMN IF NOT EXISTS total_ach_deposits INTEGER DEFAULT 0;

COMMENT ON COLUMN subscribers_insights.total_ach_deposits IS 
'Total ACH deposits made by user (from Mixpanel chart 85713544, field R. Total ACH Deposits)';

-- Step 2: Recreate main_analysis to include total_ach_deposits
DROP MATERIALIZED VIEW IF EXISTS main_analysis CASCADE;

CREATE MATERIALIZED VIEW main_analysis AS
WITH unique_engagement AS (
  -- Calculate unique engagement metrics from engagement table
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
  si.available_copy_credits,
  si.buying_power,
  si.total_deposits,
  si.total_deposit_count,
  si.total_ach_deposits,  -- NEW: Add ACH deposits column
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

-- Create unique index on user_id for main_analysis
CREATE UNIQUE INDEX IF NOT EXISTS idx_main_analysis_user_id ON main_analysis(user_id);

-- Grant permissions
GRANT SELECT ON main_analysis TO authenticated, anon, service_role;

COMMENT ON MATERIALIZED VIEW main_analysis IS
'Main analysis view combining user properties from subscribers_insights with engagement metrics.
Updated to include total_ach_deposits for accurate Deposit Rate calculation.';
