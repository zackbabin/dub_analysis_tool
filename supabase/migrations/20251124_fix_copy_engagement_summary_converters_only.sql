-- Migration: Fix copy_engagement_summary to show unique portfolio metrics for converters only
-- Created: 2025-11-24
-- Purpose: Remove avg_unique_creators and show avg/median_unique_portfolios only for did_copy=1

DROP VIEW IF EXISTS copy_engagement_summary CASCADE;

CREATE VIEW copy_engagement_summary AS
SELECT
  ma.did_copy,
  COUNT(DISTINCT ma.distinct_id) AS total_users,
  ROUND(AVG(ma.total_profile_views), 2) AS avg_profile_views,
  ROUND(AVG(ma.total_pdp_views), 2) AS avg_pdp_views,
  CASE WHEN ma.did_copy = 1 THEN esm.mean_unique_portfolios ELSE NULL END AS avg_unique_portfolios,
  CASE WHEN ma.did_copy = 1 THEN esm.median_unique_portfolios ELSE NULL END AS median_unique_portfolios
FROM main_analysis ma
CROSS JOIN event_sequence_metrics esm
GROUP BY ma.did_copy, esm.mean_unique_portfolios, esm.median_unique_portfolios;

-- Grant permissions
GRANT SELECT ON copy_engagement_summary TO service_role, authenticated;

COMMENT ON VIEW copy_engagement_summary IS
'Compares engagement metrics between users who copied vs. haven''t copied.
avg_unique_portfolios and median_unique_portfolios (for did_copy=1 only) are populated by analyze-event-sequences Edge Function using Claude AI analysis of raw view events BEFORE first copy.';

COMMENT ON COLUMN copy_engagement_summary.avg_unique_portfolios IS
'Mean unique portfolios viewed BEFORE first copy (only for did_copy=1, NULL for non-converters). Calculated by Claude from event_sequences_raw.';

COMMENT ON COLUMN copy_engagement_summary.median_unique_portfolios IS
'Median unique portfolios viewed BEFORE first copy (only for did_copy=1, NULL for non-converters). Calculated by Claude from event_sequences_raw.';
