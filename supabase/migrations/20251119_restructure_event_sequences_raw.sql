-- Migration: Restructure event_sequences_raw to store individual events
-- This changes from storing one row per user (with all events in JSONB)
-- to storing one row per individual event (allowing the table to grow as new events stream in)

-- Step 1: Add new columns for individual event storage
ALTER TABLE event_sequences_raw
ADD COLUMN IF NOT EXISTS event_name text,
ADD COLUMN IF NOT EXISTS event_time timestamp with time zone,
ADD COLUMN IF NOT EXISTS event_count integer DEFAULT 1,
ADD COLUMN IF NOT EXISTS portfolio_ticker text,
ADD COLUMN IF NOT EXISTS creator_username text;

-- Step 2: Make event_data nullable (backwards compatibility during migration)
ALTER TABLE event_sequences_raw
ALTER COLUMN event_data DROP NOT NULL;

-- Step 3: Remove unique constraint on distinct_id (if exists)
-- This allows multiple rows per user (one per event)
DO $$
BEGIN
    -- Drop the unique constraint if it exists
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'event_sequences_raw_distinct_id_key'
        AND conrelid = 'event_sequences_raw'::regclass
    ) THEN
        ALTER TABLE event_sequences_raw DROP CONSTRAINT event_sequences_raw_distinct_id_key;
    END IF;
END $$;

-- Step 4: Add composite unique constraint for deduplication
-- Ensures we don't insert duplicate events for same user at same time
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_sequences_raw_dedup
ON event_sequences_raw (distinct_id, event_name, event_time)
WHERE event_name IS NOT NULL AND event_time IS NOT NULL;

-- Step 5: Add index on synced_at for efficient queries
CREATE INDEX IF NOT EXISTS idx_event_sequences_raw_synced_at
ON event_sequences_raw (synced_at DESC);

-- Step 6: Add index on event_name for filtering
CREATE INDEX IF NOT EXISTS idx_event_sequences_raw_event_name
ON event_sequences_raw (event_name)
WHERE event_name IS NOT NULL;

-- Note: Existing data in event_data column is preserved
-- New inserts will use event_name, event_time, event_count columns
-- Old data can be migrated separately if needed
