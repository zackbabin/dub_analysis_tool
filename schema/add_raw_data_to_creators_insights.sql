-- Add raw_data JSONB column to creators_insights table
-- This provides flexibility to store all CSV columns without schema changes

ALTER TABLE creators_insights
ADD COLUMN IF NOT EXISTS raw_data JSONB DEFAULT '{}'::jsonb;

-- Add GIN index for better query performance on JSONB
CREATE INDEX IF NOT EXISTS idx_creators_insights_raw_data
ON creators_insights USING gin(raw_data);

-- Add comment explaining the purpose
COMMENT ON COLUMN creators_insights.raw_data IS 'Stores all uploaded creator CSV data in flexible JSONB format for future extensibility';
