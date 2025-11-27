-- Migration: Fix copy_engagement_summary to include all required columns
-- Created: 2025-11-27
-- Purpose: Recreate copy_engagement_summary with all columns and as MATERIALIZED VIEW
--
-- Background:
-- - Previous migration (20251126_revert_did_deposit) created it as a regular VIEW
-- - Missing avg_unique_creators and avg_unique_portfolios columns
-- - Should be MATERIALIZED VIEW for better performance
-- - Need to include all columns that frontend expects

DROP MATERIALIZED VIEW IF EXISTS copy_engagement_summary CASCADE;
DROP VIEW IF EXISTS copy_engagement_summary CASCADE;

CREATE MATERIALIZED VIEW copy_engagement_summary AS
SELECT
  did_copy,
  COUNT(DISTINCT user_id) AS total_users,
  ROUND(AVG(total_profile_views), 2) AS avg_profile_views,
  ROUND(AVG(total_pdp_views), 2) AS avg_pdp_views,
  ROUND(AVG(unique_creators_viewed), 2) AS avg_unique_creators,
  ROUND(AVG(unique_portfolios_viewed), 2) AS avg_unique_portfolios,
  -- Add event sequence metrics if available (only for did_copy=1)
  CASE WHEN did_copy = 1 THEN (SELECT mean_unique_portfolios FROM event_sequence_metrics WHERE id = 1 LIMIT 1) ELSE NULL END AS mean_unique_portfolios,
  CASE WHEN did_copy = 1 THEN (SELECT median_unique_portfolios FROM event_sequence_metrics WHERE id = 1 LIMIT 1) ELSE NULL END AS median_unique_portfolios
FROM main_analysis
GROUP BY did_copy;

-- Create index on did_copy for faster queries
CREATE INDEX IF NOT EXISTS idx_copy_engagement_summary_did_copy
ON copy_engagement_summary (did_copy);

-- Grant permissions
GRANT SELECT ON copy_engagement_summary TO anon, authenticated, service_role;

-- Create refresh function
CREATE OR REPLACE FUNCTION refresh_copy_engagement_summary()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW copy_engagement_summary;
  RAISE NOTICE '✅ Refreshed copy_engagement_summary';
END;
$$;

GRANT EXECUTE ON FUNCTION refresh_copy_engagement_summary() TO authenticated, anon, service_role;

-- Add comment
COMMENT ON MATERIALIZED VIEW copy_engagement_summary IS
'Compares engagement metrics between users who copied vs. haven''t copied.
- avg_profile_views: Average creator profile views
- avg_pdp_views: Average portfolio detail page views
- avg_unique_creators: Average unique creators viewed
- avg_unique_portfolios: Average unique portfolios viewed
- mean_unique_portfolios: Mean unique portfolios viewed BEFORE first copy (converters only)
- median_unique_portfolios: Median unique portfolios viewed BEFORE first copy (converters only)
Materialized view - refresh with refresh_copy_engagement_summary()';

-- Log the changes
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Recreated copy_engagement_summary as MATERIALIZED VIEW';
  RAISE NOTICE '   - Includes all 8 columns required by frontend';
  RAISE NOTICE '   - Uses user_id instead of distinct_id';
  RAISE NOTICE '   - Added index on did_copy column';
  RAISE NOTICE '   - Created refresh function';
  RAISE NOTICE '';
END $$;
