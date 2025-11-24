-- Migration: Recreate event_sequences_raw table for batch insert approach
-- Created: 2025-11-24
-- Purpose: Restore event_sequences_raw table for efficient 2-step event processing
--
-- CONTEXT:
-- Previous approach tried to aggregate 80k events in JavaScript, causing CPU timeouts.
-- New approach: batch insert raw events to staging table, then aggregate in Postgres.
-- This pattern is proven to work with portfolio_engagement_staging → user_portfolio_creator_engagement.
--
-- ARCHITECTURE:
-- Step 1: sync-event-sequences-v2 batch inserts to event_sequences_raw (simple flat rows)
-- Step 2: process-event-sequences aggregates with SQL (GROUP BY + json_agg) to user_event_sequences
-- Step 3: analyze-event-sequences runs Claude AI analysis

-- Recreate event_sequences_raw table
CREATE TABLE IF NOT EXISTS event_sequences_raw (
  id bigserial PRIMARY KEY,
  distinct_id text NOT NULL,
  event_name text NOT NULL,
  event_time timestamptz NOT NULL,
  portfolio_ticker text,
  creator_username text,
  synced_at timestamptz NOT NULL,
  processed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_event_sequences_raw_distinct_id
  ON event_sequences_raw(distinct_id);

CREATE INDEX IF NOT EXISTS idx_event_sequences_raw_processed_at
  ON event_sequences_raw(processed_at) WHERE processed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_event_sequences_raw_synced_at
  ON event_sequences_raw(synced_at DESC);

-- Grant permissions
GRANT SELECT, INSERT, UPDATE ON event_sequences_raw TO service_role, authenticated;
GRANT USAGE, SELECT ON SEQUENCE event_sequences_raw_id_seq TO service_role, authenticated;

COMMENT ON TABLE event_sequences_raw IS
'Staging table for raw Mixpanel event data. Events are batch inserted here, then aggregated
by process-event-sequences into user_event_sequences. Rows marked with processed_at after aggregation.';

COMMENT ON COLUMN event_sequences_raw.distinct_id IS 'User ID from Mixpanel (sanitized)';
COMMENT ON COLUMN event_sequences_raw.event_name IS 'Event name: "Viewed Creator Profile" or "Viewed Portfolio Details"';
COMMENT ON COLUMN event_sequences_raw.event_time IS 'When the event occurred (from Mixpanel)';
COMMENT ON COLUMN event_sequences_raw.portfolio_ticker IS 'Portfolio ticker (for "Viewed Portfolio Details" events)';
COMMENT ON COLUMN event_sequences_raw.creator_username IS 'Creator username (for "Viewed Creator Profile" events)';
COMMENT ON COLUMN event_sequences_raw.synced_at IS 'When this event was synced from Mixpanel';
COMMENT ON COLUMN event_sequences_raw.processed_at IS 'When this event was aggregated into user_event_sequences (NULL = not yet processed)';
