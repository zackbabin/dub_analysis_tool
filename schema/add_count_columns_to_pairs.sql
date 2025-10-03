-- Add subscription_count and copy_count columns to track total conversions per user

-- Add subscription_count to user_portfolio_creator_views
ALTER TABLE user_portfolio_creator_views
ADD COLUMN IF NOT EXISTS subscription_count integer DEFAULT 0;

COMMENT ON COLUMN user_portfolio_creator_views.subscription_count IS 'Total number of subscriptions for this user (not unique to this pair)';

-- Add copy_count to user_portfolio_creator_copies
ALTER TABLE user_portfolio_creator_copies
ADD COLUMN IF NOT EXISTS copy_count integer DEFAULT 0;

COMMENT ON COLUMN user_portfolio_creator_copies.copy_count IS 'Total number of copies for this user (not unique to this pair)';

-- Note: These columns store the user's TOTAL conversion count across all portfolio-creator pairs
-- This allows the analysis functions to calculate total_conversions aggregate metric
