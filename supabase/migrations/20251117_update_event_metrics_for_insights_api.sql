-- Update event metric columns to match Insights API chart 85713544
-- This migration prepares subscribers_insights table for Insights API sync

-- Step 0: Drop dependent view before making column changes
DROP VIEW IF EXISTS subscribers_insights_compat;

-- Step 1: Add missing columns from CSV mapping
ALTER TABLE subscribers_insights
ADD COLUMN IF NOT EXISTS total_bank_links INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS discover_tab_views INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS leaderboard_tab_views INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS premium_tab_views INTEGER DEFAULT 0;

-- Step 2: Rename columns to match new mapping
-- regular_creator_profile_views → regular_creator_views
-- premium_creator_profile_views → premium_creator_views
ALTER TABLE subscribers_insights
RENAME COLUMN regular_creator_profile_views TO regular_creator_views;

ALTER TABLE subscribers_insights
RENAME COLUMN premium_creator_profile_views TO premium_creator_views;

-- Step 3: Remove columns not in the CSV mapping (keeping user properties)
-- Columns to remove: total_ach_transfers, data_source, events_processed
ALTER TABLE subscribers_insights
DROP COLUMN IF EXISTS total_ach_transfers,
DROP COLUMN IF EXISTS data_source,
DROP COLUMN IF EXISTS events_processed;

-- Step 3.5: Recreate subscribers_insights_compat view with updated columns
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
'Compatibility view for subscribers_insights. Provides backward compatibility after Insights API migration.';

-- Step 4: Add comments explaining the schema change
COMMENT ON TABLE subscribers_insights IS
'User event metrics synced from Mixpanel Insights API chart 85713544. User properties synced from Mixpanel Engage API. Schema updated 2025-11-17 to use Insights API for event metrics.';

COMMENT ON COLUMN subscribers_insights.total_bank_links IS
'Total bank account links (from Mixpanel Insights API - A. Total Bank Links)';

COMMENT ON COLUMN subscribers_insights.regular_creator_views IS
'Regular creator profile views (renamed from regular_creator_profile_views - H. Regular Creator Profile Views)';

COMMENT ON COLUMN subscribers_insights.premium_creator_views IS
'Premium creator profile views (renamed from premium_creator_profile_views - I. Premium Creator Profile Views)';

COMMENT ON COLUMN subscribers_insights.discover_tab_views IS
'Discover tab views (from Mixpanel Insights API - L. Discover Tab Views)';

COMMENT ON COLUMN subscribers_insights.leaderboard_tab_views IS
'Leaderboard tab views (from Mixpanel Insights API - M. Leaderboard Tab Views)';

COMMENT ON COLUMN subscribers_insights.premium_tab_views IS
'Premium tab views (from Mixpanel Insights API - N. Premium Tab Views)';
