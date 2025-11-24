-- Migration: Add refresh function for enriched_support_conversations
-- Created: 2025-11-24
-- Purpose: Allow materialized view refresh from Edge Functions

-- Create RPC function to refresh enriched_support_conversations materialized view
CREATE OR REPLACE FUNCTION refresh_enriched_support_conversations()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY enriched_support_conversations;
  RAISE NOTICE 'Refreshed enriched_support_conversations materialized view';
END;
$$;

-- Grant execute permission to service_role and authenticated users
GRANT EXECUTE ON FUNCTION refresh_enriched_support_conversations() TO service_role, authenticated;

COMMENT ON FUNCTION refresh_enriched_support_conversations() IS
  'Refreshes the enriched_support_conversations materialized view.
   Called by refresh-materialized-views edge function after CX Analysis workflow completes.
   Uses CONCURRENTLY to allow reads during refresh.';
