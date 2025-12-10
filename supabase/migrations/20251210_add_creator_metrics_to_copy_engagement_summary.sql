-- Migration: Add creator metrics to copy_engagement_summary view
-- Created: 2025-12-10
-- Purpose: Include mean_unique_creators and median_unique_creators from event_sequence_metrics

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
    mean_unique_creators,
    median_unique_creators,
    mean_unique_portfolios,
    median_unique_portfolios,
    creator_converter_count,
    portfolio_converter_count
  FROM event_sequence_metrics
  WHERE id = 1
  LIMIT 1
)
SELECT
  bs.did_copy,
  bs.total_users,
  bs.avg_profile_views,
  bs.avg_pdp_views,
  CASE WHEN bs.did_copy = 1 THEN m.mean_unique_creators ELSE NULL END AS mean_unique_creators,
  CASE WHEN bs.did_copy = 1 THEN m.median_unique_creators ELSE NULL END AS median_unique_creators,
  CASE WHEN bs.did_copy = 1 THEN m.mean_unique_portfolios ELSE NULL END AS mean_unique_portfolios,
  CASE WHEN bs.did_copy = 1 THEN m.median_unique_portfolios ELSE NULL END AS median_unique_portfolios,
  CASE WHEN bs.did_copy = 1 THEN m.creator_converter_count ELSE NULL END AS creator_converter_count,
  CASE WHEN bs.did_copy = 1 THEN m.portfolio_converter_count ELSE NULL END AS portfolio_converter_count
FROM base_stats bs
CROSS JOIN metrics m;

GRANT SELECT ON copy_engagement_summary TO service_role, authenticated, anon;

COMMENT ON VIEW copy_engagement_summary IS
'Compares engagement metrics between users who copied vs. haven''t copied.
For did_copy=1: includes mean/median unique creators and portfolios viewed before first copy,
plus converter counts. Populated by analyze-creator-sequences and analyze-portfolio-sequences Edge Functions.';

-- Log migration
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Added creator metrics to copy_engagement_summary';
  RAISE NOTICE '   - mean_unique_creators, median_unique_creators';
  RAISE NOTICE '   - creator_converter_count, portfolio_converter_count';
  RAISE NOTICE '';
END $$;
