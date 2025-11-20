-- Migration: Add creator_type column to event_sequences_raw
-- Date: 2025-11-20
-- Purpose: Store creatorType property from Mixpanel Export API to distinguish premium vs regular events

-- Add creator_type column to store the creatorType property from Mixpanel events
ALTER TABLE event_sequences_raw
ADD COLUMN IF NOT EXISTS creator_type text;

-- Add index on creator_type for efficient filtering
CREATE INDEX IF NOT EXISTS idx_event_sequences_raw_creator_type
ON event_sequences_raw (creator_type)
WHERE creator_type IS NOT NULL;

-- Add comment
COMMENT ON COLUMN event_sequences_raw.creator_type IS 'Creator type from Mixpanel event properties (e.g., "premiumCreator", "regularCreator"). Used to distinguish premium vs regular events.';
