-- ============================================================================
-- Migration Script: Update Breakdown Views Only
-- Just updates the views to use correct column names and filters
-- ============================================================================

-- Drop and recreate views with correct logic

-- View: Latest subscription price distribution (normalized monthly)
-- Shows Total Subscriptions from Subscriptions by Price chart at each monthly price point
DROP VIEW IF EXISTS latest_subscription_distribution;
CREATE VIEW latest_subscription_distribution AS
SELECT
    ROUND(monthly_price, 2) as monthly_price_rounded,
    SUM(total_subscriptions) as total_subscriptions
FROM creator_subscriptions_by_price
WHERE synced_at = (SELECT MAX(synced_at) FROM creator_subscriptions_by_price)
GROUP BY monthly_price_rounded
ORDER BY monthly_price_rounded;

-- View: Top 10 creators by portfolio copies
-- Shows Total Copies from Portfolio Copies by Creator chart per creator
DROP VIEW IF EXISTS top_creators_by_portfolio_copies;
CREATE VIEW top_creators_by_portfolio_copies AS
SELECT
    creator_username,
    SUM(total_copies) as total_copies
FROM creator_portfolio_copies
WHERE synced_at = (SELECT MAX(synced_at) FROM creator_portfolio_copies)
AND creator_username IS NOT NULL
AND creator_username != 'undefined'
GROUP BY creator_username
ORDER BY total_copies DESC
LIMIT 10;

-- View: Top 10 portfolios by copies
-- Shows Total Copies from Portfolio Copies by Creator chart per portfolio
DROP VIEW IF EXISTS top_portfolios_by_copies;
CREATE VIEW top_portfolios_by_copies AS
SELECT
    portfolio_ticker,
    SUM(total_copies) as total_copies
FROM creator_portfolio_copies
WHERE synced_at = (SELECT MAX(synced_at) FROM creator_portfolio_copies)
AND portfolio_ticker IS NOT NULL
AND portfolio_ticker != 'undefined'
GROUP BY portfolio_ticker
ORDER BY total_copies DESC
LIMIT 10;

-- ============================================================================
-- Summary of changes:
-- ============================================================================
-- ✅ Updated views to use total_subscriptions and total_copies columns
-- ✅ Added filters to exclude 'undefined' values
-- ✅ Views now use data from breakdown-specific Insights charts
-- ============================================================================
