-- Migration: Recreate dependent views after CASCADE drop
-- Created: 2025-11-25
-- Purpose: Recreate views that were dropped by CASCADE in 20251125_add_distinct_id_to_main_analysis.sql
--
-- Background:
-- - 20251125_add_distinct_id_to_main_analysis.sql used "DROP MATERIALIZED VIEW main_analysis CASCADE"
-- - This dropped all dependent views: copy_engagement_summary, enriched_support_conversations
-- - Need to recreate these views to fix 404 errors in frontend

-- ============================================================================
-- 1. Recreate copy_engagement_summary (depends on main_analysis)
-- ============================================================================

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
CROSS JOIN metrics m;

GRANT SELECT ON copy_engagement_summary TO service_role, authenticated, anon;

COMMENT ON VIEW copy_engagement_summary IS
'Compares engagement metrics between users who copied vs. haven''t copied. mean_unique_portfolios and median_unique_portfolios (for did_copy=1 only) are populated by analyze-event-sequences Edge Function from event_sequences_raw.';

-- ============================================================================
-- 2. Recreate enriched_support_conversations (depends on main_analysis through subscribers_insights)
-- ============================================================================

DROP VIEW IF EXISTS enriched_support_conversations CASCADE;

CREATE VIEW enriched_support_conversations AS
SELECT
  -- Core conversation data
  c.id,
  c.source,
  c.title,
  c.description,
  c.status,
  c.priority,
  c.created_at,
  c.updated_at,
  c.resolved_at,
  c.user_id,
  c.assignee_id,
  c.tags,
  c.custom_fields,
  c.raw_data,
  c.synced_at,
  c.message_count,

  -- Linear integration
  c.has_linear_ticket,
  c.linear_issue_id,

  -- User enrichment from subscribers_insights
  u.income as user_income,
  u.net_worth as user_net_worth,
  u.investing_activity as user_investing_activity,
  u.total_copies as user_total_copies,
  u.total_subscriptions as user_total_subscriptions,
  u.app_sessions as user_app_sessions,

  -- Linear issue details
  li.identifier as linear_identifier,
  li.title as linear_title,
  li.state_name as linear_state,
  li.url as linear_url

FROM raw_support_conversations c
LEFT JOIN subscribers_insights u ON c.user_id = u.user_id
LEFT JOIN linear_issues li ON c.linear_issue_id = li.identifier;

GRANT SELECT ON enriched_support_conversations TO service_role, authenticated, anon;

COMMENT ON VIEW enriched_support_conversations IS
'Regular view (not materialized) that enriches support conversations with user data and Linear issue details.
Queries are fast because they use created_at index and only fetch ~250 recent rows.
Updated to join on user_id instead of distinct_id.';

-- Log the changes
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Recreated dependent views after CASCADE drop:';
  RAISE NOTICE '   1. copy_engagement_summary (regular view)';
  RAISE NOTICE '   2. enriched_support_conversations (regular view)';
  RAISE NOTICE '';
  RAISE NOTICE '⚠️ If main_analysis is empty, run: REFRESH MATERIALIZED VIEW main_analysis;';
  RAISE NOTICE '';
END $$;
