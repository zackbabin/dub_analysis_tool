-- Manual refresh script for copy_engagement_summary materialized view
-- Run this if you need to immediately refresh the view with latest data

-- Refresh the materialized view
REFRESH MATERIALIZED VIEW CONCURRENTLY copy_engagement_summary;

-- Verify refresh completed
SELECT
  schemaname,
  matviewname,
  last_refresh
FROM pg_catalog.pg_matviews
WHERE matviewname = 'copy_engagement_summary';

-- Optional: Check row count
SELECT COUNT(*) as total_rows FROM copy_engagement_summary;

-- Optional: Check sample of latest data
SELECT * FROM copy_engagement_summary
ORDER BY synced_at DESC
LIMIT 10;
