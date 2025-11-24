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

  -- Aggregate new events by user
  -- For each user with new events, combine with existing events (if any)
  WITH new_events AS (
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
  ),
  combined_sequences AS (
    SELECT
      COALESCE(ues.distinct_id, ne.distinct_id) AS distinct_id,
      CASE
        -- If existing sequence exists, merge and deduplicate
        -- OPTIMIZATION: Use DISTINCT ON to deduplicate by (event, time) before aggregating
        -- This avoids duplicate events from overlapping sync windows
        WHEN ues.event_sequence IS NOT NULL THEN (
          SELECT json_agg(event ORDER BY event_time ASC)
          FROM (
            SELECT DISTINCT ON (event->>'event', event->>'time')
              event,
              (event->>'time')::timestamptz AS event_time
            FROM (
              SELECT json_array_elements(ues.event_sequence || ne.event_sequence) AS event
            ) combined
            ORDER BY event->>'event', event->>'time', event
          ) deduplicated
        )
        -- Otherwise, use new events only
        ELSE ne.event_sequence
      END AS event_sequence,
      ne.synced_at
    FROM new_events ne
    LEFT JOIN user_event_sequences ues ON ues.distinct_id = ne.distinct_id
  )
  INSERT INTO user_event_sequences (
    distinct_id,
    event_sequence,
    synced_at
  )
  SELECT
    distinct_id,
    event_sequence,
    synced_at
  FROM combined_sequences
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
