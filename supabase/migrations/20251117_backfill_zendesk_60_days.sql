-- One-time backfill: Reset Zendesk sync to pull 60 days of historical data
-- This will cause the next sync to fetch tickets from the last 60 days instead of incremental

-- Update Zendesk sync status to look back 60 days
UPDATE support_sync_status
SET
  last_sync_timestamp = NOW() - INTERVAL '60 days',
  last_sync_status = 'pending_backfill',
  error_message = 'Backfill: Reset to sync last 60 days of data'
WHERE source = 'zendesk';

-- Verify the update
SELECT
  source,
  last_sync_timestamp,
  last_sync_status,
  error_message
FROM support_sync_status
WHERE source = 'zendesk';

-- Instructions:
-- 1. Run this SQL once to reset the sync timestamp
-- 2. Trigger sync-support-conversations edge function
-- 3. It will fetch all tickets from the last 60 days
-- 4. Future syncs will be incremental from that point forward
