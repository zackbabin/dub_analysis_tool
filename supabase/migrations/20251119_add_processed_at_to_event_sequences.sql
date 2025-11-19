-- Add processed_at tracking to event_sequences_raw
-- This allows process-event-sequences to track which events have been processed
-- and avoids reprocessing the same old events on every run

-- Add processed_at column
ALTER TABLE event_sequences_raw
ADD COLUMN IF NOT EXISTS processed_at timestamp with time zone;

-- Add index for efficient queries (NULL values first = unprocessed events)
CREATE INDEX IF NOT EXISTS idx_event_sequences_raw_processed_at
ON event_sequences_raw (processed_at NULLS FIRST, event_time ASC);

-- Add comment
COMMENT ON COLUMN event_sequences_raw.processed_at IS 'Timestamp when this event was processed by process-event-sequences. NULL = not yet processed.';
