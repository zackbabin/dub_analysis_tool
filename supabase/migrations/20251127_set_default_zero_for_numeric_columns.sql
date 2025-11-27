-- Migration: Set DEFAULT 0 for all numeric and integer columns in subscribers_insights
-- Created: 2025-11-27
-- Purpose: Ensure NULL values are never stored for numeric/integer columns
--
-- Background:
-- - Numeric and integer columns should default to 0 instead of NULL
-- - This prevents NULL-related issues in aggregations and calculations
-- - Applies to all event count and metric columns

-- Set defaults for numeric columns
ALTER TABLE subscribers_insights ALTER COLUMN available_copy_credits SET DEFAULT 0;
ALTER TABLE subscribers_insights ALTER COLUMN buying_power SET DEFAULT 0;
ALTER TABLE subscribers_insights ALTER COLUMN total_deposits SET DEFAULT 0;
ALTER TABLE subscribers_insights ALTER COLUMN total_withdrawals SET DEFAULT 0;

-- Set defaults for integer columns
ALTER TABLE subscribers_insights ALTER COLUMN active_created_portfolios SET DEFAULT 0;
ALTER TABLE subscribers_insights ALTER COLUMN lifetime_created_portfolios SET DEFAULT 0;
ALTER TABLE subscribers_insights ALTER COLUMN total_copies SET DEFAULT 0;
ALTER TABLE subscribers_insights ALTER COLUMN total_regular_copies SET DEFAULT 0;
ALTER TABLE subscribers_insights ALTER COLUMN total_premium_copies SET DEFAULT 0;
ALTER TABLE subscribers_insights ALTER COLUMN regular_pdp_views SET DEFAULT 0;
ALTER TABLE subscribers_insights ALTER COLUMN premium_pdp_views SET DEFAULT 0;
ALTER TABLE subscribers_insights ALTER COLUMN paywall_views SET DEFAULT 0;
ALTER TABLE subscribers_insights ALTER COLUMN regular_creator_views SET DEFAULT 0;
ALTER TABLE subscribers_insights ALTER COLUMN premium_creator_views SET DEFAULT 0;
ALTER TABLE subscribers_insights ALTER COLUMN stripe_modal_views SET DEFAULT 0;
ALTER TABLE subscribers_insights ALTER COLUMN app_sessions SET DEFAULT 0;
ALTER TABLE subscribers_insights ALTER COLUMN discover_tab_views SET DEFAULT 0;
ALTER TABLE subscribers_insights ALTER COLUMN leaderboard_tab_views SET DEFAULT 0;
ALTER TABLE subscribers_insights ALTER COLUMN premium_tab_views SET DEFAULT 0;
ALTER TABLE subscribers_insights ALTER COLUMN creator_card_taps SET DEFAULT 0;
ALTER TABLE subscribers_insights ALTER COLUMN portfolio_card_taps SET DEFAULT 0;
ALTER TABLE subscribers_insights ALTER COLUMN total_subscriptions SET DEFAULT 0;
ALTER TABLE subscribers_insights ALTER COLUMN total_bank_links SET DEFAULT 0;
ALTER TABLE subscribers_insights ALTER COLUMN total_ach_deposits SET DEFAULT 0;
ALTER TABLE subscribers_insights ALTER COLUMN lifetime_copied_portfolios SET DEFAULT 0;
ALTER TABLE subscribers_insights ALTER COLUMN active_copied_portfolios SET DEFAULT 0;

-- Update existing NULL values to 0 for numeric columns
UPDATE subscribers_insights
SET
  available_copy_credits = COALESCE(available_copy_credits, 0),
  buying_power = COALESCE(buying_power, 0),
  total_deposits = COALESCE(total_deposits, 0),
  total_withdrawals = COALESCE(total_withdrawals, 0);

-- Update existing NULL values to 0 for integer columns
UPDATE subscribers_insights
SET
  active_created_portfolios = COALESCE(active_created_portfolios, 0),
  lifetime_created_portfolios = COALESCE(lifetime_created_portfolios, 0),
  total_copies = COALESCE(total_copies, 0),
  total_regular_copies = COALESCE(total_regular_copies, 0),
  total_premium_copies = COALESCE(total_premium_copies, 0),
  regular_pdp_views = COALESCE(regular_pdp_views, 0),
  premium_pdp_views = COALESCE(premium_pdp_views, 0),
  paywall_views = COALESCE(paywall_views, 0),
  regular_creator_views = COALESCE(regular_creator_views, 0),
  premium_creator_views = COALESCE(premium_creator_views, 0),
  stripe_modal_views = COALESCE(stripe_modal_views, 0),
  app_sessions = COALESCE(app_sessions, 0),
  discover_tab_views = COALESCE(discover_tab_views, 0),
  leaderboard_tab_views = COALESCE(leaderboard_tab_views, 0),
  premium_tab_views = COALESCE(premium_tab_views, 0),
  creator_card_taps = COALESCE(creator_card_taps, 0),
  portfolio_card_taps = COALESCE(portfolio_card_taps, 0),
  total_subscriptions = COALESCE(total_subscriptions, 0),
  total_bank_links = COALESCE(total_bank_links, 0),
  total_ach_deposits = COALESCE(total_ach_deposits, 0),
  lifetime_copied_portfolios = COALESCE(lifetime_copied_portfolios, 0),
  active_copied_portfolios = COALESCE(active_copied_portfolios, 0);

-- Log the changes
DO $$
DECLARE
  updated_count INTEGER;
BEGIN
  GET DIAGNOSTICS updated_count = ROW_COUNT;

  RAISE NOTICE '';
  RAISE NOTICE '✅ Set DEFAULT 0 for all numeric and integer columns';
  RAISE NOTICE '   - Updated % existing rows with NULL values to 0', updated_count;
  RAISE NOTICE '   - All future inserts will default to 0 instead of NULL';
  RAISE NOTICE '';
END $$;
