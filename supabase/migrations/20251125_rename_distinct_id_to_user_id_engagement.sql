-- Migration: Rename distinct_id to user_id in engagement tables
-- Created: 2025-11-25
-- Purpose: Consistency - these tables only use $user_id (no dual-tracking needed)
--
-- Background:
-- - Engagement charts (85165851, 85165580, 85165590) return only $user_id
-- - No need for distinct_id mapping (unlike subscribers_insights)
-- - Rename column for clarity and consistency
--
-- Tables affected:
-- 1. portfolio_engagement_staging
-- 2. user_portfolio_creator_engagement
-- 3. creator_engagement_staging
-- 4. user_creator_engagement

-- Rename in portfolio_engagement_staging
ALTER TABLE portfolio_engagement_staging
  RENAME COLUMN distinct_id TO user_id;

-- Update indexes for portfolio_engagement_staging
DROP INDEX IF EXISTS idx_portfolio_engagement_staging_distinct_id;
CREATE INDEX IF NOT EXISTS idx_portfolio_engagement_staging_user_id
  ON portfolio_engagement_staging(user_id);

-- Rename in user_portfolio_creator_engagement
ALTER TABLE user_portfolio_creator_engagement
  RENAME COLUMN distinct_id TO user_id;

-- Update indexes for user_portfolio_creator_engagement
DROP INDEX IF EXISTS idx_user_portfolio_creator_engagement_distinct_id;
CREATE INDEX IF NOT EXISTS idx_user_portfolio_creator_engagement_user_id
  ON user_portfolio_creator_engagement(user_id);

-- Update unique constraint for user_portfolio_creator_engagement
DROP INDEX IF EXISTS user_portfolio_creator_engagement_distinct_id_portfolio_ticke_key;
CREATE UNIQUE INDEX IF NOT EXISTS user_portfolio_creator_engagement_user_portfolio_creator
  ON user_portfolio_creator_engagement(user_id, portfolio_ticker, creator_id);

-- Update column comments for portfolio tables
COMMENT ON COLUMN portfolio_engagement_staging.user_id IS
'Mixpanel $user_id (from charts 85165851, 85165580, 85165590)';

COMMENT ON COLUMN user_portfolio_creator_engagement.user_id IS
'Mixpanel $user_id (from charts 85165851, 85165580, 85165590)';

-- Rename in creator_engagement_staging
ALTER TABLE creator_engagement_staging
  RENAME COLUMN distinct_id TO user_id;

-- Update indexes
DROP INDEX IF EXISTS idx_creator_engagement_staging_distinct_id;
CREATE INDEX IF NOT EXISTS idx_creator_engagement_staging_user_id
  ON creator_engagement_staging(user_id);

-- Update unique constraint
DROP INDEX IF EXISTS creator_engagement_staging_distinct_id_creator_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS creator_engagement_staging_user_creator
  ON creator_engagement_staging(user_id, creator_id);

-- Update column comments
COMMENT ON COLUMN creator_engagement_staging.user_id IS
'Mixpanel $user_id (from charts 85165851, 85165590)';

-- Rename in user_creator_engagement
ALTER TABLE user_creator_engagement
  RENAME COLUMN distinct_id TO user_id;

-- Update indexes
DROP INDEX IF EXISTS idx_user_creator_engagement_distinct_id;
CREATE INDEX IF NOT EXISTS idx_user_creator_engagement_user_id
  ON user_creator_engagement(user_id);

-- Update unique constraint
DROP INDEX IF EXISTS user_creator_engagement_distinct_id_creator_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS user_creator_engagement_user_creator
  ON user_creator_engagement(user_id, creator_id);

-- Update column comment
COMMENT ON COLUMN user_creator_engagement.user_id IS
'Mixpanel $user_id (from charts 85165851, 85165590)';

-- Log the changes
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Renamed distinct_id → user_id in engagement tables';
  RAISE NOTICE '   - portfolio_engagement_staging.user_id';
  RAISE NOTICE '   - user_portfolio_creator_engagement.user_id';
  RAISE NOTICE '   - creator_engagement_staging.user_id';
  RAISE NOTICE '   - user_creator_engagement.user_id';
  RAISE NOTICE '   - Updated indexes and unique constraints';
  RAISE NOTICE '';
END $$;
