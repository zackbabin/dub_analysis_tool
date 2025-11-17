-- Add unique index to main_analysis for CONCURRENT refresh
-- REFRESH MATERIALIZED VIEW CONCURRENTLY requires a unique index with no WHERE clause
-- Date: 2025-11-17

-- Drop the existing non-unique index
DROP INDEX IF EXISTS idx_main_analysis_distinct_id;

-- Create unique index on distinct_id (which is unique in subscribers_insights)
CREATE UNIQUE INDEX idx_main_analysis_distinct_id ON main_analysis (distinct_id);

COMMENT ON INDEX idx_main_analysis_distinct_id IS
'Unique index to enable concurrent refresh of main_analysis materialized view';
