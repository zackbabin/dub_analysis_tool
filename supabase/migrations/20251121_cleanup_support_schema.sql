-- Migration: Clean up support schema - remove user_uuid, fix user_id, clean up Linear columns
-- Created: 2025-11-21
-- Purpose:
--   1. Remove redundant user_uuid column (we only need user_id)
--   2. Ensure user_id is properly populated from Zendesk external_id
--   3. Rename external_id to user_id in support_conversation_messages
--   4. Clean up redundant Linear columns in enriched view
--   5. Fix Linear tickets display

-- ============================================================================
-- PART 1: DROP DEPENDENT OBJECTS
-- ============================================================================

DROP MATERIALIZED VIEW IF EXISTS enriched_support_conversations CASCADE;

-- ============================================================================
-- PART 2: UPDATE raw_support_conversations SCHEMA
-- ============================================================================

-- Drop user_uuid column (redundant - we only use user_id for Mixpanel distinct_id)
ALTER TABLE raw_support_conversations
DROP COLUMN IF EXISTS user_uuid;

-- Add comment to clarify user_id purpose
COMMENT ON COLUMN raw_support_conversations.user_id IS
  'Mixpanel distinct_id from source system (Zendesk ticket.external_id or Instabug user.id) - used to join with subscribers_insights';

-- ============================================================================
-- PART 3: UPDATE support_conversation_messages SCHEMA
-- ============================================================================

-- In support_conversation_messages:
-- - conversation_id = ticket ID (matches raw_support_conversations.id)
-- - conversation_source = 'zendesk' or 'instabug'
-- - external_id = Zendesk comment ID (for deduplication)
-- We don't actually need user_id in messages table - it comes from the conversation

-- Add comment to clarify external_id is comment ID, not user ID
COMMENT ON COLUMN support_conversation_messages.external_id IS
  'Source system comment/message ID (Zendesk comment.id, Instabug comment.id) - used for deduplication';

-- ============================================================================
-- PART 4: RECREATE MATERIALIZED VIEW (SIMPLIFIED)
-- ============================================================================

-- Remove redundant Linear columns, keep only what's actually used
CREATE MATERIALIZED VIEW enriched_support_conversations AS
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

  -- Linear integration (only keep fields actually used)
  c.has_linear_ticket,
  c.linear_issue_id,

  -- User enrichment from subscribers_insights
  u.income as user_income,
  u.net_worth as user_net_worth,
  u.investing_activity as user_investing_activity,
  u.total_copies as user_total_copies,
  u.total_subscriptions as user_total_subscriptions,
  u.app_sessions as user_app_sessions,

  -- Linear issue details (from linear_issues table via linear_issue_id)
  li.identifier as linear_identifier,
  li.title as linear_title,
  li.state_name as linear_state,
  li.url as linear_url

FROM raw_support_conversations c
LEFT JOIN subscribers_insights u ON c.user_id = u.distinct_id
LEFT JOIN linear_issues li ON c.linear_issue_id = li.identifier;

-- Note: Join linear_issues on identifier (like "DUB-123"), not on UUID id

-- ============================================================================
-- PART 5: RECREATE INDEXES
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_enriched_support_id
ON enriched_support_conversations(source, id);

CREATE INDEX IF NOT EXISTS idx_enriched_support_created
ON enriched_support_conversations(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_enriched_support_linear
ON enriched_support_conversations(linear_issue_id)
WHERE linear_issue_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_enriched_support_user
ON enriched_support_conversations(user_id)
WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_enriched_support_message_count
ON enriched_support_conversations(message_count)
WHERE message_count > 0;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

DO $$
DECLARE
  conversation_count INTEGER;
  with_user_id INTEGER;
  with_linear INTEGER;
BEGIN
  SELECT COUNT(*) INTO conversation_count FROM raw_support_conversations;
  SELECT COUNT(*) INTO with_user_id FROM raw_support_conversations WHERE user_id IS NOT NULL;
  SELECT COUNT(*) INTO with_linear FROM raw_support_conversations WHERE linear_issue_id IS NOT NULL;

  RAISE NOTICE '✅ Support schema cleanup complete';
  RAISE NOTICE '  - Removed user_uuid column (redundant)';
  RAISE NOTICE '  - Cleaned up Linear columns in enriched view';
  RAISE NOTICE '  - Fixed Linear join to use identifier instead of id';
  RAISE NOTICE '  - % total conversations', conversation_count;
  RAISE NOTICE '  - % conversations with user_id', with_user_id;
  RAISE NOTICE '  - % conversations with Linear tickets', with_linear;

  IF with_user_id = 0 THEN
    RAISE WARNING '⚠️ No conversations have user_id set - check Zendesk external_id field mapping';
  END IF;
END $$;
