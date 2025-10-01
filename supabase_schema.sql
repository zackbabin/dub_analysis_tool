-- ============================================================================
-- Supabase Database Schema for Dub Analysis Tool
-- Migration from GitHub Actions to Supabase
-- ============================================================================

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- Table 1: subscribers_insights
-- Stores user profile data with demographics and behavioral metrics
-- ============================================================================

CREATE TABLE IF NOT EXISTS subscribers_insights (
    -- Primary identifier
    id BIGSERIAL PRIMARY KEY,
    distinct_id TEXT NOT NULL,

    -- Demographics
    income TEXT,
    net_worth TEXT,
    investing_activity TEXT,
    investing_experience_years TEXT,
    investing_objective TEXT,
    investment_type TEXT,
    acquisition_survey TEXT,

    -- Account & Financial Metrics
    linked_bank_account BOOLEAN DEFAULT FALSE,
    available_copy_credits NUMERIC DEFAULT 0,
    buying_power NUMERIC DEFAULT 0,
    total_deposits NUMERIC DEFAULT 0,
    total_deposit_count INTEGER DEFAULT 0,
    total_withdrawals NUMERIC DEFAULT 0,
    total_withdrawal_count INTEGER DEFAULT 0,

    -- Portfolio & Trading Activity
    active_created_portfolios INTEGER DEFAULT 0,
    lifetime_created_portfolios INTEGER DEFAULT 0,

    -- Copying Behavior
    total_copies INTEGER DEFAULT 0,
    total_regular_copies INTEGER DEFAULT 0,
    total_premium_copies INTEGER DEFAULT 0,

    -- Engagement Metrics - Views
    regular_pdp_views INTEGER DEFAULT 0,
    premium_pdp_views INTEGER DEFAULT 0,
    paywall_views INTEGER DEFAULT 0,
    regular_creator_profile_views INTEGER DEFAULT 0,
    premium_creator_profile_views INTEGER DEFAULT 0,
    stripe_modal_views INTEGER DEFAULT 0,

    -- Engagement Metrics - App Activity
    app_sessions INTEGER DEFAULT 0,
    discover_tab_views INTEGER DEFAULT 0,
    leaderboard_tab_views INTEGER DEFAULT 0,
    premium_tab_views INTEGER DEFAULT 0,
    creator_card_taps INTEGER DEFAULT 0,
    portfolio_card_taps INTEGER DEFAULT 0,

    -- Subscription Status
    total_subscriptions INTEGER DEFAULT 0,
    subscribed_within_7_days BOOLEAN DEFAULT FALSE,

    -- Metadata
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Constraints
    CONSTRAINT unique_distinct_id_per_sync UNIQUE (distinct_id, synced_at)
);

-- Index for fast lookups by distinct_id
CREATE INDEX IF NOT EXISTS idx_subscribers_distinct_id ON subscribers_insights(distinct_id);

-- Index for sync tracking
CREATE INDEX IF NOT EXISTS idx_subscribers_synced_at ON subscribers_insights(synced_at DESC);

-- Composite index for common queries
CREATE INDEX IF NOT EXISTS idx_subscribers_conversion_metrics
    ON subscribers_insights(total_deposits, total_copies, total_subscriptions);

-- ============================================================================
-- Table 2: time_funnels
-- Stores time-based funnel data for key conversion events
-- ============================================================================

CREATE TABLE IF NOT EXISTS time_funnels (
    -- Primary identifier
    id BIGSERIAL PRIMARY KEY,
    distinct_id TEXT NOT NULL,

    -- Funnel type identifier
    funnel_type TEXT NOT NULL CHECK (funnel_type IN (
        'time_to_first_copy',
        'time_to_funded_account',
        'time_to_linked_bank'
    )),

    -- Time measurement (in seconds from Mixpanel, will be converted to days)
    time_in_seconds NUMERIC,
    time_in_days NUMERIC,

    -- Metadata
    synced_at TIMESTAMPTZ DEFAULT NOW(),

    -- Constraints
    CONSTRAINT unique_user_funnel_per_sync UNIQUE (distinct_id, funnel_type, synced_at)
);

-- Index for fast lookups by distinct_id
CREATE INDEX IF NOT EXISTS idx_time_funnels_distinct_id ON time_funnels(distinct_id);

-- Index for funnel type filtering
CREATE INDEX IF NOT EXISTS idx_time_funnels_type ON time_funnels(funnel_type);

-- Composite index for common queries
CREATE INDEX IF NOT EXISTS idx_time_funnels_user_type
    ON time_funnels(distinct_id, funnel_type);

-- Index for sync tracking
CREATE INDEX IF NOT EXISTS idx_time_funnels_synced_at ON time_funnels(synced_at DESC);

-- ============================================================================
-- Table 3: sync_logs
-- Tracks data synchronization history and status
-- ============================================================================

CREATE TABLE IF NOT EXISTS sync_logs (
    -- Primary identifier
    id BIGSERIAL PRIMARY KEY,

    -- Sync metadata
    sync_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sync_completed_at TIMESTAMPTZ,
    sync_status TEXT NOT NULL DEFAULT 'in_progress' CHECK (sync_status IN (
        'in_progress',
        'completed',
        'failed',
        'partial'
    )),

    -- Data source
    source TEXT DEFAULT 'mixpanel',
    triggered_by TEXT, -- 'cron', 'manual', 'api', etc.

    -- Data statistics
    subscribers_fetched INTEGER DEFAULT 0,
    time_funnels_fetched INTEGER DEFAULT 0,
    total_records_inserted INTEGER DEFAULT 0,

    -- Error tracking
    error_message TEXT,
    error_details JSONB,

    -- Performance metrics
    duration_seconds NUMERIC,

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for status filtering
CREATE INDEX IF NOT EXISTS idx_sync_logs_status ON sync_logs(sync_status);

-- Index for time-based queries
CREATE INDEX IF NOT EXISTS idx_sync_logs_started_at ON sync_logs(sync_started_at DESC);

-- ============================================================================
-- Materialized View: main_analysis
-- Pre-computed joined view of subscribers + time funnels for faster analysis
-- ============================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS main_analysis AS
SELECT
    s.distinct_id,

    -- Demographics
    s.income,
    s.net_worth,
    s.investing_activity,
    s.investing_experience_years,
    s.investing_objective,
    s.investment_type,
    s.acquisition_survey,

    -- Account & Financial
    s.linked_bank_account,
    s.available_copy_credits,
    s.buying_power,
    s.total_deposits,
    s.total_deposit_count,
    s.total_withdrawals,
    s.total_withdrawal_count,

    -- Portfolio & Trading
    s.active_created_portfolios,
    s.lifetime_created_portfolios,

    -- Copying Behavior
    s.total_copies,
    s.total_regular_copies,
    s.total_premium_copies,

    -- Engagement - Views
    s.regular_pdp_views,
    s.premium_pdp_views,
    s.paywall_views,
    s.regular_creator_profile_views,
    s.premium_creator_profile_views,
    s.stripe_modal_views,

    -- Engagement - App Activity
    s.app_sessions,
    s.discover_tab_views,
    s.leaderboard_tab_views,
    s.premium_tab_views,
    s.creator_card_taps,
    s.portfolio_card_taps,

    -- Subscriptions
    s.total_subscriptions,
    s.subscribed_within_7_days,

    -- Time Funnels (join with time_funnels table)
    tf_first_copy.time_in_days as time_to_first_copy_days,
    tf_funded.time_in_days as time_to_funded_account_days,
    tf_linked.time_in_days as time_to_linked_bank_days,

    -- Metadata
    s.synced_at,
    s.updated_at
FROM
    subscribers_insights s
LEFT JOIN LATERAL (
    SELECT time_in_days
    FROM time_funnels
    WHERE distinct_id = s.distinct_id
      AND funnel_type = 'time_to_first_copy'
      AND synced_at = s.synced_at
    LIMIT 1
) tf_first_copy ON TRUE
LEFT JOIN LATERAL (
    SELECT time_in_days
    FROM time_funnels
    WHERE distinct_id = s.distinct_id
      AND funnel_type = 'time_to_funded_account'
      AND synced_at = s.synced_at
    LIMIT 1
) tf_funded ON TRUE
LEFT JOIN LATERAL (
    SELECT time_in_days
    FROM time_funnels
    WHERE distinct_id = s.distinct_id
      AND funnel_type = 'time_to_linked_bank'
      AND synced_at = s.synced_at
    LIMIT 1
) tf_linked ON TRUE
WHERE
    -- Get only the most recent sync for each user
    s.synced_at = (
        SELECT MAX(synced_at)
        FROM subscribers_insights
        WHERE distinct_id = s.distinct_id
    );

-- Index on materialized view for fast queries
CREATE UNIQUE INDEX IF NOT EXISTS idx_main_analysis_distinct_id
    ON main_analysis(distinct_id);

-- ============================================================================
-- Helper Functions
-- ============================================================================

-- Function to refresh the materialized view after each sync
CREATE OR REPLACE FUNCTION refresh_main_analysis()
RETURNS VOID AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY main_analysis;
END;
$$ LANGUAGE plpgsql;

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at on subscribers_insights
CREATE TRIGGER update_subscribers_insights_updated_at
    BEFORE UPDATE ON subscribers_insights
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to calculate sync duration when completed
CREATE OR REPLACE FUNCTION calculate_sync_duration()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.sync_completed_at IS NOT NULL AND OLD.sync_completed_at IS NULL THEN
        NEW.duration_seconds = EXTRACT(EPOCH FROM (NEW.sync_completed_at - NEW.sync_started_at));
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-calculate sync duration
CREATE TRIGGER calculate_sync_logs_duration
    BEFORE UPDATE ON sync_logs
    FOR EACH ROW
    EXECUTE FUNCTION calculate_sync_duration();

-- ============================================================================
-- Row Level Security (RLS) Policies
-- Enable after setting up authentication
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE subscribers_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_funnels ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_logs ENABLE ROW LEVEL SECURITY;

-- Example policies (customize based on your auth setup)
-- Allow authenticated users to read all data
CREATE POLICY "Allow authenticated read access to subscribers_insights"
    ON subscribers_insights FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Allow authenticated read access to time_funnels"
    ON time_funnels FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Allow authenticated read access to sync_logs"
    ON sync_logs FOR SELECT
    TO authenticated
    USING (true);

-- Allow service role to insert/update (for Edge Functions)
CREATE POLICY "Allow service role full access to subscribers_insights"
    ON subscribers_insights FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow service role full access to time_funnels"
    ON time_funnels FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow service role full access to sync_logs"
    ON sync_logs FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- Utility Views
-- ============================================================================

-- View to get latest sync status
CREATE OR REPLACE VIEW latest_sync_status AS
SELECT
    sync_started_at,
    sync_completed_at,
    sync_status,
    subscribers_fetched,
    time_funnels_fetched,
    total_records_inserted,
    duration_seconds,
    error_message
FROM sync_logs
ORDER BY sync_started_at DESC
LIMIT 1;

-- View to get data freshness metrics
CREATE OR REPLACE VIEW data_freshness AS
SELECT
    MAX(synced_at) as last_data_sync,
    COUNT(DISTINCT distinct_id) as total_users,
    NOW() - MAX(synced_at) as time_since_last_sync
FROM subscribers_insights;

-- ============================================================================
-- Comments for documentation
-- ============================================================================

COMMENT ON TABLE subscribers_insights IS 'User profile data with demographics and behavioral metrics from Mixpanel';
COMMENT ON TABLE time_funnels IS 'Time-based funnel data tracking user conversion times';
COMMENT ON TABLE sync_logs IS 'Audit log of data synchronization operations';
COMMENT ON MATERIALIZED VIEW main_analysis IS 'Pre-computed view joining subscribers and time funnels for analysis';

COMMENT ON COLUMN subscribers_insights.distinct_id IS 'Mixpanel distinct_id, primary user identifier';
COMMENT ON COLUMN time_funnels.time_in_seconds IS 'Raw time value from Mixpanel in seconds';
COMMENT ON COLUMN time_funnels.time_in_days IS 'Computed time value in days (seconds / 86400)';

-- ============================================================================
-- Grant permissions (adjust based on your setup)
-- ============================================================================

-- Grant usage to authenticated users
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Grant full access to service role
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- ============================================================================
-- End of schema
-- ============================================================================
