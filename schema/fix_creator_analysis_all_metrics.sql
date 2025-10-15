-- Fix creator_analysis view to include ALL 12 Mixpanel metrics in raw_data JSONB
-- and aggregate total_copies from user_creator_copies table

CREATE OR REPLACE VIEW creator_analysis AS
SELECT
    cu.id,
    cu.creator_username,
    cu.email,
    COALESCE((cu.raw_data->>'type')::text, 'Regular') as type,

    -- Aggregate total_copies from user_creator_copies table
    COALESCE(ucc_agg.total_copies, 0)::integer as total_copies,

    -- Extract total_subscriptions from raw_data
    COALESCE((cu.raw_data->>'total_subscriptions')::integer, 0) as total_subscriptions,

    -- Merge all 12 Mixpanel metrics into raw_data JSONB
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
                'investment_type', ci.investment_type,
                'total_rebalances', ci.total_rebalances,
                'total_sessions', ci.total_sessions,
                'total_leaderboard_views', ci.total_leaderboard_views
            )
        ELSE
            cu.raw_data
    END as raw_data
FROM creator_uploads cu
LEFT JOIN creators_insights ci ON LOWER(TRIM(cu.email)) = LOWER(TRIM(ci.email))
LEFT JOIN (
    SELECT
        creator_username,
        SUM(copy_count) as total_copies
    FROM user_creator_copies
    GROUP BY creator_username
) ucc_agg ON cu.creator_username = ucc_agg.creator_username
WHERE cu.uploaded_at = (SELECT MAX(uploaded_at) FROM creator_uploads);

COMMENT ON VIEW creator_analysis IS 'Merges uploaded creator data with all 12 Mixpanel metrics and total_copies for correlation analysis';
