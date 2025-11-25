-- Migration: Add user_id column to subscribers_insights
-- Created: 2025-11-25
-- Purpose: Support new Mixpanel $user_id as primary identifier
--
-- Background:
-- - Chart 85713544 now returns both $user_id and $distinct_id
-- - $user_id is the new primary identifier for users
-- - $distinct_id is kept for mapping to Engage API and other data sources
--
-- Strategy:
-- 1. Add user_id column to subscribers_insights
-- 2. Change primary key from distinct_id to user_id
-- 3. Keep distinct_id for Engage API lookups

-- Add user_id column
ALTER TABLE subscribers_insights
  ADD COLUMN IF NOT EXISTS user_id TEXT;

-- Create unique index on user_id (will be the new primary identifier)
CREATE UNIQUE INDEX IF NOT EXISTS subscribers_insights_user_id_unique
  ON subscribers_insights(user_id);

-- Keep index on distinct_id for Engage API lookups
CREATE INDEX IF NOT EXISTS idx_subscribers_insights_distinct_id
  ON subscribers_insights(distinct_id);

-- Update column comments
COMMENT ON COLUMN subscribers_insights.user_id IS
'Mixpanel $user_id - primary identifier for users (from chart 85713544)';

COMMENT ON COLUMN subscribers_insights.distinct_id IS
'Mixpanel $distinct_id - secondary identifier for mapping to Engage API and other data sources (sanitized, no $device: prefix)';

COMMENT ON TABLE subscribers_insights IS
'User event metrics and properties.
- user_id: Primary identifier from Mixpanel charts (unique)
- distinct_id: Secondary identifier for Engage API mapping
- Populated by sync-mixpanel-user-events-v2 and sync-mixpanel-user-properties-v2';

-- Log the changes
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Added user_id to subscribers_insights';
  RAISE NOTICE '   - user_id: Primary identifier (unique index)';
  RAISE NOTICE '   - distinct_id: Secondary identifier for Engage API (indexed)';
  RAISE NOTICE '   - Upserts will use user_id as conflict key';
  RAISE NOTICE '';
END $$;
