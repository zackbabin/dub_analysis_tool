-- Fix clear_events_staging to use TRUNCATE instead of DELETE
-- TRUNCATE bypasses RLS policies and doesn't require WHERE clause
-- Date: 2025-11-17

CREATE OR REPLACE FUNCTION clear_events_staging()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count bigint;
BEGIN
  -- Get count before truncating
  SELECT COUNT(*) INTO v_count FROM raw_mixpanel_events_staging;

  -- Use TRUNCATE instead of DELETE (bypasses RLS and is much faster)
  TRUNCATE TABLE raw_mixpanel_events_staging;

  RETURN v_count;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION clear_events_staging() TO service_role, authenticated, anon;

COMMENT ON FUNCTION clear_events_staging() IS
'Truncates raw_mixpanel_events_staging table. Uses TRUNCATE to bypass RLS and improve performance.';
