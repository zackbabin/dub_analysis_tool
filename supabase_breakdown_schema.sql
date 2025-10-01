-- ============================================================================
-- Breakdown Data Schema for Creator Analysis
-- Stores subscription pricing and portfolio copy data for visualizations
-- ============================================================================

-- ============================================================================
-- Table 1: creator_subscriptions_by_price
-- Stores subscription events by price and interval for distribution chart
-- ============================================================================

CREATE TABLE IF NOT EXISTS creator_subscriptions_by_price (
    id BIGSERIAL PRIMARY KEY,
    creator_id TEXT,
    subscription_price NUMERIC,
    subscription_interval TEXT,
    monthly_price NUMERIC GENERATED ALWAYS AS (
        CASE subscription_interval
            WHEN 'Quarterly' THEN subscription_price / 3
            WHEN 'Annual' THEN subscription_price / 12
            ELSE subscription_price
        END
    ) STORED,
    subscription_count INTEGER DEFAULT 0,
    total_subscriptions INTEGER DEFAULT 0,
    total_paywall_views INTEGER DEFAULT 0,
    total_profile_views INTEGER DEFAULT 0,
    total_stripe_views INTEGER DEFAULT 0,
    synced_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT unique_subscription_per_sync UNIQUE (creator_id, subscription_price, subscription_interval, synced_at)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_synced_at ON creator_subscriptions_by_price(synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscriptions_monthly_price ON creator_subscriptions_by_price(monthly_price);

-- ============================================================================
-- Table 2: creator_portfolio_copies
-- Stores portfolio copy events by creator and portfolio for top 10 charts
-- ============================================================================

CREATE TABLE IF NOT EXISTS creator_portfolio_copies (
    id BIGSERIAL PRIMARY KEY,
    creator_id TEXT,
    creator_username TEXT,
    portfolio_ticker TEXT,
    copy_count INTEGER DEFAULT 0,
    total_copies INTEGER DEFAULT 0,
    total_pdp_views INTEGER DEFAULT 0,
    total_profile_views INTEGER DEFAULT 0,
    synced_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT unique_portfolio_copy_per_sync UNIQUE (creator_id, portfolio_ticker, synced_at)
);

CREATE INDEX IF NOT EXISTS idx_portfolio_copies_synced_at ON creator_portfolio_copies(synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_portfolio_copies_creator ON creator_portfolio_copies(creator_username);
CREATE INDEX IF NOT EXISTS idx_portfolio_copies_ticker ON creator_portfolio_copies(portfolio_ticker);
CREATE INDEX IF NOT EXISTS idx_portfolio_copies_count ON creator_portfolio_copies(copy_count DESC);

-- ============================================================================
-- Views for latest data
-- ============================================================================

-- View: Latest subscription price distribution (normalized monthly)
CREATE OR REPLACE VIEW latest_subscription_distribution AS
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
CREATE OR REPLACE VIEW top_creators_by_portfolio_copies AS
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
CREATE OR REPLACE VIEW top_portfolios_by_copies AS
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

-- ============================================================================
-- RLS Policies
-- ============================================================================

ALTER TABLE creator_subscriptions_by_price ENABLE ROW LEVEL SECURITY;
ALTER TABLE creator_portfolio_copies ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read
CREATE POLICY "Allow authenticated read access to creator_subscriptions_by_price"
    ON creator_subscriptions_by_price FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Allow authenticated read access to creator_portfolio_copies"
    ON creator_portfolio_copies FOR SELECT
    TO authenticated
    USING (true);

-- Allow service role full access
CREATE POLICY "Allow service role full access to creator_subscriptions_by_price"
    ON creator_subscriptions_by_price FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow service role full access to creator_portfolio_copies"
    ON creator_portfolio_copies FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE creator_subscriptions_by_price IS 'Subscription events by price and interval, with auto-calculated monthly normalization';
COMMENT ON TABLE creator_portfolio_copies IS 'Portfolio copy events by creator and ticker for top 10 visualizations';
COMMENT ON COLUMN creator_subscriptions_by_price.monthly_price IS 'Normalized monthly price: Quarterly/3, Annual/12, Monthly as-is';

-- ============================================================================
-- End of breakdown schema
-- ============================================================================
