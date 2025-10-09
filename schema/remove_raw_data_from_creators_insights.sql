-- Remove redundant raw_data column from creators_insights table
-- The raw_data column belongs in uploaded_creators, not creators_insights
-- creators_insights is for Mixpanel sync data with structured columns

-- Drop the GIN index first
DROP INDEX IF EXISTS idx_creators_insights_raw_data;
DROP INDEX IF EXISTS idx_creators_insights_raw_data_gin;

-- Remove the column
ALTER TABLE creators_insights
DROP COLUMN IF EXISTS raw_data;

SELECT 'Removed redundant raw_data column from creators_insights' as status;
