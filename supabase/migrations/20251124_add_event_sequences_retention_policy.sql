-- Add data retention policy for event_sequences_raw table
-- Automatically delete events older than 30 days to prevent unbounded growth
-- Date: 2024-11-24

-- Create function to clean up old event sequences
CREATE OR REPLACE FUNCTION cleanup_old_event_sequences()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted bigint;
  v_cutoff_date timestamptz;
BEGIN
  -- Delete events older than 30 days
  v_cutoff_date := NOW() - INTERVAL '30 days';

  DELETE FROM event_sequences_raw
  WHERE event_time < v_cutoff_date;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RAISE NOTICE 'Cleaned up % old event sequences (older than %)', v_deleted, v_cutoff_date;
END;
$$;

COMMENT ON FUNCTION cleanup_old_event_sequences() IS
'Deletes event sequences older than 30 days to prevent unbounded table growth.
Should be run daily via cron or after each sync.';

-- Grant execute permission
GRANT EXECUTE ON FUNCTION cleanup_old_event_sequences() TO service_role;

-- Run initial cleanup
SELECT cleanup_old_event_sequences();

-- ============================================================================
-- Add index on event_time for efficient cleanup queries
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_event_sequences_raw_event_time
  ON event_sequences_raw(event_time DESC);

COMMENT ON INDEX idx_event_sequences_raw_event_time IS
'Optimizes cleanup queries and date range filtering in analyze function';

-- ============================================================================
-- Log the change
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Added data retention policy for event_sequences_raw';
  RAISE NOTICE '   - Retention: 30 days';
  RAISE NOTICE '   - Cleanup function: cleanup_old_event_sequences()';
  RAISE NOTICE '   - Added index on event_time for efficient queries';
  RAISE NOTICE '   - Run cleanup after each sync to maintain performance';
  RAISE NOTICE '';
END $$;
