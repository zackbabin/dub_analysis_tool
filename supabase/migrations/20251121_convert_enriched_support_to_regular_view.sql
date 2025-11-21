-- Migration: Convert enriched_support_conversations from MATERIALIZED VIEW to regular VIEW
-- Reason: Only querying 250 recent rows with indexes - materialized view causes unnecessary disk I/O
-- Performance: Regular view with indexed created_at is faster than full table refresh
-- Date: 2025-11-21

-- Drop the materialized view and its indexes
DROP MATERIALIZED VIEW IF EXISTS enriched_support_conversations CASCADE;

-- Recreate as a regular view (no storage overhead, always fresh data)
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
LEFT JOIN subscribers_insights u ON c.user_id = u.distinct_id
LEFT JOIN linear_issues li ON c.linear_issue_id = li.identifier;

-- Grant access permissions
GRANT SELECT ON enriched_support_conversations TO service_role;
GRANT SELECT ON enriched_support_conversations TO authenticated;
GRANT SELECT ON enriched_support_conversations TO anon;

-- Add comment explaining the view
COMMENT ON VIEW enriched_support_conversations IS
'Regular view (not materialized) that enriches support conversations with user data and Linear issue details.
Queries are fast because they use created_at index and only fetch ~250 recent rows.
No refresh needed - data is always current.';

-- Note: The refresh_enriched_support_conversations() function is now obsolete
-- It will be removed in a follow-up migration
COMMENT ON FUNCTION refresh_enriched_support_conversations() IS
'DEPRECATED: This function is no longer needed since enriched_support_conversations is now a regular view (not materialized).';
