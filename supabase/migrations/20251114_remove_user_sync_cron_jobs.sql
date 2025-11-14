-- Remove cron jobs for user sync functions
-- These are now part of the "Sync Live Data" manual workflow instead

-- Unschedule user events cron job
SELECT cron.unschedule('mixpanel-user-events-daily') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'mixpanel-user-events-daily'
);

-- Unschedule user properties cron job
SELECT cron.unschedule('user-properties-sync-daily') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'user-properties-sync-daily'
);

-- Drop trigger functions (no longer needed)
DROP FUNCTION IF EXISTS trigger_mixpanel_user_events();
DROP FUNCTION IF EXISTS trigger_user_properties_sync();

-- Verify cron jobs are removed
SELECT jobid, jobname, schedule, command, active
FROM cron.job
WHERE jobname IN ('mixpanel-user-events-daily', 'user-properties-sync-daily')
ORDER BY jobname;

COMMENT ON SCHEMA public IS
'User sync cron jobs removed - sync-mixpanel-user-events and sync-mixpanel-user-properties-v2 are now part of manual "Sync Live Data" workflow';
