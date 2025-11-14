-- Use sync-mixpanel-users-v2 (Export API) with cron job
-- This approach processes events incrementally with streaming, avoiding the slow Insights API

-- Unschedule old jobs if they exist
SELECT cron.unschedule('mixpanel-fetch-daily') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'mixpanel-fetch-daily'
);

SELECT cron.unschedule('mixpanel-process-daily') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'mixpanel-process-daily'
);

-- Create trigger function for v2 (Export API with streaming)
CREATE OR REPLACE FUNCTION trigger_mixpanel_v2_sync()
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

  RAISE NOTICE 'Triggering sync-mixpanel-users-v2 (Export API with streaming)...';

  -- Queue async HTTP request - fire and forget
  PERFORM net.http_post(
    url := supabase_url || '/functions/v1/sync-mixpanel-users-v2',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || service_key,
      'apikey', service_key,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000  -- 5 min timeout (no CPU pressure from cron)
  );

  RAISE NOTICE 'sync-mixpanel-users-v2 request queued';
END;
$$;

-- Schedule daily sync at 2:00 AM UTC using v2 (Export API)
SELECT cron.schedule(
  'mixpanel-v2-sync-daily',
  '0 2 * * *',  -- 2:00 AM UTC
  'SELECT trigger_mixpanel_v2_sync();'
);

-- View scheduled jobs
SELECT jobid, jobname, schedule, command FROM cron.job WHERE jobname LIKE 'mixpanel-%';
