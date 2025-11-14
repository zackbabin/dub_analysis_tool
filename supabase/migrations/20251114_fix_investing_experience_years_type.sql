-- Fix investing_experience_years column type
-- Change from int4 to text to support Mixpanel string ranges like "3–5", "<1", "10+"

-- Step 1: Drop the compatibility view that depends on this column
DROP VIEW IF EXISTS subscribers_insights_compat;

-- Step 2: Alter the column type
ALTER TABLE subscribers_insights_v2
ALTER COLUMN investing_experience_years TYPE text
USING investing_experience_years::text;

COMMENT ON COLUMN subscribers_insights_v2.investing_experience_years IS
'Years of investing experience from Mixpanel. Stored as text to support ranges like "3–5", "<1", "10+"';

-- Step 3: Recreate the compatibility view with updated column type
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
  linked_bank_account,
  available_copy_credits,
  buying_power,
  total_deposits,
  total_deposit_count,
  total_withdrawals,
  total_withdrawal_count,
  active_created_portfolios,
  lifetime_created_portfolios,
  total_copies,
  total_regular_copies,
  total_premium_copies,
  regular_pdp_views,
  premium_pdp_views,
  paywall_views,
  regular_creator_profile_views,
  premium_creator_profile_views,
  total_subscriptions,
  stripe_modal_views,
  app_sessions,
  creator_card_taps,
  portfolio_card_taps,
  total_ach_transfers,
  updated_at,

  -- Add dummy columns for removed tab views
  0::integer as discover_tab_views,
  0::integer as leaderboard_tab_views,
  0::integer as premium_tab_views

FROM subscribers_insights_v2;

GRANT SELECT ON subscribers_insights_compat TO authenticated, anon, service_role;

COMMENT ON VIEW subscribers_insights_compat IS
'Compatibility view for subscribers_insights_v2. Adds dummy columns for removed tab views.
This view ensures old code continues to work during migration period.
After migration is complete and all references are updated, this view can be dropped.';
