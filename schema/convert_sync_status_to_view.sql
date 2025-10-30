-- Convert latest_sync_status_mv from materialized view to regular view
-- Materialized view is unnecessary for this small table

-- Drop the materialized view
DROP MATERIALIZED VIEW IF EXISTS latest_sync_status_mv CASCADE;

-- Create regular view with same logic
CREATE OR REPLACE VIEW latest_sync_status AS
SELECT DISTINCT ON (tool_type)
    id,
    tool_type,
    sync_started_at,
    sync_completed_at,
    sync_status,
    subscribers_fetched,
    total_records_inserted,
    duration_seconds,
    error_message,
    error_details,
    source,
    triggered_by
FROM sync_logs
ORDER BY tool_type, sync_started_at DESC;
