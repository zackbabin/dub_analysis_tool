-- ============================================================================
-- Supabase Database Schema for Creator Analysis
-- Extends existing schema with creator-specific tables
-- ============================================================================

-- ============================================================================
-- Table 1: creators_insights
-- Stores creator profile data with engagement metrics
-- ============================================================================

CREATE TABLE IF NOT EXISTS creators_insights (
    -- Primary identifier
    id BIGSERIAL PRIMARY KEY,
    creator_id TEXT NOT NULL,
    creator_username TEXT,

    -- Creator Classification
    creator_type TEXT DEFAULT 'Regular',

    -- Engagement Metrics - Views
    total_profile_views INTEGER DEFAULT 0,
    total_pdp_views INTEGER DEFAULT 0,
    total_paywall_views INTEGER DEFAULT 0,
    total_stripe_views INTEGER DEFAULT 0,

    -- Conversion Metrics
    total_subscriptions INTEGER DEFAULT 0,
    total_subscription_revenue NUMERIC DEFAULT 0,
    total_cancelled_subscriptions INTEGER DEFAULT 0,
    total_expired_subscriptions INTEGER DEFAULT 0,

    -- Metadata
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Constraints
    CONSTRAINT unique_creator_per_sync UNIQUE (creator_id, synced_at)
);

-- Index for fast lookups by creator_id
CREATE INDEX IF NOT EXISTS idx_creators_creator_id ON creators_insights(creator_id);

-- Index for username lookups
CREATE INDEX IF NOT EXISTS idx_creators_username ON creators_insights(creator_username);

-- Index for sync tracking
CREATE INDEX IF NOT EXISTS idx_creators_synced_at ON creators_insights(synced_at DESC);

-- Composite index for common queries
CREATE INDEX IF NOT EXISTS idx_creators_conversion_metrics
    ON creators_insights(total_subscriptions, total_profile_views);

-- ============================================================================
-- Table 2: creator_portfolios
-- Stores portfolio-level data for each creator
-- ============================================================================

CREATE TABLE IF NOT EXISTS creator_portfolios (
    -- Primary identifier
    id BIGSERIAL PRIMARY KEY,
    portfolio_name TEXT NOT NULL,
    creator_username TEXT,

    -- Conversion Funnel
    pdp_views INTEGER DEFAULT 0,
    copies INTEGER DEFAULT 0,

    -- Derived Metrics
    conversion_rate NUMERIC GENERATED ALWAYS AS (
        CASE
            WHEN pdp_views > 0 THEN (copies::NUMERIC / pdp_views) * 100
            ELSE 0
        END
    ) STORED,

    -- Metadata
    synced_at TIMESTAMPTZ DEFAULT NOW(),

    -- Constraints
    CONSTRAINT unique_portfolio_per_sync UNIQUE (portfolio_name, creator_username, synced_at)
);

-- Index for fast lookups by creator_username
CREATE INDEX IF NOT EXISTS idx_portfolios_username ON creator_portfolios(creator_username);

-- Index for portfolio name
CREATE INDEX IF NOT EXISTS idx_portfolios_name ON creator_portfolios(portfolio_name);

-- Index for sync tracking
CREATE INDEX IF NOT EXISTS idx_portfolios_synced_at ON creator_portfolios(synced_at DESC);

-- ============================================================================
-- Table 3: creator_profile_conversions
-- Stores creator profile view -> subscription conversion data
-- ============================================================================

CREATE TABLE IF NOT EXISTS creator_profile_conversions (
    -- Primary identifier
    id BIGSERIAL PRIMARY KEY,
    creator_username TEXT NOT NULL,

    -- Conversion Funnel
    profile_views INTEGER DEFAULT 0,
    subscriptions INTEGER DEFAULT 0,

    -- Derived Metrics
    conversion_rate NUMERIC GENERATED ALWAYS AS (
        CASE
            WHEN profile_views > 0 THEN (subscriptions::NUMERIC / profile_views) * 100
            ELSE 0
        END
    ) STORED,

    -- Metadata
    synced_at TIMESTAMPTZ DEFAULT NOW(),

    -- Constraints
    CONSTRAINT unique_creator_profile_per_sync UNIQUE (creator_username, synced_at)
);

-- Index for fast lookups by creator_username
CREATE INDEX IF NOT EXISTS idx_profile_conversions_username ON creator_profile_conversions(creator_username);

-- Index for sync tracking
CREATE INDEX IF NOT EXISTS idx_profile_conversions_synced_at ON creator_profile_conversions(synced_at DESC);

-- ============================================================================
-- MIGRATION: Add new columns to existing table
-- ============================================================================

-- Add new columns to creators_insights table
ALTER TABLE creators_insights
ADD COLUMN IF NOT EXISTS creator_type TEXT DEFAULT 'Regular',
ADD COLUMN IF NOT EXISTS total_subscription_revenue NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_cancelled_subscriptions INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_expired_subscriptions INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_copies INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_investment_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_investments NUMERIC DEFAULT 0;

-- ============================================================================
-- Materialized View: creator_analysis
-- Pre-computed joined view of all creator data for faster analysis
-- ============================================================================

-- Drop existing view to recreate with new columns (CASCADE drops dependent views)
DROP MATERIALIZED VIEW IF EXISTS creator_analysis CASCADE;

CREATE MATERIALIZED VIEW creator_analysis AS
SELECT
    ci.creator_id,
    ci.creator_username,
    ci.creator_type,

    -- All 11 metrics from Insights by Creators chart
    ci.total_profile_views,
    ci.total_pdp_views,
    ci.total_paywall_views,
    ci.total_stripe_views,
    ci.total_subscriptions,
    ci.total_subscription_revenue,
    ci.total_cancelled_subscriptions,
    ci.total_expired_subscriptions,
    ci.total_copies,
    ci.total_investment_count,
    ci.total_investments,

    -- Metadata
    ci.synced_at,
    ci.updated_at

FROM creators_insights ci
WHERE ci.synced_at = (
    SELECT MAX(synced_at)
    FROM creators_insights
    WHERE creator_id = ci.creator_id
);

-- Index on materialized view for fast queries
CREATE UNIQUE INDEX IF NOT EXISTS idx_creator_analysis_creator_id
    ON creator_analysis(creator_id);

CREATE INDEX IF NOT EXISTS idx_creator_analysis_username
    ON creator_analysis(creator_username);

CREATE INDEX IF NOT EXISTS idx_creator_analysis_copies
    ON creator_analysis(total_copies DESC);

CREATE INDEX IF NOT EXISTS idx_creator_analysis_subscriptions
    ON creator_analysis(total_subscriptions DESC);

CREATE INDEX IF NOT EXISTS idx_creator_analysis_type
    ON creator_analysis(creator_type);

-- ============================================================================
-- Helper Functions
-- ============================================================================

-- Function to refresh the creator_analysis materialized view after each sync
CREATE OR REPLACE FUNCTION refresh_creator_analysis()
RETURNS VOID AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY creator_analysis;
END;
$$ LANGUAGE plpgsql;

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_creators_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at on creators_insights
DROP TRIGGER IF EXISTS update_creators_insights_updated_at ON creators_insights;
CREATE TRIGGER update_creators_insights_updated_at
    BEFORE UPDATE ON creators_insights
    FOR EACH ROW
    EXECUTE FUNCTION update_creators_updated_at_column();

-- ============================================================================
-- Row Level Security (RLS) Policies
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE creators_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE creator_portfolios ENABLE ROW LEVEL SECURITY;
ALTER TABLE creator_profile_conversions ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read all data
DROP POLICY IF EXISTS "Allow authenticated read access to creators_insights" ON creators_insights;
CREATE POLICY "Allow authenticated read access to creators_insights"
    ON creators_insights FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Allow authenticated read access to creator_portfolios" ON creator_portfolios;
CREATE POLICY "Allow authenticated read access to creator_portfolios"
    ON creator_portfolios FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Allow authenticated read access to creator_profile_conversions" ON creator_profile_conversions;
CREATE POLICY "Allow authenticated read access to creator_profile_conversions"
    ON creator_profile_conversions FOR SELECT
    TO authenticated
    USING (true);

-- Allow service role full access (for Edge Functions)
DROP POLICY IF EXISTS "Allow service role full access to creators_insights" ON creators_insights;
CREATE POLICY "Allow service role full access to creators_insights"
    ON creators_insights FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "Allow service role full access to creator_portfolios" ON creator_portfolios;
CREATE POLICY "Allow service role full access to creator_portfolios"
    ON creator_portfolios FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "Allow service role full access to creator_profile_conversions" ON creator_profile_conversions;
CREATE POLICY "Allow service role full access to creator_profile_conversions"
    ON creator_profile_conversions FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- Utility Views
-- ============================================================================

-- View to get latest creator sync status
CREATE OR REPLACE VIEW latest_creator_sync_status AS
SELECT
    MAX(synced_at) as last_sync,
    COUNT(DISTINCT creator_id) as total_creators,
    SUM(total_subscriptions) as total_subscriptions,
    SUM(total_profile_views) as total_profile_views,
    NOW() - MAX(synced_at) as time_since_last_sync
FROM creators_insights
WHERE synced_at = (SELECT MAX(synced_at) FROM creators_insights);

-- View to get top creators by copies
CREATE OR REPLACE VIEW top_creators_by_copies AS
SELECT
    creator_id,
    creator_username,
    creator_type,
    total_copies,
    total_profile_views,
    total_pdp_views
FROM creator_analysis
ORDER BY total_copies DESC
LIMIT 50;

-- View to get top creators by subscriptions
CREATE OR REPLACE VIEW top_creators_by_subscriptions AS
SELECT
    creator_id,
    creator_username,
    creator_type,
    total_subscriptions,
    total_profile_views,
    total_subscription_revenue
FROM creator_analysis
ORDER BY total_subscriptions DESC
LIMIT 50;

-- ============================================================================
-- Comments for documentation
-- ============================================================================

COMMENT ON TABLE creators_insights IS 'Creator profile data with all 11 metrics from Insights by Creators chart in Mixpanel';
COMMENT ON MATERIALIZED VIEW creator_analysis IS 'Pre-computed view of latest creator data for analysis';

COMMENT ON COLUMN creators_insights.creator_id IS 'Mixpanel creator_id, primary creator identifier';
COMMENT ON COLUMN creators_insights.creator_type IS 'Creator type: Premium if any Premium activity, otherwise Regular';
COMMENT ON COLUMN creator_analysis.total_copies IS 'Total copies from metric I in Insights by Creators';
COMMENT ON COLUMN creator_analysis.total_subscriptions IS 'Total subscriptions from metric E in Insights by Creators';

-- ============================================================================
-- Grant permissions
-- ============================================================================

-- Grant usage to authenticated users
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON creators_insights TO authenticated;

-- Grant full access to service role
GRANT ALL ON creators_insights TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- ============================================================================
-- End of creator schema
-- ============================================================================
