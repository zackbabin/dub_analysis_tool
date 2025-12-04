-- Migration: Add unique index to premium_creator_retention_analysis for concurrent refresh
-- Created: 2025-12-04
-- Purpose: Enable CONCURRENTLY refresh by adding unique index
--
-- Issue: Materialized view refresh fails with error:
--   "cannot refresh materialized view "premium_creator_retention_analysis" concurrently"
--   Hint: "Create a unique index with no WHERE clause on one or more columns"
--
-- Solution: Create unique index on (creator_username, cohort_date)
--   This combination is naturally unique in the view (one row per creator per cohort)

-- Drop existing non-unique index
DROP INDEX IF EXISTS idx_retention_analysis_creator;

-- Create unique index on (creator_username, cohort_date)
-- This combination is unique per row in the materialized view
CREATE UNIQUE INDEX idx_retention_analysis_unique
ON premium_creator_retention_analysis(creator_username, cohort_date);

-- Also add non-unique index on creator_username for faster lookups
CREATE INDEX idx_retention_analysis_creator
ON premium_creator_retention_analysis(creator_username);

COMMENT ON INDEX idx_retention_analysis_unique IS
'Unique index required for CONCURRENTLY refresh of premium_creator_retention_analysis materialized view';

-- =======================
-- Log Migration
-- =======================

DO $$
BEGIN
  RAISE NOTICE ' ';
  RAISE NOTICE '✅ Added unique index to premium_creator_retention_analysis';
  RAISE NOTICE '   - Created unique index on (creator_username, cohort_date)';
  RAISE NOTICE '   - Enables REFRESH MATERIALIZED VIEW CONCURRENTLY';
  RAISE NOTICE '   - Fixes error in fetch-creator-retention edge function';
  RAISE NOTICE ' ';
END $$;
