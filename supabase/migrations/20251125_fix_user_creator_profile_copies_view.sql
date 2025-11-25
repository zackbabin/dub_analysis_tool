-- Migration: Fix user_creator_profile_copies view to use user_id
-- Created: 2025-11-25
-- Purpose: Update view after renaming distinct_id → user_id in engagement tables
--
-- Background:
-- - 20251125_rename_distinct_id_to_user_id_engagement renamed columns
-- - This view still references distinct_id, needs to use user_id
-- - Also needs to include synced_at from user_creator_engagement

CREATE OR REPLACE VIEW user_creator_profile_copies AS
SELECT
    uce.user_id,              -- Updated from distinct_id
    uce.creator_id,
    uce.creator_username,
    uce.profile_view_count,
    COALESCE(agg.did_copy, false) AS did_copy,
    COALESCE(agg.copy_count, 0) AS copy_count,
    uce.synced_at             -- Include synced_at from user_creator_engagement
FROM user_creator_engagement uce
LEFT JOIN (
    SELECT
        user_id,              -- Updated from distinct_id
        creator_id,
        MAX(CASE WHEN did_copy THEN 1 ELSE 0 END)::boolean AS did_copy,
        SUM(copy_count)::integer AS copy_count
    FROM user_portfolio_creator_engagement
    GROUP BY user_id, creator_id  -- Updated from distinct_id
) agg ON uce.user_id = agg.user_id AND uce.creator_id = agg.creator_id;

COMMENT ON VIEW user_creator_profile_copies IS
'Creator-level engagement with copy behavior aggregated across all portfolios by that creator.
Used for analyzing which creator profile view combinations drive copies.
Updated to use user_id column instead of distinct_id.';

-- Log the changes
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Updated user_creator_profile_copies view';
  RAISE NOTICE '   - Changed distinct_id → user_id throughout';
  RAISE NOTICE '   - Maintained synced_at column from user_creator_engagement';
  RAISE NOTICE '';
END $$;
