-- Migration: Update creator_subscriptions_by_price table structure
-- Changes from aggregated-by-price to per-creator rows
-- This allows proper aggregation in the view and correct chart display

-- Drop the old table and view
DROP VIEW IF EXISTS latest_subscription_distribution CASCADE;
DROP TABLE IF EXISTS creator_subscriptions_by_price CASCADE;

-- Recreate table with new structure (one row per creator)
CREATE TABLE creator_subscriptions_by_price (
    id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    creator_id text NOT NULL,
    creator_username text,
    subscription_price numeric,
    subscription_interval text,
    total_subscriptions integer,
    total_paywall_views integer,
    synced_at timestamp with time zone
);

-- Create index for efficient queries
CREATE INDEX idx_creator_subscriptions_by_price_synced_at ON creator_subscriptions_by_price(synced_at);
CREATE INDEX idx_creator_subscriptions_by_price_creator_id ON creator_subscriptions_by_price(creator_id);

-- Recreate the view to aggregate by price
CREATE OR REPLACE VIEW latest_subscription_distribution AS
SELECT
    subscription_price as monthly_price,
    SUM(total_subscriptions)::bigint as total_subscriptions,
    SUM(total_paywall_views)::bigint as total_paywall_views,
    array_agg(creator_username ORDER BY creator_username) as creator_usernames
FROM creator_subscriptions_by_price
WHERE synced_at = (SELECT MAX(synced_at) FROM creator_subscriptions_by_price)
GROUP BY subscription_price
ORDER BY subscription_price;

-- Verify the migration
SELECT
    'Migration completed successfully' as status,
    COUNT(*) as total_rows
FROM creator_subscriptions_by_price;
