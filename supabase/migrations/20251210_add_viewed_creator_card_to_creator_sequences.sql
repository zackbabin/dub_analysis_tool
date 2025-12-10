-- Migration: Add support for "Viewed Creator Card" events in creator_sequences_raw
-- Created: 2025-12-10
-- Purpose: Track both "Viewed Creator Profile" and "Viewed Creator Card" events
--          Update unique constraint to allow both event types for same user/time/creator

-- Drop old unique index (doesn't include event_name)
DROP INDEX IF EXISTS idx_creator_sequences_raw_unique;

-- Create new unique index that includes event_name
-- This allows both "Viewed Creator Profile" and "Viewed Creator Card" for same user/time/creator
CREATE UNIQUE INDEX idx_creator_sequences_raw_unique
ON creator_sequences_raw (user_id, event_name, event_time, creator_username);

-- Update view to ensure it still works (no schema change needed, just refresh)
DROP VIEW IF EXISTS creator_sequences;

CREATE VIEW creator_sequences AS
SELECT
  cs.id,
  cs.user_id,
  cs.event_name,
  cs.event_time,
  cs.creator_username,
  fc.first_copy_time
FROM creator_sequences_raw cs
LEFT JOIN user_first_copies fc ON cs.user_id = fc.user_id;

-- Update comments
COMMENT ON INDEX idx_creator_sequences_raw_unique IS
'Ensures uniqueness for creator events on (user_id, event_name, event_time, creator_username). Includes event_name to allow both Viewed Profile and Viewed Card events for same creator/time.';

COMMENT ON VIEW creator_sequences IS
'Creator view events joined with first_copy_time. Includes both "Viewed Creator Profile" and "Viewed Creator Card" events.
Filter pre-copy events: WHERE event_time < first_copy_time';

-- Log migration
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Updated creator_sequences_raw unique constraint to include event_name';
  RAISE NOTICE '   - Allows both "Viewed Creator Profile" and "Viewed Creator Card"';
  RAISE NOTICE '   - Same user can view same creator at same time via different paths';
  RAISE NOTICE '✅ Recreated creator_sequences view';
  RAISE NOTICE '';
END $$;
