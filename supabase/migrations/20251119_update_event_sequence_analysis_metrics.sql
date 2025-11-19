-- Update event_sequence_analysis table to store 4 specific conversion path metrics
-- Replace unique view counts with specific event counts before first copy

-- Drop old columns
ALTER TABLE event_sequence_analysis
DROP COLUMN IF EXISTS avg_unique_portfolios_viewed_before_copy,
DROP COLUMN IF EXISTS avg_unique_creators_viewed_before_copy;

-- Add new columns for 4 specific metrics
ALTER TABLE event_sequence_analysis
ADD COLUMN IF NOT EXISTS avg_premium_pdp_views_before_copy numeric,
ADD COLUMN IF NOT EXISTS avg_regular_pdp_views_before_copy numeric,
ADD COLUMN IF NOT EXISTS avg_premium_creator_views_before_copy numeric,
ADD COLUMN IF NOT EXISTS avg_regular_creator_views_before_copy numeric;

-- Add comment explaining the metrics
COMMENT ON COLUMN event_sequence_analysis.avg_premium_pdp_views_before_copy IS 'Average count of "Viewed Premium PDP" events before first copy (for users with total_copies >= 3)';
COMMENT ON COLUMN event_sequence_analysis.avg_regular_pdp_views_before_copy IS 'Average count of "Viewed Regular PDP" events before first copy (for users with total_copies >= 3)';
COMMENT ON COLUMN event_sequence_analysis.avg_premium_creator_views_before_copy IS 'Average count of "Viewed Premium Creator Profile" events before first copy (for users with total_copies >= 3)';
COMMENT ON COLUMN event_sequence_analysis.avg_regular_creator_views_before_copy IS 'Average count of "Viewed Regular Creator Profile" events before first copy (for users with total_copies >= 3)';
