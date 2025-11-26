-- Migration: Fix main_analysis to properly join on user_id
-- Created: 2025-11-26
-- Purpose: Fix unique_engagement CTE and join to use user_id instead of distinct_id
--
-- Issue: user_portfolio_creator_engagement was renamed to use user_id, but
-- the schema file still referenced distinct_id causing join failures

DROP MATERIALIZED VIEW IF EXISTS main_analysis CASCADE;

CREATE MATERIALIZED VIEW main_analysis AS
WITH unique_engagement AS (
  -- Calculate unique engagement metrics from engagement table (uses user_id)
  SELECT
    user_id,
    COUNT(DISTINCT creator_id) as unique_creators_viewed,
    COUNT(DISTINCT portfolio_ticker) as unique_portfolios_viewed
  FROM user_portfolio_creator_engagement
  GROUP BY user_id
)
SELECT
  -- Include BOTH user_id (primary) and distinct_id (for Engage API compatibility)
  si.user_id,
  si.distinct_id,
  si.income,
  si.net_worth,
  si.investing_activity,
  si.investing_experience_years,
  si.investing_objective,
  si.investment_type,
  si.acquisition_survey,
  si.available_copy_credits,
  si.buying_power,
  si.total_deposits,
  si.total_ach_deposits,
  si.active_created_portfolios,
  si.lifetime_created_portfolios,
  si.total_copies,
  si.total_regular_copies,
  si.total_premium_copies,
  si.lifetime_copied_portfolios,
  si.active_copied_portfolios,
  si.regular_pdp_views,
  si.premium_pdp_views,
  si.paywall_views,
  si.regular_creator_views,
  si.premium_creator_views,
  si.total_subscriptions,
  si.stripe_modal_views,
  si.app_sessions,
  si.discover_tab_views,
  si.leaderboard_tab_views,
  si.premium_tab_views,
  si.creator_card_taps,
  si.portfolio_card_taps,
  si.total_bank_links,
  -- Calculate derived metrics from subscribers_insights columns
  (COALESCE(si.regular_creator_views, 0) + COALESCE(si.premium_creator_views, 0)) as total_profile_views,
  (COALESCE(si.regular_pdp_views, 0) + COALESCE(si.premium_pdp_views, 0)) as total_pdp_views,
  -- Add unique engagement metrics from granular tables
  COALESCE(ue.unique_creators_viewed, 0) as unique_creators_viewed,
  COALESCE(ue.unique_portfolios_viewed, 0) as unique_portfolios_viewed,
  -- Boolean flags for filtering
  CASE WHEN si.total_copies > 0 THEN 1 ELSE 0 END as did_copy,
  CASE WHEN si.total_subscriptions > 0 THEN 1 ELSE 0 END as did_subscribe,
  CASE WHEN si.total_ach_deposits > 0 THEN 1 ELSE 0 END as did_deposit
FROM subscribers_insights si
LEFT JOIN unique_engagement ue ON si.user_id = ue.user_id;

-- Create indexes for faster queries on materialized view
CREATE UNIQUE INDEX IF NOT EXISTS idx_main_analysis_user_id ON main_analysis (user_id);

-- Create index on distinct_id for Engage API compatibility
CREATE INDEX IF NOT EXISTS idx_main_analysis_distinct_id ON main_analysis (distinct_id);

-- Indexes for filtering and aggregation queries
CREATE INDEX IF NOT EXISTS idx_main_analysis_did_copy ON main_analysis (did_copy);
CREATE INDEX IF NOT EXISTS idx_main_analysis_did_subscribe ON main_analysis (did_subscribe);
CREATE INDEX IF NOT EXISTS idx_main_analysis_did_deposit ON main_analysis (did_deposit);

-- Grant permissions
GRANT SELECT ON main_analysis TO authenticated, anon, service_role;

-- ============================================================================
-- Recreate dependent views that were dropped by CASCADE
-- ============================================================================

-- 1. Recreate copy_engagement_summary (depends on main_analysis)
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

-- 2. Recreate enriched_support_conversations (depends on subscribers_insights)
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
'Regular view (not materialized) that enriches support conversations with user data and Linear issue details. Refreshes on every query.';

-- Log the changes
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Fixed main_analysis to use user_id for joins';
  RAISE NOTICE '   - unique_engagement CTE now groups by user_id';
  RAISE NOTICE '   - Join between subscribers_insights and unique_engagement uses user_id';
  RAISE NOTICE '✅ Recreated dependent views:';
  RAISE NOTICE '   - copy_engagement_summary';
  RAISE NOTICE '   - enriched_support_conversations';
  RAISE NOTICE '';
END $$;
