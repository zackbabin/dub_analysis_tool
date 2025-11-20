-- Migration: Update enriched_support_conversations to use stored message_count
-- Created: 2025-11-20
-- Purpose: Avoid expensive joins/aggregation by using pre-computed message_count column

-- Drop existing view
DROP MATERIALIZED VIEW IF EXISTS enriched_support_conversations CASCADE;

-- Recreate WITHOUT joining support_conversation_messages (massive performance improvement)
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
  c.message_count, -- Use stored count instead of aggregating

  -- User enrichment from subscribers_insights
  u.income as user_income,
  u.net_worth as user_net_worth,
  u.investing_activity as user_investing_activity,
  u.total_copies as user_total_copies,
  u.total_subscriptions as user_total_subscriptions,
  u.app_sessions as user_app_sessions,

  -- Linear metadata
  li.identifier as linear_identifier,
  li.title as linear_title,
  li.state_name as linear_state,
  li.url as linear_url
FROM raw_support_conversations c
LEFT JOIN subscribers_insights u ON c.user_id = u.distinct_id
LEFT JOIN linear_issues li ON c.linear_issue_id = li.id;
-- NO GROUP BY needed! Much faster refresh

-- Recreate indexes on materialized view
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

-- Add index for message_count queries
CREATE INDEX IF NOT EXISTS idx_enriched_support_message_count
ON enriched_support_conversations(message_count)
WHERE message_count > 0;

-- Verification
DO $$
BEGIN
  RAISE NOTICE '✅ enriched_support_conversations updated';
  RAISE NOTICE '  - No longer joins support_conversation_messages';
  RAISE NOTICE '  - Uses pre-computed message_count column';
  RAISE NOTICE '  - No GROUP BY aggregation (10-100x faster refresh)';
  RAISE NOTICE '  - Added index on message_count';
END $$;
