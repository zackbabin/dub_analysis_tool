-- Migration: Create function to populate user_id in event_sequences_raw
-- Created: 2025-11-25
-- Purpose: Join event_sequences_raw.distinct_id with user_first_copies.distinct_id to get user_id
--
-- Background:
-- - event_sequences_raw has distinct_id (from Export API) but user_id is NULL
-- - user_first_copies has the mapping: distinct_id → user_id (from chart 86612901)
-- - Need to populate user_id in event_sequences_raw for analysis

CREATE OR REPLACE FUNCTION populate_event_sequences_user_id()
RETURNS TABLE (
  rows_updated bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows_updated bigint;
BEGIN
  -- Update event_sequences_raw.user_id by joining with user_first_copies
  -- This populates the user_id for conversion funnel analysis
  UPDATE event_sequences_raw esr
  SET user_id = ufc.user_id
  FROM user_first_copies ufc
  WHERE esr.distinct_id = ufc.distinct_id
    AND esr.user_id IS NULL;  -- Only update NULL user_ids

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  -- Return count
  RETURN QUERY SELECT v_rows_updated;
END;
$$;

GRANT EXECUTE ON FUNCTION populate_event_sequences_user_id() TO service_role, authenticated;

COMMENT ON FUNCTION populate_event_sequences_user_id() IS
'Populates user_id in event_sequences_raw by joining with user_first_copies on distinct_id.
Should be called after sync-event-sequences-v2 completes to enable conversion funnel analysis.
Returns count of rows updated.';

-- Log the changes
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Created populate_event_sequences_user_id() function';
  RAISE NOTICE '   - Joins event_sequences_raw.distinct_id → user_first_copies.distinct_id → user_id';
  RAISE NOTICE '   - Call this after sync-event-sequences-v2 to populate user_id column';
  RAISE NOTICE '';
END $$;
