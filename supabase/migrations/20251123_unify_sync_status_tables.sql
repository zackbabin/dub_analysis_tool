-- Migration: Unify sync status tracking tables
-- Created: 2025-11-23
-- Purpose: Consolidate support_sync_status and event_sequences_sync_status into a single sync_status table
--          This table tracks the last successful sync timestamp for incremental syncing
--          sync_logs continues to log individual executions

-- Create unified sync_status table
CREATE TABLE IF NOT EXISTS sync_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  tool_type TEXT NOT NULL,
  last_sync_timestamp TIMESTAMPTZ,
  last_sync_status TEXT CHECK (last_sync_status IN ('success', 'failed', 'in_progress')),
  records_synced INTEGER DEFAULT 0,
  error_message TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT sync_status_unique_source_tool UNIQUE (source, tool_type)
);

CREATE INDEX IF NOT EXISTS idx_sync_status_source_tool ON sync_status(source, tool_type);

COMMENT ON TABLE sync_status IS
  'Tracks last successful sync timestamp for incremental syncing across all data sources';

COMMENT ON COLUMN sync_status.source IS
  'Data source identifier (e.g., mixpanel, zendesk, instabug)';

COMMENT ON COLUMN sync_status.tool_type IS
  'Type of sync workflow (e.g., user, support, event_sequences)';

COMMENT ON COLUMN sync_status.last_sync_timestamp IS
  'Timestamp of last successful sync - used as from_date for next incremental sync';

-- Migrate data from support_sync_status
INSERT INTO sync_status (source, tool_type, last_sync_timestamp, last_sync_status, records_synced, error_message, updated_at, created_at)
SELECT
  source,
  'support' as tool_type,
  last_sync_timestamp,
  last_sync_status,
  COALESCE(conversations_synced, 0) + COALESCE(messages_synced, 0) as records_synced,
  error_message,
  updated_at,
  NOW() as created_at
FROM support_sync_status
ON CONFLICT (source, tool_type) DO UPDATE SET
  last_sync_timestamp = EXCLUDED.last_sync_timestamp,
  last_sync_status = EXCLUDED.last_sync_status,
  records_synced = EXCLUDED.records_synced,
  error_message = EXCLUDED.error_message,
  updated_at = EXCLUDED.updated_at;

-- Migrate data from event_sequences_sync_status
INSERT INTO sync_status (source, tool_type, last_sync_timestamp, last_sync_status, records_synced, error_message, updated_at, created_at)
SELECT
  source,
  'event_sequences' as tool_type,
  last_sync_timestamp,
  last_sync_status,
  events_synced as records_synced,
  error_message,
  updated_at,
  created_at
FROM event_sequences_sync_status
ON CONFLICT (source, tool_type) DO UPDATE SET
  last_sync_timestamp = EXCLUDED.last_sync_timestamp,
  last_sync_status = EXCLUDED.last_sync_status,
  records_synced = EXCLUDED.records_synced,
  error_message = EXCLUDED.error_message,
  updated_at = EXCLUDED.updated_at;

-- Drop old tables (commented out for safety - uncomment after verifying migration)
-- DROP TABLE IF EXISTS support_sync_status;
-- DROP TABLE IF EXISTS event_sequences_sync_status;

COMMENT ON TABLE sync_status IS
  'Unified table for tracking last successful sync timestamps across all workflows. Use this for incremental sync logic. Use sync_logs for execution history.';
