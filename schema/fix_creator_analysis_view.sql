-- Fix creator_analysis view to read from uploaded_creators instead of creators_insights
-- This ensures the view shows the manually uploaded CSV data with correct raw_data

DROP VIEW IF EXISTS creator_analysis;

CREATE OR REPLACE VIEW creator_analysis AS
SELECT
    creator_id,
    creator_username,
    'Regular'::text as creator_type,  -- Default type for uploaded creators
    0 as total_profile_views,
    0 as total_pdp_views,
    0 as total_paywall_views,
    0 as total_stripe_views,
    total_subscriptions,
    0 as total_subscription_revenue,
    0 as total_cancelled_subscriptions,
    0 as total_expired_subscriptions,
    total_copies,
    0 as total_investment_count,
    0 as total_investments,
    raw_data
FROM uploaded_creators
WHERE uploaded_at = (SELECT MAX(uploaded_at) FROM uploaded_creators);

COMMENT ON VIEW creator_analysis IS 'Shows the most recent batch of manually uploaded creator data';

SELECT 'creator_analysis view now points to uploaded_creators' as status;
