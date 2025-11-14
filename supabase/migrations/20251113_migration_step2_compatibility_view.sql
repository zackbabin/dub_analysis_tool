-- Migration Step 2: Create Compatibility View
-- This view wraps subscribers_insights_v2 and adds dummy columns for dropped columns
-- Allows old code to work during transition period

-- Drop if exists
DROP VIEW IF EXISTS subscribers_insights_compat CASCADE;

-- Create compatibility view
CREATE VIEW subscribers_insights_compat AS
SELECT
  -- All existing columns from v2 (note: v2 doesn't have 'id', uses distinct_id as PK)
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

  -- Add dummy columns for removed tab views (set to 0 for compatibility)
  0::integer as discover_tab_views,
  0::integer as leaderboard_tab_views,
  0::integer as premium_tab_views

FROM subscribers_insights_v2;

-- Grant permissions
GRANT SELECT ON subscribers_insights_compat TO authenticated, anon, service_role;

-- Add comment
COMMENT ON VIEW subscribers_insights_compat IS
'Compatibility view for subscribers_insights_v2. Adds dummy columns for removed tab views.
This view ensures old code continues to work during migration period.
After migration is complete and all references are updated, this view can be dropped.';
