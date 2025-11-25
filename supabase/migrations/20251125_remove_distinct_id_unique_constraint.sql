-- Migration: Remove unique constraint from user_first_copies.distinct_id
-- Created: 2025-11-25
-- Purpose: Fix incorrect unique constraint that causes insert failures
--
-- Background:
-- - In Mixpanel, multiple user_ids can have the same distinct_id (pre-identity merge)
-- - Chart 86612901 can return same distinct_id with different user_ids
-- - distinct_id should be indexed but NOT unique
-- - user_id is the PRIMARY KEY and should be unique

-- Drop the unique constraint on distinct_id
DROP INDEX IF EXISTS user_first_copies_distinct_id_unique;

-- Recreate as a regular (non-unique) index
CREATE INDEX IF NOT EXISTS idx_user_first_copies_distinct_id
  ON user_first_copies(distinct_id);

COMMENT ON COLUMN user_first_copies.distinct_id IS
'Mixpanel $distinct_id - for joins with event_sequences_raw (indexed, NOT unique because multiple user_ids can have same distinct_id)';

-- Log the changes
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Removed unique constraint from user_first_copies.distinct_id';
  RAISE NOTICE '   - distinct_id is now indexed but NOT unique';
  RAISE NOTICE '   - Allows same distinct_id with different user_ids (pre-identity merge)';
  RAISE NOTICE '   - user_id remains the PRIMARY KEY (unique)';
  RAISE NOTICE '';
END $$;
