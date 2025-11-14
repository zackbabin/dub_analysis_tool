-- Update cron job to use renamed function: sync-mixpanel-user-events
-- Old name: sync-mixpanel-users-v2
-- New name: sync-mixpanel-user-events (clearer naming for Export API events sync)

-- Drop existing function
DROP FUNCTION IF EXISTS trigger_mixpanel_v2_incremental();

-- Create trigger function with new name
CREATE OR REPLACE FUNCTION trigger_mixpanel_user_events()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  supabase_url text;
  service_key text;
BEGIN
  SELECT sc.supabase_url, sc.service_key
  INTO supabase_url, service_key
  FROM supabase_config sc
  WHERE id = 1;

  RAISE NOTICE 'Triggering sync-mixpanel-user-events (incremental mode - yesterday only)...';

  -- Queue async HTTP request - fire and forget
  -- Fetches yesterday's events from Export API and ADD counts to existing database totals
  PERFORM net.http_post(
    url := supabase_url || '/functions/v1/sync-mixpanel-user-events',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || service_key,
      'apikey', service_key,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000  -- 2.5 min timeout
  );

  RAISE NOTICE 'sync-mixpanel-user-events incremental request queued';
END;
$$;

-- Unschedule old cron job
SELECT cron.unschedule('mixpanel-v2-incremental-daily') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'mixpanel-v2-incremental-daily'
);

-- Schedule daily incremental sync at 2:00 AM UTC with new name
SELECT cron.schedule(
  'mixpanel-user-events-daily',
  '0 2 * * *',  -- 2:00 AM UTC daily
  'SELECT trigger_mixpanel_user_events();'
);

COMMENT ON FUNCTION trigger_mixpanel_user_events() IS
'Triggers daily user events sync from Mixpanel Export API.
Fetches yesterday''s events and incrementally updates subscribers_insights.
Called by cron job at 2 AM UTC daily.';

-- View updated jobs
SELECT jobid, jobname, schedule, command, active
FROM cron.job
WHERE jobname LIKE 'mixpanel%'
ORDER BY jobname;
