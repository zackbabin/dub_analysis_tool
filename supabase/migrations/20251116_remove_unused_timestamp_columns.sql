-- Remove unused timestamp columns from subscribers_insights
-- first_event_time and last_event_time are stored but never queried
-- Removing them saves storage and eliminates unnecessary CPU computation
-- Date: 2025-11-16

ALTER TABLE subscribers_insights
DROP COLUMN IF EXISTS first_event_time,
DROP COLUMN IF EXISTS last_event_time;

COMMENT ON TABLE subscribers_insights IS
'User event metrics and properties. Removed first_event_time and last_event_time columns (unused).';
