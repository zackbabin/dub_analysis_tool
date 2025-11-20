-- Migration: Add message_count to raw_support_conversations
-- Created: 2025-11-20
-- Purpose: Store message count directly to avoid expensive joins with support_conversation_messages

-- Add message_count column
ALTER TABLE raw_support_conversations
ADD COLUMN IF NOT EXISTS message_count INT DEFAULT 0;

-- Create index for queries that filter by message_count
CREATE INDEX IF NOT EXISTS idx_raw_conversations_message_count
ON raw_support_conversations(message_count)
WHERE message_count > 0;

-- Backfill existing data from support_conversation_messages
UPDATE raw_support_conversations c
SET message_count = (
  SELECT COUNT(*)
  FROM support_conversation_messages m
  WHERE m.conversation_id = c.id
)
WHERE EXISTS (
  SELECT 1 FROM support_conversation_messages m WHERE m.conversation_id = c.id
);

-- Create RPC function to update message count for a conversation
CREATE OR REPLACE FUNCTION update_conversation_message_count(p_conversation_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE raw_support_conversations
  SET message_count = (
    SELECT COUNT(*)
    FROM support_conversation_messages
    WHERE conversation_id = p_conversation_id
  )
  WHERE id = p_conversation_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users (Edge Functions use service role)
GRANT EXECUTE ON FUNCTION update_conversation_message_count(UUID) TO authenticated, service_role;

-- Verification
DO $$
BEGIN
  RAISE NOTICE '✅ message_count column added to raw_support_conversations';
  RAISE NOTICE '  - Default value: 0';
  RAISE NOTICE '  - Index created for message_count > 0';
  RAISE NOTICE '  - Backfilled existing message counts';
  RAISE NOTICE '  - RPC function update_conversation_message_count created';
END $$;
