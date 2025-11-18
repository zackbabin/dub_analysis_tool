-- Fix cron job to reference correct Edge Function name
-- Issue: sync-user-events-daily references archived sync-mixpanel-user-events
-- Fix: Update to use sync-mixpanel-user-events-v2
-- Date: 2025-11-18

-- Unschedule the incorrectly named job
SELECT cron.unschedule('sync-user-events-daily');

-- Recreate with correct function name
SELECT cron.schedule(
  'sync-user-events-daily',
  '0 2 * * *',
  $$SELECT net.http_post(
    url := 'https://rnpfeblxapdafrbmomix.supabase.co/functions/v1/sync-mixpanel-user-events-v2',
    headers := '{"Authorization": "Bearer ' || current_setting('app.settings.service_role_key') || '", "Content-Type": "application/json"}',
    body := '{}'
  )$$
);

-- Log the fix
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Fixed sync-user-events-daily cron job';
  RAISE NOTICE '   Old: sync-mixpanel-user-events (archived)';
  RAISE NOTICE '   New: sync-mixpanel-user-events-v2 (active)';
  RAISE NOTICE '   Schedule: 2:00 AM UTC daily';
  RAISE NOTICE '';
END $$;
