-- Migration: Remove total_deposit_count column from subscribers_insights table
-- This field is no longer needed and is being removed from Mixpanel Engage API requests

-- Step 1: Remove total_deposit_count from subscribers_insights table
ALTER TABLE subscribers_insights DROP COLUMN IF EXISTS total_deposit_count;

-- Step 2: Update main_analysis view to remove total_deposit_count
CREATE OR REPLACE VIEW main_analysis AS
SELECT
    si.user_id,
    si.distinct_id,
    -- User Profile (not used in analysis - N/A in mapping)
    si.income,
    si.net_worth,
    si.investing_activity,
    si.investing_experience_years,
    si.investing_objective,
    si.investment_type,
    si.acquisition_survey,
    -- Copy-related metrics
    si.total_copies,
    si.total_regular_copies,
    si.total_premium_copies,
    si.active_copied_portfolios,
    si.lifetime_copied_portfolios,
    -- Deposit & financial metrics
    si.total_deposits,
    si.total_ach_deposits,
    si.total_bank_links,
    si.buying_power,
    si.available_copy_credits,
    -- Portfolio creation metrics
    si.active_created_portfolios,
    si.lifetime_created_portfolios,
    -- Engagement metrics
    si.app_sessions,
    si.paywall_views,
    si.stripe_modal_views,
    si.total_subscriptions,
    si.creator_card_taps,
    si.portfolio_card_taps,
    -- View metrics
    si.regular_pdp_views,
    si.premium_pdp_views,
    si.regular_creator_views,
    si.premium_creator_views,
    si.discover_tab_views,
    si.leaderboard_tab_views,
    si.premium_tab_views,
    -- Aggregated unique views
    COALESCE(creator_agg.unique_creator_viewed, 0) AS unique_creator_viewed,
    COALESCE(portfolio_agg.unique_portfolio_viewed, 0) AS unique_portfolio_viewed,
    -- Metadata
    si.updated_at
FROM subscribers_insights si
-- Aggregate unique creator views per user
LEFT JOIN (
    SELECT
        user_id,
        COUNT(DISTINCT creator_id) AS unique_creator_viewed
    FROM user_creator_engagement
    WHERE profile_view_count > 0
    GROUP BY user_id
) creator_agg ON si.user_id = creator_agg.user_id
-- Aggregate unique portfolio views per user
LEFT JOIN (
    SELECT
        user_id,
        COUNT(DISTINCT portfolio_ticker) AS unique_portfolio_viewed
    FROM user_portfolio_creator_engagement
    WHERE pdp_view_count > 0
    GROUP BY user_id
) portfolio_agg ON si.user_id = portfolio_agg.user_id;

-- Add comment explaining the view
COMMENT ON VIEW main_analysis IS 'Primary analysis view combining subscriber insights with unique engagement metrics. Updated to remove total_deposit_count field.';
