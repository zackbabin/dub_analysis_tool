-- Migration: Add mean_unique_creators and median_unique_creators to event_sequence_metrics
-- Created: 2025-11-28
-- Purpose: Support analyze-creator-sequences function output

-- Add new columns for creator profile view metrics
ALTER TABLE event_sequence_metrics
ADD COLUMN IF NOT EXISTS mean_unique_creators numeric,
ADD COLUMN IF NOT EXISTS median_unique_creators numeric;

-- Update comment to reflect new columns
COMMENT ON TABLE event_sequence_metrics IS
'Single-row table storing metrics from analyze-event-sequences and analyze-creator-sequences Edge Functions.
Always has exactly one row with id=1.
- mean_unique_portfolios/median_unique_portfolios: From analyze-event-sequences (Viewed Portfolio Details)
- mean_unique_creators/median_unique_creators: From analyze-creator-sequences (Viewed Creator Profile)';

COMMENT ON COLUMN event_sequence_metrics.mean_unique_creators IS
'Mean number of unique creator profile views before first copy (populated by analyze-creator-sequences)';

COMMENT ON COLUMN event_sequence_metrics.median_unique_creators IS
'Median number of unique creator profile views before first copy (populated by analyze-creator-sequences)';

-- Log the changes
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Added mean_unique_creators and median_unique_creators columns to event_sequence_metrics';
  RAISE NOTICE '   - These will be populated by analyze-creator-sequences Edge Function';
  RAISE NOTICE '   - Will be exposed via copy_engagement_summary view';
  RAISE NOTICE '';
END $$;
