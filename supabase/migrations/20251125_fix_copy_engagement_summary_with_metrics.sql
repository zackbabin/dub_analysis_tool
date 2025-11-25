-- Migration: Fix copy_engagement_summary to properly use event_sequence_metrics
-- Created: 2025-11-25
-- Purpose: Properly query event_sequence_metrics and rename avg to mean for consistency

DROP VIEW IF EXISTS copy_engagement_summary CASCADE;

CREATE VIEW copy_engagement_summary AS
WITH base_stats AS (
  SELECT
    ma.did_copy,
    COUNT(DISTINCT ma.distinct_id) AS total_users,
    ROUND(AVG(ma.total_profile_views), 2) AS avg_profile_views,
    ROUND(AVG(ma.total_pdp_views), 2) AS avg_pdp_views
  FROM main_analysis ma
  GROUP BY ma.did_copy
),
metrics AS (
  SELECT
    mean_unique_portfolios,
    median_unique_portfolios
  FROM event_sequence_metrics
  WHERE id = 1
  LIMIT 1
)
SELECT
  bs.did_copy,
  bs.total_users,
  bs.avg_profile_views,
  bs.avg_pdp_views,
  CASE WHEN bs.did_copy = 1 THEN m.mean_unique_portfolios ELSE NULL END AS mean_unique_portfolios,
  CASE WHEN bs.did_copy = 1 THEN m.median_unique_portfolios ELSE NULL END AS median_unique_portfolios
FROM base_stats bs
CROSS JOIN metrics m;

-- Grant permissions
GRANT SELECT ON copy_engagement_summary TO service_role, authenticated, anon;

COMMENT ON VIEW copy_engagement_summary IS
'Compares engagement metrics between users who copied vs. haven''t copied. mean_unique_portfolios and median_unique_portfolios (for did_copy=1 only) are populated by analyze-event-sequences Edge Function from event_sequences_raw.';

COMMENT ON COLUMN copy_engagement_summary.mean_unique_portfolios IS
'Mean unique portfolios viewed BEFORE first copy (only for did_copy=1, NULL for non-converters). Calculated by Claude from event_sequences_raw.';

COMMENT ON COLUMN copy_engagement_summary.median_unique_portfolios IS
'Median unique portfolios viewed BEFORE first copy (only for did_copy=1, NULL for non-converters). Calculated by Claude from event_sequences_raw.';
