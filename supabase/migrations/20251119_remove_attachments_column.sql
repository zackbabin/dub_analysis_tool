-- Migration: Remove attachments column from support_conversation_messages
-- Attachments should not be fetched or stored for privacy reasons

-- Drop attachments column
ALTER TABLE support_conversation_messages
DROP COLUMN IF EXISTS attachments;
