-- ============================================================================
-- Migration Script: Add Aggregate Metrics to Breakdown Tables
-- Adds additional metric columns to breakdown tables for richer analysis
-- ============================================================================

-- Add columns to creator_subscriptions_by_price table
ALTER TABLE creator_subscriptions_by_price
ADD COLUMN IF NOT EXISTS total_subscriptions INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_paywall_views INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_profile_views INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_stripe_views INTEGER DEFAULT 0;

-- Add columns to creator_portfolio_copies table
ALTER TABLE creator_portfolio_copies
ADD COLUMN IF NOT EXISTS total_copies INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_pdp_views INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_profile_views INTEGER DEFAULT 0;

-- Drop and recreate views to add new metrics

-- View: Latest subscription price distribution (normalized monthly)
DROP VIEW IF EXISTS latest_subscription_distribution;
CREATE VIEW latest_subscription_distribution AS
SELECT
    ROUND(monthly_price, 2) as monthly_price_rounded,
    SUM(subscription_count) as event_count,
    SUM(total_subscriptions) as total_subscriptions,
    SUM(total_paywall_views) as total_paywall_views,
    SUM(total_profile_views) as total_profile_views,
    SUM(total_stripe_views) as total_stripe_views
FROM creator_subscriptions_by_price
WHERE synced_at = (SELECT MAX(synced_at) FROM creator_subscriptions_by_price)
GROUP BY monthly_price_rounded
ORDER BY monthly_price_rounded;

-- View: Top 10 creators by portfolio copies
DROP VIEW IF EXISTS top_creators_by_portfolio_copies;
CREATE VIEW top_creators_by_portfolio_copies AS
SELECT
    creator_username,
    SUM(copy_count) as event_count,
    SUM(total_copies) as total_copies,
    SUM(total_pdp_views) as total_pdp_views,
    SUM(total_profile_views) as total_profile_views
FROM creator_portfolio_copies
WHERE synced_at = (SELECT MAX(synced_at) FROM creator_portfolio_copies)
AND creator_username IS NOT NULL
GROUP BY creator_username
ORDER BY event_count DESC
LIMIT 10;

-- View: Top 10 portfolios by copies
DROP VIEW IF EXISTS top_portfolios_by_copies;
CREATE VIEW top_portfolios_by_copies AS
SELECT
    portfolio_ticker,
    SUM(copy_count) as event_count,
    SUM(total_copies) as total_copies,
    SUM(total_pdp_views) as total_pdp_views,
    SUM(total_profile_views) as total_profile_views
FROM creator_portfolio_copies
WHERE synced_at = (SELECT MAX(synced_at) FROM creator_portfolio_copies)
AND portfolio_ticker IS NOT NULL
GROUP BY portfolio_ticker
ORDER BY event_count DESC
LIMIT 10;

-- Add comments for documentation
COMMENT ON COLUMN creator_subscriptions_by_price.total_subscriptions IS 'Aggregate total subscriptions for creators at this price point';
COMMENT ON COLUMN creator_subscriptions_by_price.total_paywall_views IS 'Aggregate total paywall views for creators at this price point';
COMMENT ON COLUMN creator_subscriptions_by_price.total_profile_views IS 'Aggregate total profile views for creators at this price point';
COMMENT ON COLUMN creator_subscriptions_by_price.total_stripe_views IS 'Aggregate total stripe views for creators at this price point';

COMMENT ON COLUMN creator_portfolio_copies.total_copies IS 'Aggregate total copies for this creator';
COMMENT ON COLUMN creator_portfolio_copies.total_pdp_views IS 'Aggregate total PDP views for this creator';
COMMENT ON COLUMN creator_portfolio_copies.total_profile_views IS 'Aggregate total profile views for this creator';

-- ============================================================================
-- Summary of changes:
-- ============================================================================
-- ✅ Added: total_subscriptions, total_paywall_views, total_profile_views, total_stripe_views to creator_subscriptions_by_price
-- ✅ Added: total_copies, total_pdp_views, total_profile_views to creator_portfolio_copies
-- ✅ Updated: All 3 views to include new aggregate metrics
-- ============================================================================
