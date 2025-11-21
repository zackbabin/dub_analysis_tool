-- Remove refresh_copy_engagement_summary function (no longer needed with regular view)

DROP FUNCTION IF EXISTS refresh_copy_engagement_summary();

-- Add comment explaining removal
COMMENT ON VIEW copy_engagement_summary IS 'Copy engagement summary comparing copiers vs non-copiers. Regular view (converted from materialized) - always shows current data from main_analysis. No refresh function needed.';
