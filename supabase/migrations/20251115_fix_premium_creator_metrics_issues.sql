-- Fix premium_creator_metrics table issues
-- 1. Add unique constraint to prevent duplicates
-- 2. Verify premium_creator_metrics_latest view definition
-- Date: 2025-11-15

-- ==============================================================================
-- STEP 1: Remove existing duplicates before adding constraint
-- ==============================================================================

-- Find and show duplicates
SELECT
  creator_id,
  synced_at,
  COUNT(*) as duplicate_count
FROM premium_creator_metrics
GROUP BY creator_id, synced_at
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC;

-- Delete duplicates, keeping only the row with highest id (most recent insert)
DELETE FROM premium_creator_metrics
WHERE id NOT IN (
  SELECT MAX(id)
  FROM premium_creator_metrics
  GROUP BY creator_id, synced_at
);

-- ==============================================================================
-- STEP 2: Add unique constraint to prevent future duplicates
-- ==============================================================================

-- Add unique constraint on (creator_id, synced_at)
-- This ensures one row per creator per sync timestamp
ALTER TABLE premium_creator_metrics
ADD CONSTRAINT premium_creator_metrics_unique_creator_sync
UNIQUE (creator_id, synced_at);

-- Create index to support the constraint
CREATE INDEX IF NOT EXISTS idx_premium_creator_metrics_unique
ON premium_creator_metrics(creator_id, synced_at);

-- ==============================================================================
-- STEP 3: Verify and recreate premium_creator_metrics_latest view if needed
-- ==============================================================================

-- Drop and recreate view to ensure correct definition
DROP VIEW IF EXISTS premium_creator_metrics_latest CASCADE;

CREATE OR REPLACE VIEW premium_creator_metrics_latest AS
SELECT DISTINCT ON (creator_id)
  id,
  creator_id,
  creator_username,
  total_subscriptions,
  total_paywall_views,
  total_stripe_modal_views,
  total_cancellations,
  synced_at
FROM premium_creator_metrics
ORDER BY creator_id, synced_at DESC, id DESC;

-- Grant permissions
GRANT SELECT ON premium_creator_metrics_latest TO anon, authenticated, service_role;

COMMENT ON VIEW premium_creator_metrics_latest IS
'Returns the latest sync data for each creator. Uses DISTINCT ON to get the most recent row by synced_at (and id as tiebreaker).';

-- ==============================================================================
-- STEP 4: Verify results
-- ==============================================================================

-- Check that no duplicates remain
SELECT
  CASE
    WHEN COUNT(*) = 0 THEN '✅ No duplicates found'
    ELSE '⚠️ Duplicates still exist!'
  END as duplicate_check
FROM (
  SELECT creator_id, synced_at, COUNT(*) as cnt
  FROM premium_creator_metrics
  GROUP BY creator_id, synced_at
  HAVING COUNT(*) > 1
) duplicates;

-- Verify view returns one row per creator
SELECT
  COUNT(*) as total_rows,
  COUNT(DISTINCT creator_id) as unique_creators,
  CASE
    WHEN COUNT(*) = COUNT(DISTINCT creator_id) THEN '✅ View working correctly - one row per creator'
    ELSE '⚠️ View has duplicates!'
  END as view_check
FROM premium_creator_metrics_latest;

-- Show sample of latest data
SELECT
  creator_username,
  creator_id,
  total_subscriptions,
  synced_at
FROM premium_creator_metrics_latest
ORDER BY total_subscriptions DESC
LIMIT 10;
