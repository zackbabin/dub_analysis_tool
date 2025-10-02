-- ============================================================================
-- User Engagement for Subscriptions Schema
-- Stores user-level engagement data to analyze optimal combinations that drive subscriptions
-- ============================================================================

-- ============================================================================
-- Table 1: user_portfolio_creator_views
-- Stores specific portfolio-creator pairs viewed by each user
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_portfolio_creator_views (
    id BIGSERIAL PRIMARY KEY,
    distinct_id TEXT NOT NULL,
    portfolio_ticker TEXT NOT NULL,
    creator_id TEXT NOT NULL,
    creator_username TEXT,
    pdp_view_count INTEGER DEFAULT 0,
    did_subscribe BOOLEAN DEFAULT FALSE,
    synced_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT unique_user_pair_per_sync UNIQUE (distinct_id, portfolio_ticker, creator_id, synced_at)
);

-- Indexes for query performance
CREATE INDEX IF NOT EXISTS idx_pair_views_synced_at ON user_portfolio_creator_views(synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_pair_views_portfolio ON user_portfolio_creator_views(portfolio_ticker);
CREATE INDEX IF NOT EXISTS idx_pair_views_creator ON user_portfolio_creator_views(creator_username);
CREATE INDEX IF NOT EXISTS idx_pair_views_subscribe ON user_portfolio_creator_views(did_subscribe);

-- ============================================================================
-- Table 2: user_engagement_for_subscriptions
-- Stores user-level aggregated engagement data
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_engagement_for_subscriptions (
    id BIGSERIAL PRIMARY KEY,
    distinct_id TEXT NOT NULL,
    did_subscribe BOOLEAN DEFAULT FALSE,
    total_profile_views INTEGER DEFAULT 0,
    total_pdp_views INTEGER DEFAULT 0,
    unique_creators_viewed INTEGER DEFAULT 0,
    unique_portfolios_viewed INTEGER DEFAULT 0,
    top_creator_username TEXT,
    top_portfolio_ticker TEXT,
    synced_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT unique_user_per_sync UNIQUE (distinct_id, synced_at)
);

-- Indexes for query performance
CREATE INDEX IF NOT EXISTS idx_engagement_synced_at ON user_engagement_for_subscriptions(synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_engagement_did_subscribe ON user_engagement_for_subscriptions(did_subscribe);
CREATE INDEX IF NOT EXISTS idx_engagement_profile_views ON user_engagement_for_subscriptions(total_profile_views);
CREATE INDEX IF NOT EXISTS idx_engagement_pdp_views ON user_engagement_for_subscriptions(total_pdp_views);

-- ============================================================================
-- Views for Portfolio-Creator Pair Analysis
-- ============================================================================

DROP VIEW IF EXISTS latest_portfolio_creator_views;
DROP VIEW IF EXISTS top_converting_portfolio_creator_pairs;

-- View: Latest portfolio-creator pair views
CREATE VIEW latest_portfolio_creator_views AS
SELECT *
FROM user_portfolio_creator_views
WHERE synced_at = (SELECT MAX(synced_at) FROM user_portfolio_creator_views);

-- View: Top converting portfolio-creator pairs
-- Shows pairs with highest subscription conversion rates (min 3 users)
CREATE VIEW top_converting_portfolio_creator_pairs AS
SELECT
    portfolio_ticker,
    creator_username,
    COUNT(DISTINCT distinct_id) as total_users,
    SUM(CASE WHEN did_subscribe THEN 1 ELSE 0 END) as subscribers,
    ROUND(
        100.0 * SUM(CASE WHEN did_subscribe THEN 1 ELSE 0 END) / NULLIF(COUNT(DISTINCT distinct_id), 0),
        2
    ) as conversion_rate_pct,
    SUM(pdp_view_count) as total_views
FROM latest_portfolio_creator_views
WHERE portfolio_ticker IS NOT NULL
  AND creator_username IS NOT NULL
GROUP BY portfolio_ticker, creator_username
HAVING COUNT(DISTINCT distinct_id) >= 3  -- Minimum 3 users for statistical relevance
ORDER BY conversion_rate_pct DESC, total_users DESC
LIMIT 20;

-- ============================================================================
-- Views for User-Level Engagement Analysis
-- ============================================================================

DROP VIEW IF EXISTS latest_user_engagement_for_subscriptions;

-- View: Latest engagement data for conversion analysis
CREATE VIEW latest_user_engagement_for_subscriptions AS
SELECT *
FROM user_engagement_for_subscriptions
WHERE synced_at = (SELECT MAX(synced_at) FROM user_engagement_for_subscriptions);

-- ============================================================================
-- View: Subscription conversion analysis by engagement buckets
-- ============================================================================

DROP VIEW IF EXISTS subscription_conversion_by_engagement;

CREATE VIEW subscription_conversion_by_engagement AS
SELECT
    CASE
        WHEN total_profile_views = 0 THEN '0'
        WHEN total_profile_views BETWEEN 1 AND 2 THEN '1-2'
        WHEN total_profile_views BETWEEN 3 AND 5 THEN '3-5'
        WHEN total_profile_views BETWEEN 6 AND 10 THEN '6-10'
        ELSE '10+'
    END as profile_views_bucket,
    CASE
        WHEN total_pdp_views = 0 THEN '0'
        WHEN total_pdp_views BETWEEN 1 AND 2 THEN '1-2'
        WHEN total_pdp_views BETWEEN 3 AND 5 THEN '3-5'
        WHEN total_pdp_views BETWEEN 6 AND 10 THEN '6-10'
        ELSE '10+'
    END as pdp_views_bucket,
    COUNT(*) as total_users,
    SUM(CASE WHEN did_subscribe THEN 1 ELSE 0 END) as subscribers,
    ROUND(
        100.0 * SUM(CASE WHEN did_subscribe THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0),
        2
    ) as conversion_rate_pct
FROM latest_user_engagement_for_subscriptions
GROUP BY profile_views_bucket, pdp_views_bucket
ORDER BY profile_views_bucket, pdp_views_bucket;

-- ============================================================================
-- View: Summary stats for subscribers vs non-subscribers
-- ============================================================================

DROP VIEW IF EXISTS subscription_engagement_summary;

CREATE VIEW subscription_engagement_summary AS
SELECT
    did_subscribe,
    COUNT(*) as user_count,
    ROUND(AVG(total_profile_views), 2) as avg_profile_views,
    ROUND(AVG(total_pdp_views), 2) as avg_pdp_views,
    ROUND(AVG(unique_creators_viewed), 2) as avg_unique_creators,
    ROUND(AVG(unique_portfolios_viewed), 2) as avg_unique_portfolios,
    MAX(total_profile_views) as max_profile_views,
    MAX(total_pdp_views) as max_pdp_views
FROM latest_user_engagement_for_subscriptions
GROUP BY did_subscribe;

-- ============================================================================
-- RLS Policies
-- ============================================================================

ALTER TABLE user_portfolio_creator_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_engagement_for_subscriptions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to recreate
DROP POLICY IF EXISTS "Allow authenticated read access to user_portfolio_creator_views" ON user_portfolio_creator_views;
DROP POLICY IF EXISTS "Allow service role full access to user_portfolio_creator_views" ON user_portfolio_creator_views;
DROP POLICY IF EXISTS "Allow authenticated read access to user_engagement_for_subscriptions" ON user_engagement_for_subscriptions;
DROP POLICY IF EXISTS "Allow service role full access to user_engagement_for_subscriptions" ON user_engagement_for_subscriptions;

-- Allow authenticated users to read portfolio-creator pairs
CREATE POLICY "Allow authenticated read access to user_portfolio_creator_views"
    ON user_portfolio_creator_views FOR SELECT
    TO authenticated
    USING (true);

-- Allow service role full access to portfolio-creator pairs
CREATE POLICY "Allow service role full access to user_portfolio_creator_views"
    ON user_portfolio_creator_views FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Allow authenticated users to read user engagement
CREATE POLICY "Allow authenticated read access to user_engagement_for_subscriptions"
    ON user_engagement_for_subscriptions FOR SELECT
    TO authenticated
    USING (true);

-- Allow service role full access to user engagement
CREATE POLICY "Allow service role full access to user_engagement_for_subscriptions"
    ON user_engagement_for_subscriptions FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE user_portfolio_creator_views IS 'Specific portfolio-creator pairs viewed by each user, for identifying high-converting combinations';
COMMENT ON TABLE user_engagement_for_subscriptions IS 'User-level engagement data for analyzing optimal combinations that drive subscriptions';
COMMENT ON VIEW top_converting_portfolio_creator_pairs IS 'Top 20 portfolio-creator pairs ranked by subscription conversion rate';
COMMENT ON COLUMN user_engagement_for_subscriptions.did_subscribe IS 'Whether user subscribed to any creator';
COMMENT ON VIEW subscription_conversion_by_engagement IS 'Conversion rates grouped by profile view and PDP view buckets';
COMMENT ON VIEW subscription_engagement_summary IS 'Summary statistics comparing subscribers vs non-subscribers';

-- ============================================================================
-- End of user engagement schema
-- ============================================================================
