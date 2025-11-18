-- Remove unused columns from subscribers_insights table
-- These columns are not in the new Mixpanel user property mapping

-- Step 1: Drop dependent views (CASCADE will handle transitive dependencies)
DROP VIEW IF EXISTS subscribers_insights_compat CASCADE;
DROP MATERIALIZED VIEW IF EXISTS main_analysis CASCADE;

-- Step 2: Drop columns that are no longer synced from Mixpanel user properties
ALTER TABLE subscribers_insights
DROP COLUMN IF EXISTS total_withdrawals,
DROP COLUMN IF EXISTS total_withdrawal_count,
DROP COLUMN IF EXISTS linked_bank_account;

-- Step 3: Recreate subscribers_insights_compat view (without dropped columns)
CREATE VIEW subscribers_insights_compat AS
SELECT
  distinct_id,
  income,
  net_worth,
  investing_activity,
  investing_experience_years,
  investing_objective,
  investment_type,
  acquisition_survey,
  available_copy_credits,
  buying_power,
  total_deposits,
  total_deposit_count,
  active_created_portfolios,
  lifetime_created_portfolios,
  active_copied_portfolios,
  lifetime_copied_portfolios,
  total_copies,
  total_regular_copies,
  total_premium_copies,
  regular_pdp_views,
  premium_pdp_views,
  paywall_views,
  regular_creator_views,
  premium_creator_views,
  total_subscriptions,
  stripe_modal_views,
  app_sessions,
  creator_card_taps,
  portfolio_card_taps,
  total_bank_links,
  discover_tab_views,
  leaderboard_tab_views,
  premium_tab_views,
  updated_at

FROM subscribers_insights;

GRANT SELECT ON subscribers_insights_compat TO authenticated, anon, service_role;

COMMENT ON VIEW subscribers_insights_compat IS
'Compatibility view for subscribers_insights. Provides backward compatibility after column removal.';

-- Step 4: Recreate main_analysis materialized view (without dropped columns)
CREATE MATERIALIZED VIEW main_analysis AS
WITH unique_engagement AS (
  -- Calculate unique engagement metrics
  SELECT
    distinct_id,
    COUNT(DISTINCT creator_id) as unique_creators_viewed,
    COUNT(DISTINCT portfolio_ticker) as unique_portfolios_viewed
  FROM user_portfolio_creator_engagement
  GROUP BY distinct_id
)
SELECT
  -- Map all columns directly from subscribers_insights (excluding dropped columns)
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
  si.total_deposit_count,
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
LEFT JOIN unique_engagement ue ON si.distinct_id = ue.distinct_id;

-- Create unique index on distinct_id for main_analysis
CREATE UNIQUE INDEX IF NOT EXISTS idx_main_analysis_distinct_id ON main_analysis(distinct_id);

-- Step 5: Recreate copy_engagement_summary (depends on main_analysis)
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

-- Create index on copy_engagement_summary
CREATE INDEX IF NOT EXISTS idx_copy_engagement_summary_did_copy ON copy_engagement_summary(did_copy);

-- Add comment explaining the schema change
COMMENT ON TABLE subscribers_insights IS
'User properties synced from Mixpanel Engage API. Schema updated 2025-11-17 to match new property mapping.';
