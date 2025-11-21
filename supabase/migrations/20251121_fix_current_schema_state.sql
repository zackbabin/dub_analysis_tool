-- Migration: Fix current schema state after migrations ran in wrong order
-- Created: 2025-11-21
-- Purpose: The cleanup migration ran before the ID mapping fix, so we need to complete the schema changes

-- Current state:
-- - enriched_support_conversations was dropped by cleanup migration
-- - user_uuid was dropped
-- - BUT: raw_support_conversations still has UUID id and external_id columns
-- - We need to complete the transformation to TEXT id

-- ============================================================================
-- PART 1: CHECK CURRENT SCHEMA STATE
-- ============================================================================

DO $$
DECLARE
  has_external_id BOOLEAN;
  id_is_uuid BOOLEAN;
BEGIN
  -- Check if external_id column exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'raw_support_conversations'
    AND column_name = 'external_id'
  ) INTO has_external_id;

  -- Check if id column is UUID type
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'raw_support_conversations'
    AND column_name = 'id'
    AND data_type = 'uuid'
  ) INTO id_is_uuid;

  RAISE NOTICE 'Current schema state:';
  RAISE NOTICE '  - external_id exists: %', has_external_id;
  RAISE NOTICE '  - id is UUID type: %', id_is_uuid;
END $$;

-- ============================================================================
-- PART 2: TRANSFORM SCHEMA (IF NEEDED)
-- ============================================================================

-- Only run transformation if we still have UUID id and external_id
DO $$
DECLARE
  has_external_id BOOLEAN;
  id_is_uuid BOOLEAN;
BEGIN
  -- Check current state
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'raw_support_conversations'
    AND column_name = 'external_id'
  ) INTO has_external_id;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'raw_support_conversations'
    AND column_name = 'id'
    AND data_type = 'uuid'
  ) INTO id_is_uuid;

  IF has_external_id AND id_is_uuid THEN
    RAISE NOTICE 'Schema needs transformation - executing...';

    -- Drop foreign key constraints from support_conversation_messages
    EXECUTE 'ALTER TABLE support_conversation_messages DROP CONSTRAINT IF EXISTS support_conversation_messages_conversation_id_fkey';

    -- Create new table with correct schema
    EXECUTE 'CREATE TABLE raw_support_conversations_new (
      id TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN (''zendesk'', ''instabug'', ''notion'')),
      title TEXT,
      description TEXT,
      status TEXT,
      priority TEXT,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ,
      resolved_at TIMESTAMPTZ,
      user_id TEXT,
      assignee_id TEXT,
      tags TEXT[] DEFAULT ''{}'',
      custom_fields JSONB DEFAULT ''{}'',
      raw_data JSONB DEFAULT ''{}'',
      synced_at TIMESTAMPTZ DEFAULT NOW(),
      has_linear_ticket BOOLEAN DEFAULT FALSE,
      linear_issue_id TEXT,
      linear_custom_field_id TEXT,
      message_count INT DEFAULT 0,
      PRIMARY KEY (source, id)
    )';

    -- Migrate data from old table to new table
    EXECUTE 'INSERT INTO raw_support_conversations_new (
      id, source, title, description, status, priority,
      created_at, updated_at, resolved_at, user_id,
      assignee_id, tags, custom_fields, raw_data, synced_at,
      has_linear_ticket, linear_issue_id, linear_custom_field_id, message_count
    )
    SELECT
      external_id, source, title, description, status, priority,
      created_at, updated_at, resolved_at, user_id,
      assignee_id, tags, custom_fields, raw_data, synced_at,
      has_linear_ticket, linear_issue_id, linear_custom_field_id, message_count
    FROM raw_support_conversations';

    -- Create mapping table for migrating foreign keys
    EXECUTE 'CREATE TEMP TABLE _conversation_id_mapping AS
    SELECT
      old.id as old_uuid_id,
      new.source as new_source,
      new.id as new_text_id
    FROM raw_support_conversations old
    JOIN raw_support_conversations_new new ON old.external_id = new.id AND old.source = new.source';

    -- Update support_conversation_messages
    EXECUTE 'ALTER TABLE support_conversation_messages ADD COLUMN IF NOT EXISTS conversation_source TEXT';
    EXECUTE 'ALTER TABLE support_conversation_messages ADD COLUMN IF NOT EXISTS conversation_ticket_id TEXT';

    EXECUTE 'UPDATE support_conversation_messages m
    SET
      conversation_source = map.new_source,
      conversation_ticket_id = map.new_text_id
    FROM _conversation_id_mapping map
    WHERE m.conversation_id = map.old_uuid_id';

    EXECUTE 'ALTER TABLE support_conversation_messages DROP COLUMN conversation_id';
    EXECUTE 'ALTER TABLE support_conversation_messages RENAME COLUMN conversation_source TO conversation_source_temp';
    EXECUTE 'ALTER TABLE support_conversation_messages RENAME COLUMN conversation_ticket_id TO conversation_id';
    EXECUTE 'ALTER TABLE support_conversation_messages RENAME COLUMN conversation_source_temp TO conversation_source';

    -- Drop old table and rename new table
    EXECUTE 'DROP TABLE raw_support_conversations';
    EXECUTE 'ALTER TABLE raw_support_conversations_new RENAME TO raw_support_conversations';

    RAISE NOTICE '✅ Schema transformation complete';
  ELSE
    RAISE NOTICE 'Schema already transformed - skipping';
  END IF;
END $$;

-- ============================================================================
-- PART 3: RECREATE INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_support_conversations_created
ON raw_support_conversations(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_conversations_source
ON raw_support_conversations(source);

CREATE INDEX IF NOT EXISTS idx_support_conversations_status
ON raw_support_conversations(status);

CREATE INDEX IF NOT EXISTS idx_support_conversations_user_id
ON raw_support_conversations(user_id);

CREATE INDEX IF NOT EXISTS idx_support_conversations_message_count
ON raw_support_conversations(message_count)
WHERE message_count > 0;

-- Update support_conversation_messages constraints
ALTER TABLE support_conversation_messages
DROP CONSTRAINT IF EXISTS support_conversation_messages_conversation_id_external_id_key;

ALTER TABLE support_conversation_messages
ADD CONSTRAINT support_conversation_messages_conversation_external_id_key
UNIQUE (conversation_source, conversation_id, external_id);

ALTER TABLE support_conversation_messages
ADD CONSTRAINT support_conversation_messages_conversation_fkey
FOREIGN KEY (conversation_source, conversation_id)
REFERENCES raw_support_conversations(source, id)
ON DELETE CASCADE;

DROP INDEX IF EXISTS idx_support_messages_conversation;
CREATE INDEX IF NOT EXISTS idx_support_messages_conversation
ON support_conversation_messages(conversation_source, conversation_id);

CREATE INDEX IF NOT EXISTS idx_support_messages_created
ON support_conversation_messages(created_at DESC);

-- ============================================================================
-- PART 4: RECREATE MATERIALIZED VIEW
-- ============================================================================

DROP MATERIALIZED VIEW IF EXISTS enriched_support_conversations CASCADE;

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

-- Recreate indexes
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
  message_count INTEGER;
  with_user_id INTEGER;
  with_linear INTEGER;
BEGIN
  SELECT COUNT(*) INTO conversation_count FROM raw_support_conversations;
  SELECT COUNT(*) INTO message_count FROM support_conversation_messages;
  SELECT COUNT(*) INTO with_user_id FROM raw_support_conversations WHERE user_id IS NOT NULL;
  SELECT COUNT(*) INTO with_linear FROM raw_support_conversations WHERE linear_issue_id IS NOT NULL;

  RAISE NOTICE '✅ Schema fix complete';
  RAISE NOTICE '  - % conversations migrated', conversation_count;
  RAISE NOTICE '  - % messages migrated', message_count;
  RAISE NOTICE '  - % conversations with user_id', with_user_id;
  RAISE NOTICE '  - % conversations with Linear tickets', with_linear;

  IF with_user_id = 0 THEN
    RAISE WARNING '⚠️ No conversations have user_id - check Zendesk external_id field or re-sync data';
  END IF;
END $$;
