-- Migration: Fix user_creator_profile_copies to use correct data source
-- Created: 2025-11-23
-- Purpose: Make creator-copy analysis work the same way as portfolio-copy analysis
--
-- Issue: user_creator_profile_copies was trying to use user_creator_engagement (empty table)
-- Solution: Use user_portfolio_creator_engagement and aggregate by creator, similar to portfolio view

CREATE OR REPLACE VIEW user_creator_profile_copies AS
SELECT
    upce.distinct_id,
    upce.creator_id,
    upce.creator_username,
    SUM(upce.pdp_view_count)::integer AS profile_view_count,  -- Aggregate PDP views across all portfolios for this creator
    MAX(CASE WHEN upce.copy_count > 0 THEN 1 ELSE 0 END)::boolean AS did_copy,  -- User copied ANY portfolio from this creator
    SUM(upce.copy_count)::integer AS copy_count,  -- Total copies across all portfolios for this creator
    MAX(upce.synced_at)::timestamp AS synced_at  -- Use most recent sync time (cast to match existing column type)
FROM user_portfolio_creator_engagement upce
GROUP BY upce.distinct_id, upce.creator_id, upce.creator_username;

COMMENT ON VIEW user_creator_profile_copies IS
'Creator-level engagement with copy aggregation.
Aggregates user_portfolio_creator_engagement by creator to analyze which CREATOR combinations drive copies.
Mirrors the structure of user_portfolio_creator_copies but aggregates by creator instead of portfolio.
Used by analyze-conversion-patterns for creator_copy analysis.';

-- Grant permissions
GRANT SELECT ON user_creator_profile_copies TO anon;
GRANT SELECT ON user_creator_profile_copies TO authenticated;
GRANT SELECT ON user_creator_profile_copies TO service_role;
