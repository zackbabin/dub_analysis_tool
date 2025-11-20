-- Add separate tracking for messages sync to support_sync_status table
-- This allows sync-support-messages to track its own incremental sync timestamp
-- separate from sync-support-conversations

ALTER TABLE support_sync_status
ADD COLUMN IF NOT EXISTS last_messages_sync_timestamp TIMESTAMPTZ;

-- Add comment for documentation
COMMENT ON COLUMN support_sync_status.last_messages_sync_timestamp IS
'Tracks last sync timestamp for messages/comments separately from conversations. Used by sync-support-messages edge function.';

-- Verify the column was added
SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'support_sync_status'
  AND column_name LIKE '%sync%timestamp%'
ORDER BY ordinal_position;
