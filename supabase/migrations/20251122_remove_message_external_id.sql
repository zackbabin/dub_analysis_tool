-- Migration: Remove external_id from support_conversation_messages
-- Created: 2025-11-22
-- Purpose: Simplify schema by removing redundant external_id column
--
-- Rationale:
--   - external_id was storing Zendesk comment.id for uniqueness
--   - Already have (conversation_source, conversation_id) mapping to ticket
--   - Comment ID is preserved in raw_data JSONB
--   - Can use UUID primary key for uniqueness instead
--   - This avoids confusion with ticket.external_id (which stores Mixpanel distinct_id)

-- Drop the UNIQUE constraint that includes external_id
ALTER TABLE support_conversation_messages
DROP CONSTRAINT IF EXISTS support_conversation_messages_conversation_external_id_key;

-- Drop the external_id column
ALTER TABLE support_conversation_messages
DROP COLUMN IF EXISTS external_id;

-- Add new UNIQUE constraint using UUID primary key
-- This prevents duplicate messages from being inserted
-- Note: The id column is already a UUID PRIMARY KEY, which is unique by definition
-- We just need to ensure (conversation_source, conversation_id, created_at) combo is reasonably unique
-- for upsert operations

-- Create composite index for upserts (helps with ON CONFLICT)
CREATE UNIQUE INDEX IF NOT EXISTS idx_support_messages_conversation_created_author
ON support_conversation_messages(conversation_source, conversation_id, created_at, author_id);

-- Add comment to clarify the schema
COMMENT ON TABLE support_conversation_messages IS
'Messages/comments within support conversations.
Primary key (id) is UUID for uniqueness.
Foreign key (conversation_source, conversation_id) links to raw_support_conversations(source, id).
Zendesk comment.id is preserved in raw_data JSONB if needed.';

COMMENT ON COLUMN support_conversation_messages.conversation_id IS
'Links to raw_support_conversations.id (Zendesk ticket ID as TEXT, e.g., "12345")';

COMMENT ON COLUMN support_conversation_messages.conversation_source IS
'Links to raw_support_conversations.source (e.g., "zendesk")';
