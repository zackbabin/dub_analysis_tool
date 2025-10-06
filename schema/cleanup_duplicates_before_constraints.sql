-- Cleanup Duplicates Before Adding Constraints
-- Run this ONLY if the safety checks in add_missing_unique_constraints.sql found duplicates

-- ===========================================================================
-- BACKUP FIRST (Recommended)
-- ===========================================================================

-- Create backup tables
CREATE TABLE time_funnels_backup AS SELECT * FROM time_funnels;
CREATE TABLE subscribers_insights_backup AS SELECT * FROM subscribers_insights;

-- ===========================================================================
-- CLEANUP time_funnels duplicates
-- ===========================================================================

-- Keep the row with the highest ID (most recent) for each duplicate group
WITH duplicates AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY distinct_id, funnel_type, synced_at
            ORDER BY id DESC
        ) as rn
    FROM time_funnels
)
DELETE FROM time_funnels
WHERE id IN (
    SELECT id FROM duplicates WHERE rn > 1
);

-- Report how many were deleted
DO $$
DECLARE
    deleted_count INTEGER;
BEGIN
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RAISE NOTICE 'Deleted % duplicate rows from time_funnels', deleted_count;
END $$;

-- ===========================================================================
-- CLEANUP subscribers_insights duplicates
-- ===========================================================================

-- Keep the row with the highest ID (most recent) for each duplicate group
WITH duplicates AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY distinct_id, synced_at
            ORDER BY id DESC
        ) as rn
    FROM subscribers_insights
)
DELETE FROM subscribers_insights
WHERE id IN (
    SELECT id FROM duplicates WHERE rn > 1
);

-- Report how many were deleted
DO $$
DECLARE
    deleted_count INTEGER;
BEGIN
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RAISE NOTICE 'Deleted % duplicate rows from subscribers_insights', deleted_count;
END $$;

-- ===========================================================================
-- VERIFICATION
-- ===========================================================================

-- Verify no duplicates remain in time_funnels
SELECT
    CASE
        WHEN COUNT(*) = 0 THEN 'OK: No duplicates in time_funnels'
        ELSE 'ERROR: Still has duplicates in time_funnels'
    END as status
FROM (
    SELECT distinct_id, funnel_type, synced_at, COUNT(*) as cnt
    FROM time_funnels
    GROUP BY distinct_id, funnel_type, synced_at
    HAVING COUNT(*) > 1
) duplicates;

-- Verify no duplicates remain in subscribers_insights
SELECT
    CASE
        WHEN COUNT(*) = 0 THEN 'OK: No duplicates in subscribers_insights'
        ELSE 'ERROR: Still has duplicates in subscribers_insights'
    END as status
FROM (
    SELECT distinct_id, synced_at, COUNT(*) as cnt
    FROM subscribers_insights
    GROUP BY distinct_id, synced_at
    HAVING COUNT(*) > 1
) duplicates;

-- After verification, you can drop the backup tables if everything looks good:
-- DROP TABLE time_funnels_backup;
-- DROP TABLE subscribers_insights_backup;
