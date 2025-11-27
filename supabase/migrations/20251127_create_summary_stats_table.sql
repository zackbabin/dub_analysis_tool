-- Create summary_stats table to store calculated summary statistics
-- This replaces client-side calculation with pre-computed server-side results

CREATE TABLE IF NOT EXISTS summary_stats (
  id BIGSERIAL PRIMARY KEY,
  stats_data JSONB NOT NULL,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index on calculated_at for querying most recent stats
CREATE INDEX IF NOT EXISTS idx_summary_stats_calculated_at ON summary_stats(calculated_at DESC);

-- Add comment
COMMENT ON TABLE summary_stats IS 'Stores pre-calculated summary statistics including personas, conversions, and demographic breakdowns';
COMMENT ON COLUMN summary_stats.stats_data IS 'Complete summary stats object including totalUsers, conversions, demographics, and personaStats';
COMMENT ON COLUMN summary_stats.calculated_at IS 'Timestamp when stats were calculated by analyze-summary-stats Edge Function';
