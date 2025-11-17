-- Optimize event sequences by moving sorting to Postgres
-- Instead of sorting events in JavaScript, let Postgres handle it with JSONB operations
-- This eliminates CPU bottleneck in the Edge Function
-- Date: 2025-11-17

-- Function to get event sequences with events sorted by timestamp
-- This replaces the JavaScript sorting logic in sync-event-sequences
CREATE OR REPLACE FUNCTION get_sorted_event_sequences(user_distinct_id text DEFAULT NULL)
RETURNS TABLE (
  distinct_id text,
  event_data jsonb,
  synced_at timestamptz
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    distinct_id,
    (
      SELECT jsonb_agg(elem ORDER BY (elem->>'time')::timestamptz)
      FROM jsonb_array_elements(event_data) AS elem
    ) AS event_data,
    synced_at
  FROM event_sequences_raw
  WHERE user_distinct_id IS NULL OR distinct_id = user_distinct_id;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_sorted_event_sequences(text) TO service_role;
GRANT EXECUTE ON FUNCTION get_sorted_event_sequences(text) TO anon;
GRANT EXECUTE ON FUNCTION get_sorted_event_sequences(text) TO authenticated;

COMMENT ON FUNCTION get_sorted_event_sequences(text) IS
'Returns event sequences with events sorted by timestamp. Sorting is done in Postgres (much faster than JavaScript).
Pass distinct_id to get a single user, or NULL to get all users.';

-- Create a view for convenience (optional but useful)
CREATE OR REPLACE VIEW event_sequences_sorted AS
SELECT
  distinct_id,
  (
    SELECT jsonb_agg(elem ORDER BY (elem->>'time')::timestamptz)
    FROM jsonb_array_elements(event_data) AS elem
  ) AS event_data,
  synced_at
FROM event_sequences_raw;

GRANT SELECT ON event_sequences_sorted TO service_role;
GRANT SELECT ON event_sequences_sorted TO anon;
GRANT SELECT ON event_sequences_sorted TO authenticated;

COMMENT ON VIEW event_sequences_sorted IS
'View of event_sequences_raw with events sorted by timestamp. Use this instead of raw table when you need sorted events.';
