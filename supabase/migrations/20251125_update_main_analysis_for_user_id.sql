-- Migration: Update main_analysis and dependent views to use user_id
-- Created: 2025-11-25
-- Purpose: Fix views to use user_id after column renaming in engagement tables
--
-- Background:
-- - subscribers_insights has BOTH user_id (PRIMARY KEY) and distinct_id (for Engage API)
-- - user_portfolio_creator_engagement was renamed to have user_id (not distinct_id)
-- - main_analysis needs to use user_id for joins and as primary identifier

-- ============================================================================
-- 1. Update main_analysis to use user_id
-- ============================================================================

DROP MATERIALIZED VIEW IF EXISTS main_analysis CASCADE;

CREATE MATERIALIZED VIEW main_analysis AS
WITH unique_engagement AS (
  -- Calculate unique engagement metrics from engagement table (now uses user_id)
  SELECT
    user_id,  -- Changed from distinct_id
    COUNT(DISTINCT creator_id) as unique_creators_viewed,
    COUNT(DISTINCT portfolio_ticker) as unique_portfolios_viewed
  FROM user_portfolio_creator_engagement
  GROUP BY user_id  -- Changed from distinct_id
)
SELECT
  -- Use user_id as primary identifier
  si.user_id,  -- Changed from distinct_id
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
  si.total_deposit_count,
  si.active_created_portfolios,
  si.lifetime_created_portfolios,
  si.total_copies,
  si.total_regular_copies,
  si.total_premium_copies,
  si.regular_pdp_views,
  si.premium_pdp_views,
  si.paywall_views,
  si.regular_creator_views,
  si.premium_creator_views,
  si.total_subscriptions,
  si.stripe_modal_views,
  si.app_sessions,
  si.creator_card_taps,
  si.portfolio_card_taps,
  si.total_bank_links,
  si.discover_tab_views,
  si.leaderboard_tab_views,
  si.premium_tab_views,

  -- Calculate derived metrics
  (COALESCE(si.regular_creator_views, 0) + COALESCE(si.premium_creator_views, 0)) as total_profile_views,
  (COALESCE(si.regular_pdp_views, 0) + COALESCE(si.premium_pdp_views, 0)) as total_pdp_views,

  -- Add unique engagement metrics from granular tables
  COALESCE(ue.unique_creators_viewed, 0) as unique_creators_viewed,
  COALESCE(ue.unique_portfolios_viewed, 0) as unique_portfolios_viewed,

  -- Boolean flags
  CASE WHEN si.total_copies > 0 THEN 1 ELSE 0 END as did_copy,
  CASE WHEN si.total_subscriptions > 0 THEN 1 ELSE 0 END as did_subscribe

FROM subscribers_insights si
LEFT JOIN unique_engagement ue ON si.user_id = ue.user_id;  -- Changed from distinct_id

-- Create unique index on user_id for main_analysis
CREATE UNIQUE INDEX IF NOT EXISTS idx_main_analysis_user_id ON main_analysis(user_id);

-- Grant permissions
GRANT SELECT ON main_analysis TO authenticated, anon, service_role;

COMMENT ON MATERIALIZED VIEW main_analysis IS
'Main analysis view combining user properties from subscribers_insights with engagement metrics.
Updated to use user_id as primary identifier.';

-- ============================================================================
-- 2. Update copy_engagement_summary (depends on main_analysis)
-- ============================================================================

-- This view was already updated by 20251125_fix_copy_engagement_summary_with_metrics.sql
-- but we need to change distinct_id → user_id since main_analysis now uses user_id

DROP VIEW IF EXISTS copy_engagement_summary CASCADE;

CREATE VIEW copy_engagement_summary AS
WITH base_stats AS (
  SELECT
    ma.did_copy,
    COUNT(DISTINCT ma.user_id) AS total_users,  -- Changed from distinct_id
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
-- 3. Update enriched_support_conversations (uses subscribers_insights.user_id)
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
LEFT JOIN subscribers_insights u ON c.user_id = u.user_id  -- Changed from distinct_id
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
  RAISE NOTICE '✅ Updated views to use user_id:';
  RAISE NOTICE '   1. main_analysis: user_id as primary identifier, joins on user_id';
  RAISE NOTICE '   2. copy_engagement_summary: uses user_id from main_analysis';
  RAISE NOTICE '   3. enriched_support_conversations: joins subscribers_insights on user_id';
  RAISE NOTICE '';
END $$;
