-- Simplified approach: Use separate cron jobs for fetch and process
-- Job 1: Fetch data and store in Storage (runs at 2:00 AM)
-- Job 2: Process data from Storage (runs at 2:10 AM - 10 min delay)

-- First, unschedule any existing jobs
SELECT cron.unschedule('mixpanel-users-sync-daily') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'mixpanel-users-sync-daily'
);

-- Create simple wrapper functions that just trigger the Edge Functions
CREATE OR REPLACE FUNCTION trigger_mixpanel_fetch()
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

  RAISE NOTICE 'Triggering sync-mixpanel-users fetch...';

  -- Queue async HTTP request - fire and forget
  PERFORM net.http_post(
    url := supabase_url || '/functions/v1/sync-mixpanel-users',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || service_key,
      'apikey', service_key,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );

  RAISE NOTICE 'Fetch request queued';
END;
$$;

CREATE OR REPLACE FUNCTION trigger_mixpanel_process()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  supabase_url text;
  service_key text;
  latest_file text;
BEGIN
  SELECT sc.supabase_url, sc.service_key
  INTO supabase_url, service_key
  FROM supabase_config sc
  WHERE id = 1;

  RAISE NOTICE 'Triggering process-subscribers-data...';

  -- Get the most recent subscribers file from sync_logs
  SELECT
    CASE
      WHEN sync_metadata->>'filename' IS NOT NULL
      THEN sync_metadata->>'filename'
      ELSE 'subscribers-' || created_at::text || '.json'
    END INTO latest_file
  FROM sync_logs
  WHERE source = 'mixpanel_users'
    AND status = 'success'
  ORDER BY created_at DESC
  LIMIT 1;

  IF latest_file IS NULL THEN
    RAISE NOTICE 'No recent fetch found, skipping process step';
    RETURN;
  END IF;

  RAISE NOTICE 'Processing file: %', latest_file;

  -- Queue async HTTP request - fire and forget
  PERFORM net.http_post(
    url := supabase_url || '/functions/v1/process-subscribers-data',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || service_key,
      'apikey', service_key,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('filename', latest_file),
    timeout_milliseconds := 300000
  );

  RAISE NOTICE 'Process request queued';
END;
$$;

-- Schedule Job 1: Fetch data at 2:00 AM daily
SELECT cron.schedule(
  'mixpanel-fetch-daily',
  '0 2 * * *',  -- 2:00 AM UTC
  'SELECT trigger_mixpanel_fetch();'
);

-- Schedule Job 2: Process data at 2:10 AM daily (10 min after fetch)
SELECT cron.schedule(
  'mixpanel-process-daily',
  '10 2 * * *',  -- 2:10 AM UTC (10 min delay)
  'SELECT trigger_mixpanel_process();'
);

-- View scheduled jobs
SELECT jobid, jobname, schedule, command FROM cron.job WHERE jobname LIKE 'mixpanel-%';
