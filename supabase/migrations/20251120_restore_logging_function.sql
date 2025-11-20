-- Migration: Restore log_materialized_view_refresh function
-- Date: 2025-11-20
--
-- The log_materialized_view_refresh function was incorrectly dropped in 20251119_drop_unused_objects.sql
-- It is still called by several refresh functions (refresh_portfolio_breakdown_view, etc.)
-- This migration restores the function as a no-op to prevent errors

-- Restore the logging function as a no-op (we don't need the logging table anymore)
CREATE OR REPLACE FUNCTION log_materialized_view_refresh(
  p_view_name text,
  p_refresh_duration_ms integer DEFAULT NULL,
  p_rows_affected bigint DEFAULT NULL
)
RETURNS void AS $$
BEGIN
  -- No-op: Just prevent errors when refresh functions call this
  -- We removed the materialized_view_refresh_log table to save space
  -- but refresh functions still call this, so we need a stub
  NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION log_materialized_view_refresh IS
'Stub function to prevent errors when refresh functions call this. The actual logging table was removed to save disk space.';

-- Grant permissions
GRANT EXECUTE ON FUNCTION log_materialized_view_refresh(text, integer, bigint) TO anon;
GRANT EXECUTE ON FUNCTION log_materialized_view_refresh(text, integer, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION log_materialized_view_refresh(text, integer, bigint) TO service_role;
