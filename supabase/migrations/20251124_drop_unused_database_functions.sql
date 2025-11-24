-- Drop 7 unused database functions
-- These functions were either never used, only used in archived code,
-- or their consumers (cron jobs) have been permanently disabled
-- Date: 2024-11-24

-- ============================================================================
-- Drop unused helper functions
-- ============================================================================

-- 1. cleanup_old_events - Never actively used, only mentioned in archived code
DROP FUNCTION IF EXISTS public.cleanup_old_events(integer);

-- 2. clear_events_staging - Only used in archived edge functions
DROP FUNCTION IF EXISTS public.clear_events_staging();

-- 3. get_distinct_creator_usernames - Created but never utilized
DROP FUNCTION IF EXISTS public.get_distinct_creator_usernames(text[]);

-- 4. get_last_portfolio_event_timestamp - Intended for incremental sync that was never implemented
DROP FUNCTION IF EXISTS public.get_last_portfolio_event_timestamp();

-- 5. get_last_successful_sync_time - Intended for incremental sync that was never implemented
DROP FUNCTION IF EXISTS public.get_last_successful_sync_time(text);

-- 6. process_mixpanel_sync - Orphaned after cron job was removed
DROP FUNCTION IF EXISTS public.process_mixpanel_sync();

-- 7. invoke_edge_function - Only used by cron jobs that are permanently disabled
DROP FUNCTION IF EXISTS public.invoke_edge_function(text);

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '===============================================';
  RAISE NOTICE 'Dropped 7 unused database functions:';
  RAISE NOTICE '  ✓ cleanup_old_events()';
  RAISE NOTICE '  ✓ clear_events_staging()';
  RAISE NOTICE '  ✓ get_distinct_creator_usernames()';
  RAISE NOTICE '  ✓ get_last_portfolio_event_timestamp()';
  RAISE NOTICE '  ✓ get_last_successful_sync_time()';
  RAISE NOTICE '  ✓ process_mixpanel_sync()';
  RAISE NOTICE '  ✓ invoke_edge_function()';
  RAISE NOTICE '===============================================';
END $$;
