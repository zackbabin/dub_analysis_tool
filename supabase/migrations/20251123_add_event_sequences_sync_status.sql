-- Migration: Add sync status tracking for event sequences
-- Created: 2025-11-23
-- Purpose: Enable incremental sync for event sequences to avoid timeouts

-- Create sync status table for tracking last sync timestamp
CREATE TABLE IF NOT EXISTS event_sequences_sync_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL DEFAULT 'mixpanel' UNIQUE,
  last_sync_timestamp TIMESTAMPTZ,
  last_sync_status TEXT CHECK (last_sync_status IN ('success', 'failed', 'in_progress')),
  events_synced INTEGER DEFAULT 0,
  error_message TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert initial row for mixpanel
INSERT INTO event_sequences_sync_status (source, last_sync_timestamp, last_sync_status)
VALUES ('mixpanel', NULL, 'success')
ON CONFLICT (source) DO NOTHING;

-- Create index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_event_sequences_sync_status_source
ON event_sequences_sync_status(source);

COMMENT ON TABLE event_sequences_sync_status IS
  'Tracks sync status for event sequences to enable incremental sync';

COMMENT ON COLUMN event_sequences_sync_status.last_sync_timestamp IS
  'Timestamp of last successful sync - NULL means never synced (backfill needed)';

COMMENT ON COLUMN event_sequences_sync_status.source IS
  'Source system name (currently only mixpanel)';
