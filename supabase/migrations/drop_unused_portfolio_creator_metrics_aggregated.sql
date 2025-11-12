-- Drop unused portfolio_creator_metrics_aggregated table and view
-- These objects are not referenced anywhere in the codebase or database
-- They were replaced by portfolio_creator_copy_metrics (populated from Mixpanel chart 86055000)
-- Date: 2025-11-12

-- Drop the view first (depends on the table)
DROP VIEW IF EXISTS portfolio_creator_metrics_aggregated_latest CASCADE;

-- Drop the unused table
DROP TABLE IF EXISTS portfolio_creator_metrics_aggregated CASCADE;

COMMENT ON SCHEMA public IS 'Cleaned up unused portfolio_creator_metrics_aggregated objects. Active table is portfolio_creator_copy_metrics.';
