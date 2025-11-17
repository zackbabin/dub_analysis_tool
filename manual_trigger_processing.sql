-- Manual trigger script to process staged events
-- Run this after sync-mixpanel-user-events times out and leaves data in staging table

-- Option 1: Call the processing function directly via SQL
-- This processes all events in the staging table
SELECT process_raw_events_to_profiles(now());

-- Option 2: Check what's in staging first
SELECT
  COUNT(*) as total_events,
  COUNT(DISTINCT distinct_id) as unique_users,
  MIN(event_time) as earliest_event,
  MAX(event_time) as latest_event
FROM raw_mixpanel_events_staging;

-- After running process_raw_events_to_profiles, clear the staging table
SELECT clear_events_staging();
