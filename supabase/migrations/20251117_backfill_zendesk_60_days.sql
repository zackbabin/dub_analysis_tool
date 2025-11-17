-- One-time backfill: Reset Zendesk sync to pull 60 days of historical data
-- This will cause the next sync to fetch tickets from the last 60 days instead of incremental

-- Update Zendesk sync status to look back 60 days
UPDATE support_sync_status
SET
  last_sync_timestamp = NOW() - INTERVAL '60 days',
  last_sync_status = 'in_progress',
  conversations_synced = 0,
  messages_synced = 0,
  error_message = 'Backfill initiated: Will sync last 60 days of data',
  updated_at = NOW()
WHERE source = 'zendesk';

-- Verify the update
SELECT
  source,
  last_sync_timestamp,
  DATE(last_sync_timestamp) as sync_date,
  EXTRACT(DAY FROM NOW() - last_sync_timestamp) as days_ago,
  last_sync_status,
  error_message
FROM support_sync_status
WHERE source = 'zendesk';

-- Instructions:
-- 1. Run this SQL once to reset the sync timestamp to 60 days ago
-- 2. Set environment variable: ANALYSIS_LOOKBACK_DAYS=60
-- 3. Trigger sync-support-conversations edge function (may need 2-3 runs)
-- 4. Monitor progress with queries in ZENDESK_BACKFILL_SETUP.md
-- 5. When complete, last_sync_timestamp will update to NOW
-- 6. Future syncs will be incremental from that point forward
