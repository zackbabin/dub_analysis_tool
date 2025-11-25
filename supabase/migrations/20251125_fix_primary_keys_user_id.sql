-- Migration: Fix primary keys to use user_id instead of id/distinct_id
-- Created: 2025-11-25
-- Purpose: Make user_id the primary key for clarity and correctness
--
-- Changes:
-- 1. subscribers_insights: distinct_id → user_id as PRIMARY KEY
-- 2. user_first_copies: Remove id, make user_id PRIMARY KEY
-- 3. user_portfolio_creator_engagement: Remove id, make composite PRIMARY KEY

-- ============================================================================
-- 1. Fix subscribers_insights PRIMARY KEY
-- ============================================================================

-- Drop old primary key constraint
ALTER TABLE subscribers_insights
  DROP CONSTRAINT IF EXISTS subscribers_insights_v2_pkey CASCADE;

-- Drop old unique constraint on distinct_id
ALTER TABLE subscribers_insights
  DROP CONSTRAINT IF EXISTS subscribers_insights_unique_key CASCADE;

-- Make user_id NOT NULL (required for PRIMARY KEY)
ALTER TABLE subscribers_insights
  ALTER COLUMN user_id SET NOT NULL;

-- Add PRIMARY KEY on user_id
ALTER TABLE subscribers_insights
  ADD CONSTRAINT subscribers_insights_pkey PRIMARY KEY (user_id);

-- Keep distinct_id indexed for Engage API lookups (not unique, may have duplicates)
CREATE INDEX IF NOT EXISTS idx_subscribers_insights_distinct_id
  ON subscribers_insights(distinct_id);

COMMENT ON COLUMN subscribers_insights.user_id IS
'Mixpanel $user_id - PRIMARY KEY, unique identifier per user';

COMMENT ON COLUMN subscribers_insights.distinct_id IS
'Mixpanel $distinct_id - for Engage API lookups only (indexed, not unique)';

-- ============================================================================
-- 2. Fix user_first_copies PRIMARY KEY
-- ============================================================================

-- Drop old primary key constraint on id
ALTER TABLE user_first_copies
  DROP CONSTRAINT IF EXISTS user_first_copies_pkey CASCADE;

-- Drop the id column entirely (no longer needed)
ALTER TABLE user_first_copies
  DROP COLUMN IF EXISTS id CASCADE;

-- Make user_id NOT NULL (required for PRIMARY KEY)
ALTER TABLE user_first_copies
  ALTER COLUMN user_id SET NOT NULL;

-- Add PRIMARY KEY on user_id
ALTER TABLE user_first_copies
  ADD CONSTRAINT user_first_copies_pkey PRIMARY KEY (user_id);

-- Keep distinct_id unique constraint for joins with event_sequences_raw
ALTER TABLE user_first_copies
  DROP CONSTRAINT IF EXISTS user_first_copies_unique_user CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS user_first_copies_distinct_id_unique
  ON user_first_copies(distinct_id);

-- Update indexes
DROP INDEX IF EXISTS idx_user_first_copies_user_id;
DROP INDEX IF EXISTS idx_user_first_copies_distinct_id;

CREATE INDEX IF NOT EXISTS idx_user_first_copies_distinct_id
  ON user_first_copies(distinct_id);

CREATE INDEX IF NOT EXISTS idx_user_first_copies_copy_time
  ON user_first_copies(first_copy_time);

COMMENT ON COLUMN user_first_copies.user_id IS
'Mixpanel $user_id - PRIMARY KEY, unique identifier per user';

COMMENT ON COLUMN user_first_copies.distinct_id IS
'Mixpanel $distinct_id - for joins with event_sequences_raw (unique, indexed)';

-- ============================================================================
-- 3. Fix user_portfolio_creator_engagement PRIMARY KEY
-- ============================================================================

-- Drop old primary key constraint on id
ALTER TABLE user_portfolio_creator_engagement
  DROP CONSTRAINT IF EXISTS user_portfolio_creator_engagement_pkey CASCADE;

-- Drop the id column entirely (no longer needed)
ALTER TABLE user_portfolio_creator_engagement
  DROP COLUMN IF EXISTS id CASCADE;

-- Add composite PRIMARY KEY
ALTER TABLE user_portfolio_creator_engagement
  ADD CONSTRAINT user_portfolio_creator_engagement_pkey
  PRIMARY KEY (user_id, portfolio_ticker, creator_id);

-- Drop old unique index (now covered by PRIMARY KEY)
DROP INDEX IF EXISTS user_portfolio_creator_engagement_user_portfolio_creator;
DROP INDEX IF EXISTS user_portfolio_creator_engagement_distinct_id_portfolio_ticke_key;

COMMENT ON COLUMN user_portfolio_creator_engagement.user_id IS
'Mixpanel $user_id - part of composite PRIMARY KEY';

COMMENT ON COLUMN user_portfolio_creator_engagement.portfolio_ticker IS
'Portfolio ticker - part of composite PRIMARY KEY';

COMMENT ON COLUMN user_portfolio_creator_engagement.creator_id IS
'Creator ID - part of composite PRIMARY KEY';

-- ============================================================================
-- 4. Update dependent views
-- ============================================================================

-- Drop and recreate user_portfolio_creator_copies view (cannot rename columns with CREATE OR REPLACE)
DROP VIEW IF EXISTS user_portfolio_creator_copies CASCADE;

CREATE VIEW user_portfolio_creator_copies AS
SELECT
  user_id,  -- Changed from distinct_id
  portfolio_ticker,
  SUM(pdp_view_count) AS pdp_view_count,
  BOOL_OR(did_copy) AS did_copy,
  SUM(copy_count) AS copy_count,
  SUM(liquidation_count) AS liquidation_count,
  MAX(synced_at) AS synced_at
FROM user_portfolio_creator_engagement
GROUP BY user_id, portfolio_ticker;

COMMENT ON VIEW user_portfolio_creator_copies IS
'Aggregates portfolio engagement by user and portfolio (across all creators).
Updated to use user_id instead of distinct_id.';

-- Drop and recreate user_creator_profile_copies view (cannot rename columns with CREATE OR REPLACE)
DROP VIEW IF EXISTS user_creator_profile_copies CASCADE;

CREATE VIEW user_creator_profile_copies AS
SELECT
  user_id,  -- Changed from distinct_id
  creator_id,
  creator_username,
  profile_view_count,
  did_subscribe AS did_copy,  -- Renamed for consistency
  subscription_count AS copy_count,  -- Renamed for consistency
  synced_at
FROM user_creator_engagement;

COMMENT ON VIEW user_creator_profile_copies IS
'Shows creator profile engagement per user.
Updated to use user_id instead of distinct_id.';

-- Log the changes
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Updated primary keys to use user_id';
  RAISE NOTICE '   1. subscribers_insights: user_id is now PRIMARY KEY';
  RAISE NOTICE '   2. user_first_copies: Removed id column, user_id is PRIMARY KEY';
  RAISE NOTICE '   3. user_portfolio_creator_engagement: Removed id column, composite PRIMARY KEY (user_id, portfolio_ticker, creator_id)';
  RAISE NOTICE '   4. Updated dependent views: user_portfolio_creator_copies, user_creator_profile_copies';
  RAISE NOTICE '';
END $$;
