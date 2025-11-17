-- Manual refresh script for copy_engagement_summary materialized view
-- Run this if you need to immediately refresh the view with latest data

-- Option 1: Refresh without locking (requires unique index - run migration 20251117_add_unique_indexes_to_engagement_views.sql first)
-- REFRESH MATERIALIZED VIEW CONCURRENTLY copy_engagement_summary;

-- Option 2: Refresh with lock (works without index, but blocks queries during refresh)
REFRESH MATERIALIZED VIEW copy_engagement_summary;

-- Verify refresh completed by checking row count
SELECT COUNT(*) as total_rows FROM copy_engagement_summary;

-- View the data
SELECT * FROM copy_engagement_summary;
