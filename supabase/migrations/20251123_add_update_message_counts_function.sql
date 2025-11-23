-- Migration: Add function to update support conversation message counts
-- Created: 2025-11-23
-- Purpose: Efficiently update message_count column for conversations after syncing messages

CREATE OR REPLACE FUNCTION update_support_message_counts(
  p_source TEXT,
  p_conversation_ids TEXT[]
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Update message_count for specified conversations
  -- Counts only public messages from support_conversation_messages and updates raw_support_conversations
  UPDATE raw_support_conversations c
  SET message_count = (
    SELECT COUNT(*)
    FROM support_conversation_messages m
    WHERE m.conversation_source = p_source
      AND m.conversation_id = c.id
      AND m.is_public = true  -- Only count public messages
  )
  WHERE c.source = p_source
    AND c.id = ANY(p_conversation_ids);
END;
$$;

COMMENT ON FUNCTION update_support_message_counts IS
  'Updates message_count column in raw_support_conversations by counting public messages (is_public = true) from support_conversation_messages for specified conversations';
