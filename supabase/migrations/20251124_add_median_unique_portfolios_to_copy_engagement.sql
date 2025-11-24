-- Migration: Add median_unique_portfolios to copy_engagement_summary
-- Created: 2025-11-24
-- Purpose: Store median alongside mean for event sequences analysis
--
-- Since copy_engagement_summary is a regular view (not materialized), we need a table
-- to store Claude's calculated values and join them in the view

-- Drop old event_sequence_analysis table if it exists (replaced by simpler event_sequence_metrics)
DROP TABLE IF EXISTS event_sequence_analysis CASCADE;

-- Drop old event sequences processing functions (no longer needed - Claude does the analysis)
DROP FUNCTION IF EXISTS process_event_sequences_raw() CASCADE;
DROP FUNCTION IF EXISTS get_event_sequences_precopy_metrics() CASCADE;
DROP FUNCTION IF EXISTS get_sorted_event_sequences(text) CASCADE;

-- Drop and recreate event_sequence_metrics with simplified schema (single row)
DROP TABLE IF EXISTS event_sequence_metrics CASCADE;

CREATE TABLE event_sequence_metrics (
  id integer PRIMARY KEY DEFAULT 1,
  mean_unique_portfolios numeric,
  median_unique_portfolios numeric,
  calculated_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT single_row_only CHECK (id = 1)
);

-- Insert default row
INSERT INTO event_sequence_metrics (id, mean_unique_portfolios, median_unique_portfolios)
VALUES (1, NULL, NULL);

-- Grant permissions
GRANT SELECT, UPDATE ON event_sequence_metrics TO service_role;

-- Drop and recreate view with new column from joined table
DROP VIEW IF EXISTS copy_engagement_summary CASCADE;

CREATE VIEW copy_engagement_summary AS
SELECT
  ma.did_copy,
  COUNT(DISTINCT ma.distinct_id) AS total_users,
  ROUND(AVG(ma.total_profile_views), 2) AS avg_profile_views,
  ROUND(AVG(ma.total_pdp_views), 2) AS avg_pdp_views,
  ROUND(AVG(ma.unique_creators_viewed), 2) AS avg_unique_creators,
  ROUND(AVG(ma.unique_portfolios_viewed), 2) AS avg_unique_portfolios,
  CASE WHEN ma.did_copy = 1 THEN esm.median_unique_portfolios ELSE NULL END AS median_unique_portfolios
FROM main_analysis ma
CROSS JOIN event_sequence_metrics esm
GROUP BY ma.did_copy, esm.median_unique_portfolios;

-- Grant permissions
GRANT SELECT ON copy_engagement_summary TO service_role, authenticated;

COMMENT ON VIEW copy_engagement_summary IS
'Compares engagement metrics between users who copied vs. haven''t copied.
median_unique_portfolios (for did_copy=1) is populated by analyze-event-sequences Edge Function using Claude AI analysis of raw view events.';

COMMENT ON TABLE event_sequence_metrics IS
'Stores Claude AI calculated mean/median unique portfolios for converters. Single row table updated by analyze-event-sequences Edge Function.';

COMMENT ON COLUMN copy_engagement_summary.avg_unique_portfolios IS
'Mean unique portfolios viewed. For did_copy=1, calculated by Claude from events BEFORE first copy.';

COMMENT ON COLUMN copy_engagement_summary.median_unique_portfolios IS
'Median unique portfolios viewed (only for did_copy=1). Calculated by Claude from events BEFORE first copy.';

-- Log the change
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Added median_unique_portfolios to copy_engagement_summary';
  RAISE NOTICE '   - View recreated with new column';
  RAISE NOTICE '   - Values populated by analyze-event-sequences function';
  RAISE NOTICE '';
END $$;
