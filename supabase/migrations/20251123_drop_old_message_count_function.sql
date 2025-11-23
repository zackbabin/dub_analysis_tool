-- Migration: Drop deprecated update_conversation_message_count function
-- Created: 2025-11-23
-- Purpose: Remove old UUID-based function that doesn't match current TEXT-based schema
--          Replaced by update_support_message_counts which handles composite keys and batches

-- Drop the old function
DROP FUNCTION IF EXISTS update_conversation_message_count(UUID);

COMMENT ON FUNCTION update_support_message_counts IS
  'Updates message_count column in raw_support_conversations by counting public messages.
   Handles TEXT-based conversation IDs and composite (source, id) keys.
   Processes multiple conversations in a single call for efficiency.';
