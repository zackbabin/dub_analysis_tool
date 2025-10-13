-- Update creator_analysis view to merge Mixpanel metrics into raw_data
-- This ensures all metrics from creators_insights are available for correlation analysis
-- Uses creator_uploads table (not uploaded_creators which was deprecated)

DROP VIEW IF EXISTS creator_analysis CASCADE;

CREATE OR REPLACE VIEW creator_analysis AS
SELECT
    cu.id,
    cu.creator_username,
    cu.email,
    COALESCE((cu.raw_data->>'type')::text, 'Regular') as type,

    -- Extract total_copies and total_subscriptions from raw_data or default to 0
    COALESCE((cu.raw_data->>'total_copies')::integer, 0) as total_copies,
    COALESCE((cu.raw_data->>'total_subscriptions')::integer, 0) as total_subscriptions,

    -- Merge uploaded raw_data with Mixpanel metrics from creators_insights
    -- All Mixpanel columns (except email) will be added to raw_data JSONB
    CASE
        WHEN ci.email IS NOT NULL THEN
            cu.raw_data || jsonb_build_object(
                'total_deposits', ci.total_deposits,
                'active_created_portfolios', ci.active_created_portfolios,
                'lifetime_created_portfolios', ci.lifetime_created_portfolios,
                'total_trades', ci.total_trades,
                'investing_activity', ci.investing_activity,
                'investing_experience_years', ci.investing_experience_years,
                'investing_objective', ci.investing_objective,
                'investment_type', ci.investment_type
            )
        ELSE
            cu.raw_data
    END as raw_data
FROM creator_uploads cu
LEFT JOIN creators_insights ci ON LOWER(TRIM(cu.email)) = LOWER(TRIM(ci.email))
WHERE cu.uploaded_at = (SELECT MAX(uploaded_at) FROM creator_uploads);

COMMENT ON VIEW creator_analysis IS 'Merges uploaded creator data with Mixpanel metrics for correlation analysis';

-- Also remove redundant creator_username column from creators_insights
ALTER TABLE creators_insights DROP COLUMN IF EXISTS creator_username;
