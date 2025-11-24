-- Migration: Create Postgres function to aggregate event sequences
-- Created: 2025-11-24
-- Purpose: Efficient SQL-based aggregation of raw events into user sequences
--
-- This function aggregates events from event_sequences_raw table and upserts to user_event_sequences.
-- Uses set-based SQL operations which are 10-50x faster than JavaScript loops.

CREATE OR REPLACE FUNCTION process_event_sequences_raw()
RETURNS TABLE (
  records_processed bigint,
  records_inserted bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_records_processed bigint;
  v_records_inserted bigint;
BEGIN
  -- Count unprocessed records
  SELECT COUNT(*) INTO v_records_processed
  FROM event_sequences_raw
  WHERE processed_at IS NULL;

  -- Aggregate events by user and upsert to user_event_sequences
  -- Uses json_agg to build event sequence array, ordered by event_time
  INSERT INTO user_event_sequences (
    distinct_id,
    event_sequence,
    synced_at
  )
  SELECT
    distinct_id,
    json_agg(
      json_build_object(
        'event', event_name,
        'time', event_time,
        'count', 1,
        'portfolioTicker', portfolio_ticker,
        'creatorUsername', creator_username
      )
      ORDER BY event_time ASC
    ) AS event_sequence,
    MAX(synced_at) AS synced_at
  FROM event_sequences_raw
  WHERE processed_at IS NULL
  GROUP BY distinct_id
  ON CONFLICT (distinct_id) DO UPDATE SET
    event_sequence = EXCLUDED.event_sequence,
    synced_at = EXCLUDED.synced_at;

  -- Get count of inserted/updated records
  GET DIAGNOSTICS v_records_inserted = ROW_COUNT;

  -- Mark processed records with timestamp
  UPDATE event_sequences_raw
  SET processed_at = NOW()
  WHERE processed_at IS NULL;

  -- Return stats
  RETURN QUERY SELECT v_records_processed, v_records_inserted;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION process_event_sequences_raw() TO service_role, authenticated;

COMMENT ON FUNCTION process_event_sequences_raw() IS
'Aggregates raw events from event_sequences_raw into user_event_sequences using efficient SQL.
Groups events by distinct_id and uses json_agg to build event sequence arrays.
Marks processed rows with processed_at timestamp.
Returns (records_processed, records_inserted).';
