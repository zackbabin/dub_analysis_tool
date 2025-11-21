-- Migration: Fix support conversations to use ticket ID as primary key
-- Created: 2025-11-20
-- Purpose: Simplify schema by using source ticket ID as primary key instead of UUID
--
-- Current Problem:
--   - Using UUID as primary key AND storing ticket ID in external_id (redundant)
--   - Confusing which ID to use for lookups and joins
--   - user_id not being populated correctly with Mixpanel distinct_id
--
-- Zendesk API Mapping:
--   - ticket.id → our id (PRIMARY KEY, e.g., "12345")
--   - ticket.external_id → our user_id (Mixpanel distinct_id)
--
-- Fix:
--   - Change id from UUID to TEXT (stores Zendesk ticket.id directly)
--   - Remove external_id column (no longer needed)
--   - Keep source column for multi-source support
--   - PRIMARY KEY becomes (source, id) for multi-source uniqueness
--   - Ensure user_id stores Mixpanel distinct_id

-- ============================================================================
-- PART 1: DROP DEPENDENT OBJECTS
-- ============================================================================

-- Drop all dependent views and constraints
DROP MATERIALIZED VIEW IF EXISTS enriched_support_conversations CASCADE;

-- Drop foreign key constraints from support_conversation_messages
ALTER TABLE support_conversation_messages
DROP CONSTRAINT IF EXISTS support_conversation_messages_conversation_id_fkey;

-- ============================================================================
-- PART 2: MIGRATE DATA TO NEW SCHEMA
-- ============================================================================

-- Create new table with correct schema
CREATE TABLE raw_support_conversations_new (
  id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('zendesk', 'instabug', 'notion')),
  title TEXT,
  description TEXT,
  status TEXT,
  priority TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  user_uuid UUID,
  user_id TEXT, -- Mixpanel distinct_id
  assignee_id TEXT,
  tags TEXT[] DEFAULT '{}',
  custom_fields JSONB DEFAULT '{}',
  raw_data JSONB DEFAULT '{}',
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  has_linear_ticket BOOLEAN DEFAULT FALSE,
  linear_issue_id TEXT,
  linear_custom_field_id TEXT,
  message_count INT DEFAULT 0,
  PRIMARY KEY (source, id)
);

-- Migrate data from old table to new table
-- Map old UUID id → new TEXT id using external_id
INSERT INTO raw_support_conversations_new (
  id, source, title, description, status, priority,
  created_at, updated_at, resolved_at, user_uuid, user_id,
  assignee_id, tags, custom_fields, raw_data, synced_at,
  has_linear_ticket, linear_issue_id, linear_custom_field_id, message_count
)
SELECT
  external_id, -- Old external_id becomes new id
  source, title, description, status, priority,
  created_at, updated_at, resolved_at, user_uuid, user_id,
  assignee_id, tags, custom_fields, raw_data, synced_at,
  has_linear_ticket, linear_issue_id, linear_custom_field_id, message_count
FROM raw_support_conversations;

-- Create mapping table for migrating foreign keys (old UUID → new TEXT id)
CREATE TEMP TABLE _conversation_id_mapping AS
SELECT
  old.id as old_uuid_id,
  new.source as new_source,
  new.id as new_text_id
FROM raw_support_conversations old
JOIN raw_support_conversations_new new ON old.external_id = new.id AND old.source = new.source;

-- Update support_conversation_messages to use new composite key
-- First add new columns
ALTER TABLE support_conversation_messages
ADD COLUMN conversation_source TEXT,
ADD COLUMN conversation_ticket_id TEXT;

-- Populate new columns using mapping
UPDATE support_conversation_messages m
SET
  conversation_source = map.new_source,
  conversation_ticket_id = map.new_text_id
FROM _conversation_id_mapping map
WHERE m.conversation_id = map.old_uuid_id;

-- Drop old conversation_id column
ALTER TABLE support_conversation_messages
DROP COLUMN conversation_id;

-- Rename new columns
ALTER TABLE support_conversation_messages
RENAME COLUMN conversation_source TO conversation_source_temp;
ALTER TABLE support_conversation_messages
RENAME COLUMN conversation_ticket_id TO conversation_id;
ALTER TABLE support_conversation_messages
RENAME COLUMN conversation_source_temp TO conversation_source;

-- Drop old table and rename new table
DROP TABLE raw_support_conversations;
ALTER TABLE raw_support_conversations_new
RENAME TO raw_support_conversations;

-- ============================================================================
-- PART 3: RECREATE INDEXES AND CONSTRAINTS
-- ============================================================================

-- Indexes for raw_support_conversations
CREATE INDEX IF NOT EXISTS idx_support_conversations_created
ON raw_support_conversations(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_conversations_source
ON raw_support_conversations(source);

CREATE INDEX IF NOT EXISTS idx_support_conversations_status
ON raw_support_conversations(status);

CREATE INDEX IF NOT EXISTS idx_support_conversations_user_uuid
ON raw_support_conversations(user_uuid);

CREATE INDEX IF NOT EXISTS idx_support_conversations_user_id
ON raw_support_conversations(user_id);

CREATE INDEX IF NOT EXISTS idx_support_conversations_message_count
ON raw_support_conversations(message_count)
WHERE message_count > 0;

-- Update support_conversation_messages schema
-- Drop old UNIQUE constraint
ALTER TABLE support_conversation_messages
DROP CONSTRAINT IF EXISTS support_conversation_messages_conversation_id_external_id_key;

-- Add new composite UNIQUE constraint
ALTER TABLE support_conversation_messages
ADD CONSTRAINT support_conversation_messages_conversation_external_id_key
UNIQUE (conversation_source, conversation_id, external_id);

-- Add foreign key constraint
ALTER TABLE support_conversation_messages
ADD CONSTRAINT support_conversation_messages_conversation_fkey
FOREIGN KEY (conversation_source, conversation_id)
REFERENCES raw_support_conversations(source, id)
ON DELETE CASCADE;

-- Update indexes on support_conversation_messages
DROP INDEX IF EXISTS idx_support_messages_conversation;

CREATE INDEX IF NOT EXISTS idx_support_messages_conversation
ON support_conversation_messages(conversation_source, conversation_id);

CREATE INDEX IF NOT EXISTS idx_support_messages_created
ON support_conversation_messages(created_at DESC);

-- ============================================================================
-- PART 4: ADD COLUMN COMMENTS
-- ============================================================================

COMMENT ON COLUMN raw_support_conversations.id IS
  'Source system ticket ID (Zendesk ticket.id, Instabug bug.id) - PRIMARY KEY with source';

COMMENT ON COLUMN raw_support_conversations.source IS
  'Source system name (zendesk, instabug, notion) - part of PRIMARY KEY';

COMMENT ON COLUMN raw_support_conversations.user_id IS
  'Mixpanel distinct_id from source system (Zendesk ticket.external_id or Instabug user.id)';

COMMENT ON COLUMN support_conversation_messages.conversation_id IS
  'Ticket ID from raw_support_conversations.id';

COMMENT ON COLUMN support_conversation_messages.conversation_source IS
  'Source from raw_support_conversations.source';

-- ============================================================================
-- PART 5: RECREATE MATERIALIZED VIEW
-- ============================================================================

CREATE MATERIALIZED VIEW enriched_support_conversations AS
SELECT
  -- All columns from raw_support_conversations
  c.id,
  c.source,
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
  c.message_count,

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

-- Recreate indexes on materialized view
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
BEGIN
  SELECT COUNT(*) INTO conversation_count FROM raw_support_conversations;
  SELECT COUNT(*) INTO message_count FROM support_conversation_messages;

  RAISE NOTICE '✅ Support schema migration complete';
  RAISE NOTICE '  - Changed id from UUID to TEXT (stores source ticket ID directly)';
  RAISE NOTICE '  - Removed external_id column (no longer needed)';
  RAISE NOTICE '  - PRIMARY KEY is now (source, id) for multi-source support';
  RAISE NOTICE '  - user_id properly stores Mixpanel distinct_id';
  RAISE NOTICE '  - % conversations migrated', conversation_count;
  RAISE NOTICE '  - % messages migrated', message_count;
  RAISE NOTICE '';
  RAISE NOTICE '⚠️  IMPORTANT: Update all sync functions to use new schema';
  RAISE NOTICE '  - Set id = ticket.id (not UUID)';
  RAISE NOTICE '  - Set user_id = ticket.external_id (Mixpanel distinct_id)';
  RAISE NOTICE '  - Use (source, id) for upsert conflict resolution';
END $$;
