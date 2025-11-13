-- Alter subscribers_insights_v2 table to match new schema
-- Removes unused event columns (keeps user property columns for future implementation)
-- Adds premium/regular split columns for copies, pdp_views, and creator_profile_views
-- Date: 2025-11-13

-- Step 1: Add all columns from subscribers_insights (matching schema exactly)
-- User properties
ALTER TABLE subscribers_insights_v2
ADD COLUMN IF NOT EXISTS income TEXT,
ADD COLUMN IF NOT EXISTS net_worth TEXT,
ADD COLUMN IF NOT EXISTS investing_activity TEXT,
ADD COLUMN IF NOT EXISTS investing_experience_years TEXT,
ADD COLUMN IF NOT EXISTS investing_objective TEXT,
ADD COLUMN IF NOT EXISTS investment_type TEXT,
ADD COLUMN IF NOT EXISTS acquisition_survey TEXT;

-- Account properties
ALTER TABLE subscribers_insights_v2
ADD COLUMN IF NOT EXISTS available_copy_credits NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS buying_power NUMERIC DEFAULT 0;

-- Financial metrics
ALTER TABLE subscribers_insights_v2
ADD COLUMN IF NOT EXISTS total_deposits NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_deposit_count INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_withdrawals NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_withdrawal_count INT DEFAULT 0;

-- Portfolio metrics
ALTER TABLE subscribers_insights_v2
ADD COLUMN IF NOT EXISTS active_created_portfolios INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS lifetime_created_portfolios INT DEFAULT 0;

-- Step 2: Add event metric columns matching subscribers_insights
ALTER TABLE subscribers_insights_v2
ADD COLUMN IF NOT EXISTS total_copies INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_regular_copies INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_premium_copies INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS regular_pdp_views INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS premium_pdp_views INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS paywall_views INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS regular_creator_profile_views INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS premium_creator_profile_views INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS stripe_modal_views INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS app_sessions INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS creator_card_taps INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS portfolio_card_taps INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_subscriptions INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_ach_transfers INT DEFAULT 0;

-- Step 3: Drop columns that we're excluding from v2
ALTER TABLE subscribers_insights_v2
DROP COLUMN IF EXISTS discover_tab_views,
DROP COLUMN IF EXISTS leaderboard_tab_views,
DROP COLUMN IF EXISTS premium_tab_views;

-- Step 4: Add indexes matching subscribers_insights
CREATE INDEX IF NOT EXISTS idx_subscribers_v2_total_subscriptions
ON subscribers_insights_v2(total_subscriptions)
WHERE total_subscriptions > 0;

CREATE INDEX IF NOT EXISTS idx_subscribers_v2_total_premium_copies
ON subscribers_insights_v2(total_premium_copies)
WHERE total_premium_copies > 0;

CREATE INDEX IF NOT EXISTS idx_subscribers_v2_total_regular_copies
ON subscribers_insights_v2(total_regular_copies)
WHERE total_regular_copies > 0;

CREATE INDEX IF NOT EXISTS idx_subscribers_v2_updated_at
ON subscribers_insights_v2(updated_at DESC);

-- Step 5: Update table comment
COMMENT ON TABLE subscribers_insights_v2 IS
'Event Export API implementation. Populated from raw Mixpanel events. Premium/regular splits for copies, pdp_views, and creator_profile_views determined by creatorType property. Excludes: discover_tab_views, leaderboard_tab_views, premium_tab_views.';
