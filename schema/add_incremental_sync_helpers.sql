-- Helper functions for incremental sync of portfolio_view_events
-- These functions track the last synced event timestamp to enable incremental fetching

-- Function to get the last successfully synced event timestamp
-- Returns the most recent event_time (Unix timestamp) from portfolio_view_events
-- If no events exist, returns NULL (will trigger full sync)
CREATE OR REPLACE FUNCTION get_last_portfolio_event_timestamp()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  last_event_time bigint;
BEGIN
  SELECT MAX(event_time) INTO last_event_time
  FROM portfolio_view_events;

  RETURN last_event_time;
END;
$$;

-- Function to get the last successful sync timestamp for a given source
-- Used to determine if we should do incremental or full sync
CREATE OR REPLACE FUNCTION get_last_successful_sync_time(source_name text)
RETURNS timestamp with time zone
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  last_sync_time timestamp with time zone;
BEGIN
  SELECT MAX(sync_completed_at) INTO last_sync_time
  FROM sync_logs
  WHERE source = source_name
    AND sync_status = 'completed';

  RETURN last_sync_time;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_last_portfolio_event_timestamp() TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION get_last_successful_sync_time(text) TO authenticated, anon, service_role;

-- Add comments for documentation
COMMENT ON FUNCTION get_last_portfolio_event_timestamp() IS
'Returns the most recent event_time (Unix timestamp) from portfolio_view_events table.
Used by sync-mixpanel-portfolio-events to determine the starting point for incremental sync.
Returns NULL if no events exist, triggering a full sync.';

COMMENT ON FUNCTION get_last_successful_sync_time(text) IS
'Returns the timestamp of the last successful sync for a given source.
Used to implement incremental sync logic and fallback strategies.';
