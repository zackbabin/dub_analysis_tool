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

    -- Engagement Metrics - Views
    total_profile_views INTEGER DEFAULT 0,
    total_pdp_views INTEGER DEFAULT 0,
    total_paywall_views INTEGER DEFAULT 0,
    total_stripe_views INTEGER DEFAULT 0,

    -- Conversion Metrics
    total_subscriptions INTEGER DEFAULT 0,

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
-- Materialized View: creator_analysis
-- Pre-computed joined view of all creator data for faster analysis
-- ============================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS creator_analysis AS
SELECT
    ci.creator_id,
    ci.creator_username,

    -- Core Metrics from creators_insights
    ci.total_profile_views,
    ci.total_pdp_views,
    ci.total_paywall_views,
    ci.total_stripe_views,
    ci.total_subscriptions,

    -- Aggregated Portfolio Metrics (sum across all portfolios by creator)
    COALESCE(SUM(cp.pdp_views), 0)::INTEGER as total_portfolio_pdp_views,
    COALESCE(SUM(cp.copies), 0)::INTEGER as total_copies,
    COALESCE(COUNT(DISTINCT cp.portfolio_name), 0)::INTEGER as total_portfolios_created,

    -- Average portfolio performance
    CASE
        WHEN COUNT(DISTINCT cp.portfolio_name) > 0
        THEN ROUND(AVG(cp.copies), 2)
        ELSE 0
    END as avg_copies_per_portfolio,

    CASE
        WHEN COUNT(DISTINCT cp.portfolio_name) > 0
        THEN ROUND(AVG(cp.conversion_rate), 2)
        ELSE 0
    END as avg_portfolio_conversion_rate,

    -- Profile Conversion Metrics
    COALESCE(cpc.profile_views, 0)::INTEGER as creator_profile_views_funnel,
    COALESCE(cpc.subscriptions, 0)::INTEGER as creator_subscriptions_funnel,

    -- Derived Conversion Rates
    CASE
        WHEN SUM(cp.pdp_views) > 0
        THEN ROUND((SUM(cp.copies)::NUMERIC / SUM(cp.pdp_views)) * 100, 2)
        ELSE 0
    END as overall_copy_conversion_rate,

    CASE
        WHEN cpc.profile_views > 0
        THEN ROUND((cpc.subscriptions::NUMERIC / cpc.profile_views) * 100, 2)
        ELSE 0
    END as overall_subscription_conversion_rate,

    -- Engagement Ratios
    CASE
        WHEN ci.total_profile_views > 0
        THEN ROUND((ci.total_paywall_views::NUMERIC / ci.total_profile_views) * 100, 2)
        ELSE 0
    END as paywall_view_rate,

    CASE
        WHEN ci.total_paywall_views > 0
        THEN ROUND((ci.total_stripe_views::NUMERIC / ci.total_paywall_views) * 100, 2)
        ELSE 0
    END as stripe_view_rate,

    -- Metadata
    ci.synced_at,
    ci.updated_at

FROM creators_insights ci
LEFT JOIN creator_portfolios cp
    ON ci.creator_username = cp.creator_username
    AND ci.synced_at = cp.synced_at
LEFT JOIN creator_profile_conversions cpc
    ON ci.creator_username = cpc.creator_username
    AND ci.synced_at = cpc.synced_at
WHERE ci.synced_at = (
    SELECT MAX(synced_at)
    FROM creators_insights
    WHERE creator_id = ci.creator_id
)
GROUP BY
    ci.creator_id,
    ci.creator_username,
    ci.total_profile_views,
    ci.total_pdp_views,
    ci.total_paywall_views,
    ci.total_stripe_views,
    ci.total_subscriptions,
    cpc.profile_views,
    cpc.subscriptions,
    ci.synced_at,
    ci.updated_at;

-- Index on materialized view for fast queries
CREATE UNIQUE INDEX IF NOT EXISTS idx_creator_analysis_creator_id
    ON creator_analysis(creator_id);

CREATE INDEX IF NOT EXISTS idx_creator_analysis_username
    ON creator_analysis(creator_username);

CREATE INDEX IF NOT EXISTS idx_creator_analysis_copies
    ON creator_analysis(total_copies DESC);

CREATE INDEX IF NOT EXISTS idx_creator_analysis_subscriptions
    ON creator_analysis(total_subscriptions DESC);

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
CREATE POLICY "Allow authenticated read access to creators_insights"
    ON creators_insights FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Allow authenticated read access to creator_portfolios"
    ON creator_portfolios FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Allow authenticated read access to creator_profile_conversions"
    ON creator_profile_conversions FOR SELECT
    TO authenticated
    USING (true);

-- Allow service role full access (for Edge Functions)
CREATE POLICY "Allow service role full access to creators_insights"
    ON creators_insights FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow service role full access to creator_portfolios"
    ON creator_portfolios FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

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
    total_copies,
    total_portfolios_created,
    avg_copies_per_portfolio,
    overall_copy_conversion_rate
FROM creator_analysis
ORDER BY total_copies DESC
LIMIT 50;

-- View to get top creators by subscriptions
CREATE OR REPLACE VIEW top_creators_by_subscriptions AS
SELECT
    creator_id,
    creator_username,
    total_subscriptions,
    total_profile_views,
    overall_subscription_conversion_rate
FROM creator_analysis
ORDER BY total_subscriptions DESC
LIMIT 50;

-- ============================================================================
-- Comments for documentation
-- ============================================================================

COMMENT ON TABLE creators_insights IS 'Creator profile data with engagement metrics from Mixpanel';
COMMENT ON TABLE creator_portfolios IS 'Portfolio-level data tracking copies and views per creator';
COMMENT ON TABLE creator_profile_conversions IS 'Creator profile view to subscription conversion funnel';
COMMENT ON MATERIALIZED VIEW creator_analysis IS 'Pre-computed view joining all creator data for analysis';

COMMENT ON COLUMN creators_insights.creator_id IS 'Mixpanel creator_id, primary creator identifier';
COMMENT ON COLUMN creator_portfolios.conversion_rate IS 'Calculated conversion rate: (copies / pdp_views) * 100';
COMMENT ON COLUMN creator_analysis.total_copies IS 'Sum of all copies across all portfolios for this creator';
COMMENT ON COLUMN creator_analysis.total_portfolios_created IS 'Number of distinct portfolios created by this creator';

-- ============================================================================
-- Grant permissions
-- ============================================================================

-- Grant usage to authenticated users
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON creators_insights TO authenticated;
GRANT SELECT ON creator_portfolios TO authenticated;
GRANT SELECT ON creator_profile_conversions TO authenticated;

-- Grant full access to service role
GRANT ALL ON creators_insights TO service_role;
GRANT ALL ON creator_portfolios TO service_role;
GRANT ALL ON creator_profile_conversions TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- ============================================================================
-- End of creator schema
-- ============================================================================
