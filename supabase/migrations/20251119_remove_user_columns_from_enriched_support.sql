-- Migration: Remove user-related columns from enriched_support_conversations
-- Created: 2025-11-19
-- Purpose: Remove PII and unused user columns from CX support view
-- Removes: user_income, user_net_worth, user_investing_activity, user_total_copies, user_total_subscriptions, user_app_sessions

-- ============================================================================
-- RECREATE MATERIALIZED VIEW WITHOUT USER COLUMNS
-- ============================================================================

-- Drop existing view
DROP MATERIALIZED VIEW IF NOT EXISTS enriched_support_conversations CASCADE;

-- Recreate without user enrichment columns
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

  -- Message aggregation
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

-- ============================================================================
-- RECREATE INDEXES ON MATERIALIZED VIEW
-- ============================================================================

-- Unique index on id for CONCURRENTLY refresh
CREATE UNIQUE INDEX IF NOT EXISTS idx_enriched_support_id
ON enriched_support_conversations(id);

-- Index on created_at for time-based queries
CREATE INDEX IF NOT EXISTS idx_enriched_support_created
ON enriched_support_conversations(created_at DESC);

-- Index on linear_issue_id for Linear integration queries
CREATE INDEX IF NOT EXISTS idx_enriched_support_linear
ON enriched_support_conversations(linear_issue_id)
WHERE linear_issue_id IS NOT NULL;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '✅ User columns removed from enriched_support_conversations';
  RAISE NOTICE '  - Removed: user_income, user_net_worth, user_investing_activity';
  RAISE NOTICE '  - Removed: user_total_copies, user_total_subscriptions, user_app_sessions';
  RAISE NOTICE '  - Kept: user_uuid, user_id (for reference only)';
  RAISE NOTICE '  - View now contains only conversation and Linear metadata';
END $$;
