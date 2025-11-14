-- Chunked approach: Fetch Mixpanel data in smaller date ranges to avoid timeout
-- Multiple cron jobs fetch different date ranges, then one job processes all chunks

-- Unschedule old jobs
SELECT cron.unschedule('mixpanel-fetch-daily') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'mixpanel-fetch-daily'
);
SELECT cron.unschedule('mixpanel-process-daily') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'mixpanel-process-daily'
);
SELECT cron.unschedule('mixpanel-v2-sync-daily') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'mixpanel-v2-sync-daily'
);

-- Create function to trigger sync with custom date range parameter
CREATE OR REPLACE FUNCTION trigger_mixpanel_fetch_range(days_back int)
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

  RAISE NOTICE 'Triggering sync-mixpanel-users for last % days...', days_back;

  -- Queue async HTTP request with date_range parameter
  PERFORM net.http_post(
    url := supabase_url || '/functions/v1/sync-mixpanel-users-chunked',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || service_key,
      'apikey', service_key,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('days_back', days_back),
    timeout_milliseconds := 150000
  );

  RAISE NOTICE 'Fetch request queued for last % days', days_back;
END;
$$;

-- Schedule multiple fetches with different date ranges
-- Each runs 5 minutes apart to spread out the load

-- Fetch last 30 days (most recent data) at 2:00 AM
SELECT cron.schedule(
  'mixpanel-fetch-30days',
  '0 2 * * *',
  'SELECT trigger_mixpanel_fetch_range(30);'
);

-- Fetch 31-60 days ago at 2:05 AM
SELECT cron.schedule(
  'mixpanel-fetch-60days',
  '5 2 * * *',
  'SELECT trigger_mixpanel_fetch_range(60);'
);

-- Fetch 61-90 days ago at 2:10 AM
SELECT cron.schedule(
  'mixpanel-fetch-90days',
  '10 2 * * *',
  'SELECT trigger_mixpanel_fetch_range(90);'
);

-- Fetch 91-120 days ago at 2:15 AM
SELECT cron.schedule(
  'mixpanel-fetch-120days',
  '15 2 * * *',
  'SELECT trigger_mixpanel_fetch_range(120);'
);

-- Process all fetched data at 2:30 AM (after all fetches complete)
SELECT cron.schedule(
  'mixpanel-process-all',
  '30 2 * * *',
  'SELECT trigger_mixpanel_process();'
);

-- View all scheduled jobs
SELECT jobid, jobname, schedule, command FROM cron.job WHERE jobname LIKE 'mixpanel-%' ORDER BY jobname;
