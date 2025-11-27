-- Migration: Add trigger to coerce NULL to 0 for numeric/integer columns
-- Created: 2025-11-27
-- Purpose: Automatically convert NULL values to 0 on INSERT/UPDATE
--
-- Background:
-- - DEFAULT 0 only applies when column is omitted from INSERT
-- - If code explicitly sets column to NULL, DEFAULT doesn't apply
-- - This trigger ensures NULL is converted to 0 even when explicitly set

-- Create trigger function to coerce NULL to 0
CREATE OR REPLACE FUNCTION coerce_null_to_zero_subscribers_insights()
RETURNS TRIGGER AS $$
BEGIN
  -- Numeric columns
  NEW.available_copy_credits := COALESCE(NEW.available_copy_credits, 0);
  NEW.buying_power := COALESCE(NEW.buying_power, 0);
  NEW.total_deposits := COALESCE(NEW.total_deposits, 0);
  NEW.total_withdrawals := COALESCE(NEW.total_withdrawals, 0);

  -- Integer columns
  NEW.active_created_portfolios := COALESCE(NEW.active_created_portfolios, 0);
  NEW.lifetime_created_portfolios := COALESCE(NEW.lifetime_created_portfolios, 0);
  NEW.total_copies := COALESCE(NEW.total_copies, 0);
  NEW.total_regular_copies := COALESCE(NEW.total_regular_copies, 0);
  NEW.total_premium_copies := COALESCE(NEW.total_premium_copies, 0);
  NEW.regular_pdp_views := COALESCE(NEW.regular_pdp_views, 0);
  NEW.premium_pdp_views := COALESCE(NEW.premium_pdp_views, 0);
  NEW.paywall_views := COALESCE(NEW.paywall_views, 0);
  NEW.regular_creator_views := COALESCE(NEW.regular_creator_views, 0);
  NEW.premium_creator_views := COALESCE(NEW.premium_creator_views, 0);
  NEW.stripe_modal_views := COALESCE(NEW.stripe_modal_views, 0);
  NEW.app_sessions := COALESCE(NEW.app_sessions, 0);
  NEW.discover_tab_views := COALESCE(NEW.discover_tab_views, 0);
  NEW.leaderboard_tab_views := COALESCE(NEW.leaderboard_tab_views, 0);
  NEW.premium_tab_views := COALESCE(NEW.premium_tab_views, 0);
  NEW.creator_card_taps := COALESCE(NEW.creator_card_taps, 0);
  NEW.portfolio_card_taps := COALESCE(NEW.portfolio_card_taps, 0);
  NEW.total_subscriptions := COALESCE(NEW.total_subscriptions, 0);
  NEW.total_bank_links := COALESCE(NEW.total_bank_links, 0);
  NEW.total_ach_deposits := COALESCE(NEW.total_ach_deposits, 0);
  NEW.lifetime_copied_portfolios := COALESCE(NEW.lifetime_copied_portfolios, 0);
  NEW.active_copied_portfolios := COALESCE(NEW.active_copied_portfolios, 0);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on subscribers_insights
DROP TRIGGER IF EXISTS trigger_coerce_null_to_zero ON subscribers_insights;

CREATE TRIGGER trigger_coerce_null_to_zero
  BEFORE INSERT OR UPDATE ON subscribers_insights
  FOR EACH ROW
  EXECUTE FUNCTION coerce_null_to_zero_subscribers_insights();

-- Log the changes
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Added trigger to coerce NULL to 0';
  RAISE NOTICE '   - Trigger: trigger_coerce_null_to_zero';
  RAISE NOTICE '   - Applies to: INSERT and UPDATE operations';
  RAISE NOTICE '   - Effect: Any NULL value will be automatically converted to 0';
  RAISE NOTICE '   - Covers: All 26 numeric and integer metric columns';
  RAISE NOTICE '';
END $$;

COMMENT ON FUNCTION coerce_null_to_zero_subscribers_insights() IS
'Trigger function that converts NULL to 0 for all numeric and integer columns in subscribers_insights.
Runs BEFORE INSERT OR UPDATE to ensure no NULL values are ever stored.';
