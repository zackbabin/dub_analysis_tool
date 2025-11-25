-- Migration: Add user_id column to event sequences tables
-- Created: 2025-11-25
-- Purpose: Support dual-tracking of distinct_id (legacy, for joins) and user_id (new Mixpanel identifier)
--
-- Background:
-- - Mixpanel charts now return $user_id instead of distinct_id
-- - Event sequences workflow needs to maintain distinct_id for existing joins
-- - user_id provides new clean identifier without $device: prefix issues
--
-- Strategy:
-- 1. Add user_id column to both event sequences tables
-- 2. Keep distinct_id for backward compatibility and joins
-- 3. Populate both columns from now on

-- Add user_id column to user_first_copies
ALTER TABLE user_first_copies
  ADD COLUMN IF NOT EXISTS user_id TEXT;

-- Add user_id column to event_sequences_raw
ALTER TABLE event_sequences_raw
  ADD COLUMN IF NOT EXISTS user_id TEXT;

-- Add indexes for new user_id columns
CREATE INDEX IF NOT EXISTS idx_user_first_copies_user_id
  ON user_first_copies(user_id);

CREATE INDEX IF NOT EXISTS idx_event_sequences_raw_user_id
  ON event_sequences_raw(user_id);

-- Update column comments
COMMENT ON COLUMN user_first_copies.distinct_id IS
'Legacy Mixpanel distinct_id (sanitized, no $device: prefix). Still used for joins with event_sequences_raw.';

COMMENT ON COLUMN user_first_copies.user_id IS
'New Mixpanel $user_id (from chart 86612901). Clean identifier without $device: prefix issues.';

COMMENT ON COLUMN event_sequences_raw.distinct_id IS
'Legacy Mixpanel distinct_id (sanitized, no $device: prefix). Still used for joins with user_first_copies.';

COMMENT ON COLUMN event_sequences_raw.user_id IS
'New Mixpanel $user_id (from Export API). Clean identifier without $device: prefix issues.';

-- Log the changes
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Added user_id columns to event sequences tables';
  RAISE NOTICE '   - user_first_copies.user_id (indexed)';
  RAISE NOTICE '   - event_sequences_raw.user_id (indexed)';
  RAISE NOTICE '   - distinct_id columns retained for backward compatibility';
  RAISE NOTICE '   - Both columns will be populated going forward';
  RAISE NOTICE '';
END $$;
