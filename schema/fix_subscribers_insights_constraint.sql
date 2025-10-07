-- Fix subscribers_insights to use distinct_id as unique key
-- This ensures one row per user that gets updated on each sync

-- Step 1: Identify and review duplicates (informational query)
SELECT
    distinct_id,
    COUNT(*) as duplicate_count,
    MIN(id) as oldest_id,
    MAX(id) as newest_id,
    MAX(updated_at) as most_recent_update,
    MAX(synced_at) as most_recent_sync
FROM subscribers_insights
GROUP BY distinct_id
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC
LIMIT 20;

-- Step 2: Keep only the most recent row for each distinct_id (highest id = most recent)
-- This will delete all duplicates except the newest one
WITH duplicates AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY distinct_id
            ORDER BY id DESC  -- Keep highest ID (most recent)
        ) as rn
    FROM subscribers_insights
)
DELETE FROM subscribers_insights
WHERE id IN (
    SELECT id
    FROM duplicates
    WHERE rn > 1
);

-- Step 3: Verify no duplicates remain (should return 0 rows)
SELECT
    distinct_id,
    COUNT(*) as count
FROM subscribers_insights
GROUP BY distinct_id
HAVING COUNT(*) > 1;

-- Step 4: Now add the unique constraint
ALTER TABLE subscribers_insights
DROP CONSTRAINT IF EXISTS subscribers_insights_unique_key;

ALTER TABLE subscribers_insights
ADD CONSTRAINT subscribers_insights_unique_key
UNIQUE (distinct_id);

-- Step 5: Update comments
COMMENT ON TABLE subscribers_insights IS
'User-level behavioral and demographic data from Mixpanel.
Each row represents a unique user (distinct_id) and is updated on each sync.
The updated_at timestamp tracks when the user''s data was last refreshed.';

COMMENT ON COLUMN subscribers_insights.synced_at IS
'Timestamp when this user record was first created in the database';

COMMENT ON COLUMN subscribers_insights.updated_at IS
'Timestamp when this user record was last updated from Mixpanel';

-- Step 6: Verify final state
SELECT
    'Total unique users' as metric,
    COUNT(DISTINCT distinct_id) as value
FROM subscribers_insights
UNION ALL
SELECT
    'Total rows' as metric,
    COUNT(*) as value
FROM subscribers_insights;
