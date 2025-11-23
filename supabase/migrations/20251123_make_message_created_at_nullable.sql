-- Migration: Make support_conversation_messages.created_at nullable
-- Created: 2025-11-23
-- Purpose: Allow storing messages without created_at timestamp
--
-- Issue: Some Zendesk comment events don't have created_at field
-- Solution: Make column nullable and update unique constraint to handle nulls

-- Drop existing unique constraint that requires created_at
DROP INDEX IF EXISTS idx_support_messages_conversation_created_author;

-- Make created_at nullable
ALTER TABLE support_conversation_messages
ALTER COLUMN created_at DROP NOT NULL;

-- Create partial unique index that handles nulls gracefully
-- For messages WITH created_at: enforce uniqueness on (source, id, created_at, author_id)
CREATE UNIQUE INDEX idx_support_messages_with_timestamp
ON support_conversation_messages(conversation_source, conversation_id, created_at, author_id)
WHERE created_at IS NOT NULL;

-- For messages WITHOUT created_at: use raw_data->>'id' (Zendesk comment ID) for uniqueness
-- This prevents duplicate inserts of the same Zendesk comment
CREATE UNIQUE INDEX idx_support_messages_without_timestamp
ON support_conversation_messages(conversation_source, conversation_id, (raw_data->>'id'))
WHERE created_at IS NULL AND raw_data->>'id' IS NOT NULL;

COMMENT ON COLUMN support_conversation_messages.created_at IS
'Message creation timestamp. May be null for some Zendesk events that lack this field.';
