-- Remove unused user enrichment columns from enriched_support_conversations
-- These columns (user_income, user_net_worth, etc.) are no longer needed
-- Removing the join to subscribers_insights improves performance

DROP MATERIALIZED VIEW IF EXISTS enriched_support_conversations CASCADE;

CREATE MATERIALIZED VIEW enriched_support_conversations AS
SELECT
  -- All columns from raw_support_conversations
  c.id,
  c.source,
  c.external_id,
  c.title,
  c.description,
  c.status,
  c.priority,
  c.created_at,
  c.updated_at,
  c.resolved_at,
  c.user_uuid,
  c.user_id,
  c.assignee_id,
  c.tags,
  c.custom_fields,
  c.raw_data,
  c.synced_at,
  c.has_linear_ticket,
  c.linear_issue_id,
  c.linear_custom_field_id,

  -- Message aggregation (replaces slow subqueries)
  COUNT(m.id) as message_count,
  ARRAY_AGG(m.body ORDER BY m.created_at) FILTER (WHERE m.body IS NOT NULL) as all_messages,

  -- Linear metadata
  li.identifier as linear_identifier,
  li.title as linear_title,
  li.state_name as linear_state,
  li.url as linear_url
FROM raw_support_conversations c
LEFT JOIN support_conversation_messages m ON c.id = m.conversation_id
LEFT JOIN linear_issues li ON c.linear_issue_id = li.id
GROUP BY
  -- All non-aggregated columns must be in GROUP BY
  c.id,
  c.source,
  c.external_id,
  c.title,
  c.description,
  c.status,
  c.priority,
  c.created_at,
  c.updated_at,
  c.resolved_at,
  c.user_uuid,
  c.user_id,
  c.assignee_id,
  c.tags,
  c.custom_fields,
  c.raw_data,
  c.synced_at,
  c.has_linear_ticket,
  c.linear_issue_id,
  c.linear_custom_field_id,
  li.identifier,
  li.title,
  li.state_name,
  li.url;

-- Recreate indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_enriched_support_id
ON enriched_support_conversations(id);

CREATE INDEX IF NOT EXISTS idx_enriched_support_created
ON enriched_support_conversations(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_enriched_support_linear
ON enriched_support_conversations(linear_issue_id)
WHERE linear_issue_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_enriched_support_user
ON enriched_support_conversations(user_id)
WHERE user_id IS NOT NULL;

-- Grant permissions
GRANT SELECT ON enriched_support_conversations TO service_role;
GRANT SELECT ON enriched_support_conversations TO authenticated;
GRANT SELECT ON enriched_support_conversations TO anon;

COMMENT ON MATERIALIZED VIEW enriched_support_conversations IS 'Enriched support conversations with messages and Linear metadata. Removed user enrichment columns for better performance.';
