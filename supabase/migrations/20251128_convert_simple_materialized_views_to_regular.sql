-- Migration: Convert simple materialized views to regular views
-- Created: 2025-11-28
-- Purpose: Optimize database performance by converting 3 simple aggregation materialized views to regular views
--
-- Rationale:
-- 1. copy_engagement_summary: Only 2 rows (did_copy=0, did_copy=1), simple GROUP BY on main_analysis
-- 2. subscription_engagement_summary: Only 2 rows (did_subscribe=0, did_subscribe=1), simple GROUP BY on main_analysis
-- 3. hidden_gems_portfolios: ~100-1000 rows, simple WHERE filter on portfolio_creator_engagement_metrics
--
-- Benefits:
-- - Eliminates refresh lag and data staleness
-- - Auto-updates when underlying materialized views refresh
-- - Reduces refresh complexity and maintenance
-- - Improves data freshness (always shows latest data)

-- =======================
-- 1. copy_engagement_summary
-- =======================

-- Drop the materialized view and recreate as regular view WITH EXACT SAME SCHEMA
DROP MATERIALIZED VIEW IF EXISTS copy_engagement_summary CASCADE;

CREATE OR REPLACE VIEW copy_engagement_summary AS
SELECT
  did_copy,
  COUNT(DISTINCT user_id) AS total_users,
  ROUND(AVG(total_profile_views), 2) AS avg_profile_views,
  ROUND(AVG(total_pdp_views), 2) AS avg_pdp_views,
  -- Event sequence metrics (only for did_copy=1, from analyze-portfolio-sequences and analyze-creator-sequences)
  CASE WHEN did_copy = 1 THEN (SELECT mean_unique_creators FROM event_sequence_metrics WHERE id = 1 LIMIT 1) ELSE NULL END AS mean_unique_creators,
  CASE WHEN did_copy = 1 THEN (SELECT median_unique_creators FROM event_sequence_metrics WHERE id = 1 LIMIT 1) ELSE NULL END AS median_unique_creators,
  CASE WHEN did_copy = 1 THEN (SELECT mean_unique_portfolios FROM event_sequence_metrics WHERE id = 1 LIMIT 1) ELSE NULL END AS mean_unique_portfolios,
  CASE WHEN did_copy = 1 THEN (SELECT median_unique_portfolios FROM event_sequence_metrics WHERE id = 1 LIMIT 1) ELSE NULL END AS median_unique_portfolios
FROM main_analysis
GROUP BY did_copy;

-- Grant permissions
GRANT SELECT ON copy_engagement_summary TO service_role, authenticated, anon;

-- Add comment
COMMENT ON VIEW copy_engagement_summary IS
'Regular view (converted from materialized) showing engagement metrics for users who copied vs those who did not. Auto-updates when main_analysis or event_sequence_metrics change. Only 2 rows of output, extremely fast to query.';

-- =======================
-- 2. subscription_engagement_summary
-- =======================

-- Drop the materialized view and recreate as regular view WITH EXACT SAME SCHEMA
DROP MATERIALIZED VIEW IF EXISTS subscription_engagement_summary CASCADE;

CREATE OR REPLACE VIEW subscription_engagement_summary AS
SELECT
  did_subscribe,
  COUNT(DISTINCT user_id) AS total_users,
  ROUND(AVG(total_profile_views), 2) AS avg_profile_views,
  ROUND(AVG(total_pdp_views), 2) AS avg_pdp_views,
  ROUND(AVG(unique_creators_viewed), 2) AS avg_unique_creators,
  ROUND(AVG(unique_portfolios_viewed), 2) AS avg_unique_portfolios
FROM main_analysis
GROUP BY did_subscribe;

-- Grant permissions
GRANT SELECT ON subscription_engagement_summary TO service_role, authenticated, anon;

-- Add comment
COMMENT ON VIEW subscription_engagement_summary IS
'Regular view (converted from materialized) showing engagement metrics for users who subscribed vs those who did not. Auto-updates when main_analysis changes. Only 2 rows of output, extremely fast to query.';

-- =======================
-- 3. hidden_gems_portfolios
-- =======================

-- Drop the materialized view and recreate as regular view WITH EXACT SAME SCHEMA FROM 20251127_recreate_hidden_gems_portfolios.sql
DROP MATERIALIZED VIEW IF EXISTS hidden_gems_portfolios CASCADE;

CREATE OR REPLACE VIEW hidden_gems_portfolios AS
SELECT
    portfolio_ticker,
    creator_id,
    creator_username,
    unique_viewers,
    total_pdp_views,
    total_copies,
    copy_conversion_rate,
    CASE
        WHEN total_copies > 0 THEN ROUND((unique_viewers::NUMERIC / total_copies::NUMERIC), 2)
        ELSE NULL::NUMERIC
    END AS viewer_copier_ratio
FROM portfolio_creator_engagement_metrics
WHERE unique_viewers >= 5
    AND total_copies < 100
    AND unique_viewers >= (total_copies * 5)
ORDER BY total_pdp_views DESC;

-- Grant permissions
GRANT SELECT ON hidden_gems_portfolios TO service_role, authenticated, anon;

-- Add comment
COMMENT ON VIEW hidden_gems_portfolios IS
'Regular view (converted from materialized) showing portfolios with high engagement but low conversion (5:1 views-to-copies ratio, max 100 copies). Auto-updates when portfolio_creator_engagement_metrics refreshes. Simple WHERE filter, ~100-1000 rows, fast to query.';

-- =======================
-- Log the changes
-- =======================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Converted 3 materialized views to regular views';
  RAISE NOTICE '   1. copy_engagement_summary (2 rows, simple GROUP BY)';
  RAISE NOTICE '   2. subscription_engagement_summary (2 rows, simple GROUP BY)';
  RAISE NOTICE '   3. hidden_gems_portfolios (100-1000 rows, simple WHERE filter)';
  RAISE NOTICE '';
  RAISE NOTICE 'Benefits:';
  RAISE NOTICE '   - Eliminates refresh lag';
  RAISE NOTICE '   - Auto-updates when underlying views refresh';
  RAISE NOTICE '   - Reduces maintenance complexity';
  RAISE NOTICE '   - Improves data freshness';
  RAISE NOTICE '';
  RAISE NOTICE 'Remaining materialized views (3):';
  RAISE NOTICE '   1. main_analysis';
  RAISE NOTICE '   2. portfolio_creator_engagement_metrics';
  RAISE NOTICE '   3. enriched_support_conversations';
  RAISE NOTICE '';
END $$;
