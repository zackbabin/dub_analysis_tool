-- Set up cron job for sync-mixpanel-user-properties-v2
-- Fetches user properties daily and auto-chains to processing
-- Runs at 3 AM UTC (after events sync at 2 AM)

-- Create trigger function for user properties sync
CREATE OR REPLACE FUNCTION trigger_user_properties_sync()
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

  RAISE NOTICE 'Triggering sync-mixpanel-user-properties-v2 (auto-chains to processing)...';

  -- Trigger the fetch function, which will automatically chain to processing
  PERFORM net.http_post(
    url := supabase_url || '/functions/v1/sync-mixpanel-user-properties-v2',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || service_key,
      'apikey', service_key,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000  -- 2.5 min timeout for fetch
  );

  RAISE NOTICE 'User properties sync triggered (will auto-process in chunks)';
END;
$$;

-- Schedule daily user properties sync at 3:00 AM UTC
-- Runs after events sync (2 AM) to ensure fresh event data exists
SELECT cron.schedule(
  'user-properties-sync-daily',
  '0 3 * * *',  -- 3:00 AM UTC daily
  'SELECT trigger_user_properties_sync();'
);

-- View scheduled jobs
SELECT jobid, jobname, schedule, command, active
FROM cron.job
WHERE jobname LIKE '%properties%' OR jobname LIKE 'mixpanel%'
ORDER BY jobname;

COMMENT ON FUNCTION trigger_user_properties_sync() IS
'Triggers daily user properties sync from Mixpanel.
The function automatically chains: fetch → store → process all chunks.
Called by cron job at 3 AM UTC daily.';
