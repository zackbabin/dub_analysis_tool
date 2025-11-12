-- Drop unused latest_sync_status view
-- This view is not being used anywhere in the codebase
-- We use sync_logs directly via getMostRecentMixpanelSyncTime() instead
-- Date: 2025-11-12

DROP VIEW IF EXISTS latest_sync_status CASCADE;

COMMENT ON SCHEMA public IS 'Dropped latest_sync_status view - unused legacy code. Using sync_logs directly for timestamps.';
