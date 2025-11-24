-- Migration: Optimize message count update function
-- Created: 2025-11-24
-- Purpose: Replace slow correlated subquery with efficient JOIN + GROUP BY

-- Drop old inefficient function
DROP FUNCTION IF EXISTS update_support_message_counts(TEXT, TEXT[]);

-- Create optimized function using single JOIN + GROUP BY instead of correlated subquery
CREATE OR REPLACE FUNCTION update_support_message_counts(
  p_source TEXT,
  p_conversation_ids TEXT[]
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Use CTE with single JOIN and GROUP BY - much faster than correlated subquery
  WITH message_counts AS (
    SELECT
      m.conversation_source,
      m.conversation_id,
      COUNT(*) as count
    FROM support_conversation_messages m
    WHERE m.conversation_source = p_source
      AND m.conversation_id = ANY(p_conversation_ids)
      AND m.is_public = true
    GROUP BY m.conversation_source, m.conversation_id
  )
  UPDATE raw_support_conversations c
  SET message_count = COALESCE(mc.count, 0)
  FROM message_counts mc
  WHERE c.source = mc.conversation_source
    AND c.id = mc.conversation_id;

  -- Also set message_count = 0 for conversations with no messages
  UPDATE raw_support_conversations c
  SET message_count = 0
  WHERE c.source = p_source
    AND c.id = ANY(p_conversation_ids)
    AND c.message_count IS NULL;

  RAISE NOTICE 'Updated message_count for % conversations from source %',
    array_length(p_conversation_ids, 1), p_source;
END;
$$;

COMMENT ON FUNCTION update_support_message_counts IS
  'Efficiently updates message_count column in raw_support_conversations using single JOIN + GROUP BY instead of correlated subquery. Counts only public messages (is_public = true).';

-- Verify index exists for optimal performance
-- This should already exist from 20251123_fix_message_conversation_id_type.sql
CREATE INDEX IF NOT EXISTS idx_support_messages_conversation_source_id
  ON support_conversation_messages(conversation_source, conversation_id);

-- Additional index to speed up the is_public filter
CREATE INDEX IF NOT EXISTS idx_support_messages_public
  ON support_conversation_messages(conversation_source, conversation_id, is_public)
  WHERE is_public = true;
