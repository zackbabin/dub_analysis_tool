-- Migration: Add external_id to enriched_support_conversations view
-- Date: 2025-11-25
-- Purpose: Include external_id so we can construct proper Zendesk web UI URLs

DROP VIEW IF EXISTS enriched_support_conversations CASCADE;

CREATE VIEW enriched_support_conversations AS
SELECT
  -- Core conversation data
  c.id,
  c.external_id,
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
  li.url as linear_url,

  -- Aggregated message data
  COALESCE(
    ARRAY_AGG(m.body ORDER BY m.created_at) FILTER (WHERE m.body IS NOT NULL),
    ARRAY[]::text[]
  ) as all_messages

FROM raw_support_conversations c
LEFT JOIN subscribers_insights u ON c.user_id = u.distinct_id
LEFT JOIN linear_issues li ON c.linear_issue_id = li.identifier
LEFT JOIN support_conversation_messages m ON c.id = m.conversation_id
GROUP BY
  c.id,
  c.external_id,
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
  c.has_linear_ticket,
  c.linear_issue_id,
  u.income,
  u.net_worth,
  u.investing_activity,
  u.total_copies,
  u.total_subscriptions,
  u.app_sessions,
  li.identifier,
  li.title,
  li.state_name,
  li.url;

-- Grant access permissions
GRANT SELECT ON enriched_support_conversations TO service_role;
GRANT SELECT ON enriched_support_conversations TO authenticated;
GRANT SELECT ON enriched_support_conversations TO anon;

-- Add comment explaining the view
COMMENT ON VIEW enriched_support_conversations IS
'Regular view (not materialized) that enriches support conversations with user data, Linear issue details, and messages.
Queries are fast because they use created_at index and only fetch ~250 recent rows.
No refresh needed - data is always current.
Includes external_id for constructing proper Zendesk web UI URLs.';
