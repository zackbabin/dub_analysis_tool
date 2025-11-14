-- Set up cron job for sync-mixpanel-users-v2 with incremental aggregation
-- Fetches yesterday's events and adds counts to existing totals

-- Unschedule any existing mixpanel sync jobs
SELECT cron.unschedule('mixpanel-fetch-daily') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'mixpanel-fetch-daily'
);
SELECT cron.unschedule('mixpanel-process-daily') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'mixpanel-process-daily'
);
SELECT cron.unschedule('mixpanel-v2-sync-daily') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'mixpanel-v2-sync-daily'
);
SELECT cron.unschedule('mixpanel-fetch-30days') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'mixpanel-fetch-30days'
);
SELECT cron.unschedule('mixpanel-fetch-60days') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'mixpanel-fetch-60days'
);
SELECT cron.unschedule('mixpanel-fetch-90days') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'mixpanel-fetch-90days'
);
SELECT cron.unschedule('mixpanel-fetch-120days') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'mixpanel-fetch-120days'
);
SELECT cron.unschedule('mixpanel-process-all') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'mixpanel-process-all'
);

-- Create trigger function for v2 incremental sync
CREATE OR REPLACE FUNCTION trigger_mixpanel_v2_incremental()
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

  RAISE NOTICE 'Triggering sync-mixpanel-users-v2 (incremental mode - yesterday only)...';

  -- Queue async HTTP request - fire and forget
  -- v2 will fetch yesterday's events and ADD counts to existing database totals
  PERFORM net.http_post(
    url := supabase_url || '/functions/v1/sync-mixpanel-users-v2',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || service_key,
      'apikey', service_key,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000  -- 2.5 min timeout
  );

  RAISE NOTICE 'sync-mixpanel-users-v2 incremental request queued';
END;
$$;

-- Schedule daily incremental sync at 2:00 AM UTC
SELECT cron.schedule(
  'mixpanel-v2-incremental-daily',
  '0 2 * * *',  -- 2:00 AM UTC daily
  'SELECT trigger_mixpanel_v2_incremental();'
);

-- View scheduled jobs
SELECT jobid, jobname, schedule, command, active
FROM cron.job
WHERE jobname LIKE 'mixpanel%'
ORDER BY jobname;

-- Instructions for initial historical backfill:
-- After this migration, you should manually trigger sync-mixpanel-users-v2
-- with a longer date range (30-90 days) for initial backfill.
-- Future daily syncs will then add incremental counts.
