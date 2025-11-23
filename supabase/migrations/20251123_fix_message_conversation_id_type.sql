-- Migration: Fix support_conversation_messages.conversation_id type mismatch
-- Created: 2025-11-23
-- Purpose: Change conversation_id from UUID to TEXT to match raw_support_conversations.id
--          This allows proper joining and the update_support_message_counts function to work

-- Drop the foreign key constraint (references UUID)
ALTER TABLE support_conversation_messages DROP CONSTRAINT IF EXISTS support_conversation_messages_conversation_id_fkey;

-- Drop the unique constraint that uses the old column
ALTER TABLE support_conversation_messages DROP CONSTRAINT IF EXISTS support_conversation_messages_conversation_id_external_id_key;

-- Change conversation_id column type from UUID to TEXT
ALTER TABLE support_conversation_messages
  ALTER COLUMN conversation_id TYPE TEXT;

-- Add new composite primary key (source + id) matching raw_support_conversations
-- But first we need to add a source column to support_conversation_messages
ALTER TABLE support_conversation_messages
  ADD COLUMN IF NOT EXISTS conversation_source TEXT DEFAULT 'zendesk';

-- Recreate the unique constraint with the new type
ALTER TABLE support_conversation_messages
  ADD CONSTRAINT support_conversation_messages_conversation_unique
  UNIQUE(conversation_source, conversation_id, external_id);

-- Add foreign key constraint with composite key (source + id)
ALTER TABLE support_conversation_messages
  ADD CONSTRAINT support_conversation_messages_conversation_fkey
  FOREIGN KEY (conversation_source, conversation_id)
  REFERENCES raw_support_conversations(source, id) ON DELETE CASCADE;

-- Update indexes
DROP INDEX IF EXISTS idx_support_messages_conversation;
CREATE INDEX idx_support_messages_conversation ON support_conversation_messages(conversation_source, conversation_id);

COMMENT ON COLUMN support_conversation_messages.conversation_id IS
  'External conversation ID (Zendesk ticket ID, Instabug thread ID, etc.) - matches raw_support_conversations.id';
COMMENT ON COLUMN support_conversation_messages.conversation_source IS
  'Source system for the conversation (zendesk, instabug, notion) - matches raw_support_conversations.source';
