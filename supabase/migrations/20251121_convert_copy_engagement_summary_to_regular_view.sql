-- Convert copy_engagement_summary from materialized to regular view
-- This is a simple aggregation of main_analysis (already materialized) - no need for separate refresh
-- Query executes in <10ms since it's just GROUP BY on ~50k rows with 2 output rows

-- Drop the materialized view
DROP MATERIALIZED VIEW IF EXISTS copy_engagement_summary CASCADE;

-- Recreate as a regular view with the same aggregation logic
CREATE VIEW copy_engagement_summary AS
SELECT
  did_copy,
  COUNT(DISTINCT distinct_id) AS total_users,
  ROUND(AVG(total_profile_views), 2) AS avg_profile_views,
  ROUND(AVG(total_pdp_views), 2) AS avg_pdp_views,
  ROUND(AVG(unique_creators_viewed), 2) AS avg_unique_creators,
  ROUND(AVG(unique_portfolios_viewed), 2) AS avg_unique_portfolios
FROM main_analysis
GROUP BY did_copy;

-- Grant access to all roles
GRANT SELECT ON copy_engagement_summary TO service_role;
GRANT SELECT ON copy_engagement_summary TO authenticated;
GRANT SELECT ON copy_engagement_summary TO anon;

-- Update comment to reflect regular view
COMMENT ON VIEW copy_engagement_summary IS 'Copy engagement summary comparing copiers vs non-copiers. Regular view - always shows current data from main_analysis (materialized). No refresh needed.';
