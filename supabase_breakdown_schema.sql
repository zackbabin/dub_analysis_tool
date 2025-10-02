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
    total_subscriptions INTEGER DEFAULT 0,
    synced_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT unique_subscription_per_sync UNIQUE (creator_id, subscription_price, subscription_interval, synced_at)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_synced_at ON creator_subscriptions_by_price(synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscriptions_price ON creator_subscriptions_by_price(subscription_price);

-- ============================================================================
-- Table 2: creator_portfolio_copies
-- Stores portfolio copy events by creator and portfolio for top 10 charts
-- ============================================================================

CREATE TABLE IF NOT EXISTS creator_portfolio_copies (
    id BIGSERIAL PRIMARY KEY,
    creator_id TEXT,
    creator_username TEXT,
    portfolio_ticker TEXT,
    total_copies INTEGER DEFAULT 0,
    total_pdp_views INTEGER DEFAULT 0,
    total_profile_views INTEGER DEFAULT 0,
    synced_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT unique_portfolio_copy_per_sync UNIQUE (creator_id, portfolio_ticker, synced_at)
);

CREATE INDEX IF NOT EXISTS idx_portfolio_copies_synced_at ON creator_portfolio_copies(synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_portfolio_copies_creator ON creator_portfolio_copies(creator_username);
CREATE INDEX IF NOT EXISTS idx_portfolio_copies_ticker ON creator_portfolio_copies(portfolio_ticker);
CREATE INDEX IF NOT EXISTS idx_portfolio_copies_count ON creator_portfolio_copies(total_copies DESC);

-- ============================================================================
-- Views for latest data
-- ============================================================================

-- Drop existing views to recreate with correct structure
DROP VIEW IF EXISTS latest_subscription_distribution;
DROP VIEW IF EXISTS top_creators_by_portfolio_copies;
DROP VIEW IF EXISTS top_portfolios_by_copies;

-- View: Latest subscription price distribution (normalized monthly)
CREATE VIEW latest_subscription_distribution AS
SELECT
    ROUND(
        CASE subscription_interval
            WHEN 'Quarterly' THEN subscription_price / 3
            WHEN 'Annual' THEN subscription_price / 12
            WHEN 'Annually' THEN subscription_price / 12
            ELSE subscription_price
        END,
        2
    ) as monthly_price,
    SUM(total_subscriptions) as total_subscriptions
FROM creator_subscriptions_by_price
WHERE synced_at = (SELECT MAX(synced_at) FROM creator_subscriptions_by_price)
GROUP BY monthly_price
ORDER BY monthly_price;

-- View: Top 10 creators by portfolio copies
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
-- RLS Policies
-- ============================================================================

ALTER TABLE creator_subscriptions_by_price ENABLE ROW LEVEL SECURITY;
ALTER TABLE creator_portfolio_copies ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to recreate
DROP POLICY IF EXISTS "Allow authenticated read access to creator_subscriptions_by_price" ON creator_subscriptions_by_price;
DROP POLICY IF EXISTS "Allow authenticated read access to creator_portfolio_copies" ON creator_portfolio_copies;
DROP POLICY IF EXISTS "Allow service role full access to creator_subscriptions_by_price" ON creator_subscriptions_by_price;
DROP POLICY IF EXISTS "Allow service role full access to creator_portfolio_copies" ON creator_portfolio_copies;

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
