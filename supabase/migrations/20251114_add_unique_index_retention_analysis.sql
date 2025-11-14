-- Add unique index to premium_creator_retention_analysis for concurrent refresh
-- Required for REFRESH MATERIALIZED VIEW CONCURRENTLY to work

-- Drop existing non-unique index
DROP INDEX IF EXISTS idx_retention_analysis_creator;

-- Create unique index on the combination that makes each row unique
CREATE UNIQUE INDEX idx_retention_analysis_unique
ON premium_creator_retention_analysis (creator_username, cohort_date);

-- Also create a regular index for creator lookups (performance)
CREATE INDEX idx_retention_analysis_creator
ON premium_creator_retention_analysis (creator_username);

-- Verify the unique index exists
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'premium_creator_retention_analysis'
AND schemaname = 'public'
ORDER BY indexname;
