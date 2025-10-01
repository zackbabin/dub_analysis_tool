-- ============================================================================
-- Database Cleanup Script
-- Removes unused creator tables and consolidates sync tracking
-- ============================================================================

-- Step 1: Drop unused creator tables
DROP TABLE IF EXISTS creator_portfolios CASCADE;
DROP TABLE IF EXISTS creator_profile_conversions CASCADE;

-- Step 2: Add tool_type column to sync_logs to track both User and Creator syncs
ALTER TABLE sync_logs
ADD COLUMN IF NOT EXISTS tool_type TEXT DEFAULT 'user' CHECK (tool_type IN ('user', 'creator'));

-- Step 3: Drop old separate creator sync status view
DROP VIEW IF EXISTS latest_creator_sync_status CASCADE;

-- Step 4: Update latest_sync_status view to handle both tools
DROP VIEW IF EXISTS latest_sync_status CASCADE;

CREATE OR REPLACE VIEW latest_sync_status AS
SELECT
    tool_type,
    sync_started_at,
    sync_completed_at,
    sync_status,
    subscribers_fetched,
    time_funnels_fetched,
    total_records_inserted,
    duration_seconds,
    error_message
FROM sync_logs
WHERE (tool_type, sync_started_at) IN (
    SELECT tool_type, MAX(sync_started_at)
    FROM sync_logs
    GROUP BY tool_type
)
ORDER BY tool_type;

-- Step 5: Add comments for documentation
COMMENT ON COLUMN sync_logs.tool_type IS 'Type of analysis tool: user or creator';
COMMENT ON VIEW latest_sync_status IS 'Shows latest sync status for both User and Creator analysis tools';

-- ============================================================================
-- Summary of changes:
-- ============================================================================
-- ✅ Removed: creator_portfolios table (unused)
-- ✅ Removed: creator_profile_conversions table (unused)
-- ✅ Removed: latest_creator_sync_status view (replaced)
-- ✅ Updated: sync_logs table to track both tools
-- ✅ Updated: latest_sync_status view to show both tools
-- ============================================================================
