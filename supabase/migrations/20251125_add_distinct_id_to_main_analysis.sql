-- Migration: Add distinct_id column to main_analysis
-- Created: 2025-11-25
-- Purpose: Include distinct_id from subscribers_insights in main_analysis view
--
-- Background:
-- - subscribers_insights has BOTH user_id (PRIMARY KEY) and distinct_id (for Engage API)
-- - main_analysis was only selecting user_id, missing distinct_id
-- - Some queries/joins may need distinct_id for compatibility

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
  -- Include BOTH user_id and distinct_id from subscribers_insights
  si.user_id,
  si.distinct_id,  -- ADD: Include distinct_id for Engage API compatibility
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
LEFT JOIN unique_engagement ue ON si.user_id = ue.user_id;

-- Create unique index on user_id (primary key for main_analysis)
CREATE UNIQUE INDEX IF NOT EXISTS idx_main_analysis_user_id ON main_analysis(user_id);

-- Create index on distinct_id for Engage API compatibility
CREATE INDEX IF NOT EXISTS idx_main_analysis_distinct_id ON main_analysis(distinct_id);

-- Grant permissions
GRANT SELECT ON main_analysis TO authenticated, anon, service_role;

COMMENT ON MATERIALIZED VIEW main_analysis IS
'Main analysis view combining user properties from subscribers_insights with engagement metrics.
Includes both user_id (primary) and distinct_id (for Engage API compatibility).
Updated 2025-11-25 to include distinct_id column.';

-- Log the changes
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Updated main_analysis materialized view';
  RAISE NOTICE '   - Added distinct_id column from subscribers_insights';
  RAISE NOTICE '   - Created index on distinct_id';
  RAISE NOTICE '   - user_id remains the primary identifier';
  RAISE NOTICE '';
END $$;
