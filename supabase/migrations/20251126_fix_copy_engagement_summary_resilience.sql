-- Migration: Fix copy_engagement_summary to work even when event_sequence_metrics is empty
-- Created: 2025-11-26
-- Purpose: Change CROSS JOIN to LEFT JOIN so view still returns data even if analyze-event-sequences hasn't run yet
--
-- Background:
-- - CROSS JOIN with empty metrics table causes entire view to return 0 rows
-- - Should show base_stats (total_users, avg views) even if mean/median portfolios are NULL
-- - This makes the view resilient to analyze-event-sequences failures

DROP VIEW IF EXISTS copy_engagement_summary CASCADE;

CREATE VIEW copy_engagement_summary AS
WITH base_stats AS (
  SELECT
    ma.did_copy,
    COUNT(DISTINCT ma.user_id) AS total_users,
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
LEFT JOIN metrics m ON true;  -- Changed from CROSS JOIN to LEFT JOIN so view works even if metrics is empty

GRANT SELECT ON copy_engagement_summary TO service_role, authenticated, anon;

COMMENT ON VIEW copy_engagement_summary IS
'Compares engagement metrics between users who copied vs. haven''t copied. mean_unique_portfolios and median_unique_portfolios (for did_copy=1 only) are populated by analyze-event-sequences Edge Function from event_sequences_raw. View is resilient - returns base stats even if event_sequence_metrics is empty.';

-- Log the changes
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Fixed copy_engagement_summary resilience';
  RAISE NOTICE '   - Changed CROSS JOIN to LEFT JOIN';
  RAISE NOTICE '   - View now works even if event_sequence_metrics is empty';
  RAISE NOTICE '   - mean/median columns will be NULL until analyze-event-sequences runs';
  RAISE NOTICE '';
END $$;
