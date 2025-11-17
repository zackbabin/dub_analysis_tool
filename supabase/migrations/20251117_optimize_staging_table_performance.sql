-- Optimize staging table for maximum insert performance
-- Date: 2025-11-17

-- Make staging table UNLOGGED for much faster inserts
-- This is safe because:
-- 1. It's a temporary staging table
-- 2. Data is cleared after processing
-- 3. If database crashes, we can just re-run the sync
-- UNLOGGED = no WAL writes = 2-3x faster inserts

ALTER TABLE raw_mixpanel_events_staging SET UNLOGGED;

-- Drop indexes during staging, recreate after processing if needed
-- Indexes slow down inserts significantly
DROP INDEX IF EXISTS idx_staging_distinct_id;
DROP INDEX IF EXISTS idx_staging_event_name;

-- Add comments
COMMENT ON TABLE raw_mixpanel_events_staging IS
'UNLOGGED staging table for raw Mixpanel events. Optimized for fast bulk inserts.
No indexes for maximum insert performance. Data is temporary and cleared after processing.';

-- Note: If you need to query this table for debugging, you can add indexes manually:
-- CREATE INDEX idx_staging_distinct_id ON raw_mixpanel_events_staging(distinct_id);
-- CREATE INDEX idx_staging_event_name ON raw_mixpanel_events_staging(event_name);
