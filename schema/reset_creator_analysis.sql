-- Reset Creator Analysis Tables and Views
-- Run this to flush old data and recreate with proper structure

-- Step 1: Drop dependent materialized view
DROP MATERIALIZED VIEW IF EXISTS creator_analysis CASCADE;

-- Step 2: Drop and recreate creators_insights table
DROP TABLE IF EXISTS creators_insights CASCADE;

CREATE TABLE creators_insights (
    id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    creator_id text NOT NULL,
    creator_username text UNIQUE NOT NULL,
    creator_type text DEFAULT 'Regular',
    raw_data jsonb DEFAULT '{}'::jsonb,
    -- Metrics from Mixpanel sync (enriched data)
    total_profile_views integer DEFAULT 0,
    total_pdp_views integer DEFAULT 0,
    total_paywall_views integer DEFAULT 0,
    total_stripe_views integer DEFAULT 0,
    total_subscriptions integer DEFAULT 0,
    total_subscription_revenue numeric DEFAULT 0,
    total_cancelled_subscriptions integer DEFAULT 0,
    total_expired_subscriptions integer DEFAULT 0,
    total_copies integer DEFAULT 0,
    total_investment_count integer DEFAULT 0,
    total_investments numeric DEFAULT 0,
    synced_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT NOW()
);

-- Step 3: Create indexes
CREATE INDEX idx_creators_insights_creator_username ON creators_insights(creator_username);
CREATE INDEX idx_creators_insights_creator_id ON creators_insights(creator_id);
CREATE INDEX idx_creators_insights_raw_data_gin ON creators_insights USING gin(raw_data);

-- Step 4: Recreate creator_analysis view (for backward compatibility)
CREATE OR REPLACE VIEW creator_analysis AS
SELECT
    creator_id,
    creator_username,
    creator_type,
    total_profile_views,
    total_pdp_views,
    total_paywall_views,
    total_stripe_views,
    total_subscriptions,
    total_subscription_revenue,
    total_cancelled_subscriptions,
    total_expired_subscriptions,
    total_copies,
    total_investment_count,
    total_investments,
    raw_data
FROM creators_insights;

SELECT 'Creator analysis tables reset successfully' as status;
