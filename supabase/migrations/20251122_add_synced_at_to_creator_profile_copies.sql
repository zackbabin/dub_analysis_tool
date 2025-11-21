-- Migration: Add synced_at to user_creator_profile_copies view
-- Created: 2025-11-22
-- Purpose: Fix analyze-conversion-patterns error: column synced_at does not exist
--
-- Issue: user_creator_profile_copies view missing synced_at column
-- The copy combinations (user_portfolio_creator_copies) has synced_at and works correctly
-- The creator-copy combinations (user_creator_profile_copies) needs the same column

CREATE OR REPLACE VIEW user_creator_profile_copies AS
SELECT
    uce.distinct_id,
    uce.creator_id,
    uce.creator_username,
    uce.profile_view_count,
    COALESCE(agg.did_copy, false) AS did_copy,
    COALESCE(agg.copy_count, 0) AS copy_count,
    uce.synced_at  -- Add synced_at from user_creator_engagement
FROM user_creator_engagement uce
LEFT JOIN (
    SELECT
        distinct_id,
        creator_id,
        MAX(CASE WHEN did_copy THEN 1 ELSE 0 END)::boolean AS did_copy,
        SUM(copy_count)::integer AS copy_count
    FROM user_portfolio_creator_engagement
    GROUP BY distinct_id, creator_id
) agg ON uce.distinct_id = agg.distinct_id AND uce.creator_id = agg.creator_id;

COMMENT ON VIEW user_creator_profile_copies IS
'Creator-level engagement with copy aggregation.
Combines profile views from user_creator_engagement with portfolio copy data.
Used by analyze-conversion-patterns for creator_copy analysis.';

-- Grant permissions
GRANT SELECT ON user_creator_profile_copies TO anon;
GRANT SELECT ON user_creator_profile_copies TO authenticated;
GRANT SELECT ON user_creator_profile_copies TO service_role;
