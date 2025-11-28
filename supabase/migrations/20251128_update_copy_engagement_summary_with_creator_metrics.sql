-- Migration: Update copy_engagement_summary to add creator metrics and remove old avg columns
-- Created: 2025-11-28
-- Purpose:
--   1. Remove avg_unique_creators and avg_unique_portfolios (from main_analysis aggregation)
--   2. Add mean_unique_creators and median_unique_creators (from event_sequence_metrics)
--   3. Keep mean_unique_portfolios and median_unique_portfolios (already exists)

DROP MATERIALIZED VIEW IF EXISTS copy_engagement_summary CASCADE;

CREATE MATERIALIZED VIEW copy_engagement_summary AS
SELECT
  did_copy,
  COUNT(DISTINCT user_id) AS total_users,
  ROUND(AVG(total_profile_views), 2) AS avg_profile_views,
  ROUND(AVG(total_pdp_views), 2) AS avg_pdp_views,
  -- Event sequence metrics (only for did_copy=1, from analyze-event-sequences and analyze-creator-sequences)
  CASE WHEN did_copy = 1 THEN (SELECT mean_unique_creators FROM event_sequence_metrics WHERE id = 1 LIMIT 1) ELSE NULL END AS mean_unique_creators,
  CASE WHEN did_copy = 1 THEN (SELECT median_unique_creators FROM event_sequence_metrics WHERE id = 1 LIMIT 1) ELSE NULL END AS median_unique_creators,
  CASE WHEN did_copy = 1 THEN (SELECT mean_unique_portfolios FROM event_sequence_metrics WHERE id = 1 LIMIT 1) ELSE NULL END AS mean_unique_portfolios,
  CASE WHEN did_copy = 1 THEN (SELECT median_unique_portfolios FROM event_sequence_metrics WHERE id = 1 LIMIT 1) ELSE NULL END AS median_unique_portfolios
FROM main_analysis
GROUP BY did_copy;

-- Create index on did_copy for faster queries
CREATE INDEX IF NOT EXISTS idx_copy_engagement_summary_did_copy
ON copy_engagement_summary (did_copy);

-- Grant permissions
GRANT SELECT ON copy_engagement_summary TO anon, authenticated, service_role;

-- Recreate refresh function (should already exist, but ensure it's up to date)
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
- avg_profile_views: Average creator profile views (from main_analysis)
- avg_pdp_views: Average portfolio detail page views (from main_analysis)
- mean_unique_creators: Mean unique creator profile views BEFORE first copy (converters only, from analyze-creator-sequences)
- median_unique_creators: Median unique creator profile views BEFORE first copy (converters only, from analyze-creator-sequences)
- mean_unique_portfolios: Mean unique portfolios viewed BEFORE first copy (converters only, from analyze-event-sequences)
- median_unique_portfolios: Median unique portfolios viewed BEFORE first copy (converters only, from analyze-event-sequences)
Materialized view - refresh with refresh_copy_engagement_summary()';

-- Log the changes
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Updated copy_engagement_summary with creator and portfolio metrics';
  RAISE NOTICE '   - Removed: avg_unique_creators, avg_unique_portfolios (old main_analysis aggregations)';
  RAISE NOTICE '   - Added: mean_unique_creators, median_unique_creators (from event_sequence_metrics)';
  RAISE NOTICE '   - Kept: mean_unique_portfolios, median_unique_portfolios (already exists)';
  RAISE NOTICE '   - Now shows 8 columns: did_copy, total_users, avg_profile_views, avg_pdp_views, mean_unique_creators, median_unique_creators, mean_unique_portfolios, median_unique_portfolios';
  RAISE NOTICE '';
END $$;
