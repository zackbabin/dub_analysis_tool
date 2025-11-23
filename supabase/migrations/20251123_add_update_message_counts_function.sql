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
  -- p_conversation_ids contains external conversation IDs (e.g., Zendesk ticket IDs like '12345')
  -- Maps: support_conversation_messages.conversation_id -> raw_support_conversations.id
  -- Both are TEXT fields containing the external ID from the source system
  UPDATE raw_support_conversations c
  SET message_count = (
    SELECT COUNT(*)
    FROM support_conversation_messages m
    WHERE m.conversation_source = c.source        -- Match source (zendesk, instabug, etc.)
      AND m.conversation_id = c.id                -- Match external conversation ID (TEXT to TEXT)
      AND m.is_public = true                      -- Only count public messages
  )
  WHERE c.source = p_source                       -- Filter by source
    AND c.id = ANY(p_conversation_ids);           -- Filter by external conversation IDs

  -- Log how many conversations were updated
  RAISE NOTICE 'Updated message_count for % conversations from source %',
    array_length(p_conversation_ids, 1), p_source;
END;
$$;

COMMENT ON FUNCTION update_support_message_counts IS
  'Updates message_count column in raw_support_conversations by counting public messages (is_public = true) from support_conversation_messages for specified conversations';
