-- Enable pg_net extension if not already enabled (required for HTTP calls from database)
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Create table to store Supabase credentials (since we can't use ALTER DATABASE)
CREATE TABLE IF NOT EXISTS supabase_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  supabase_url TEXT NOT NULL,
  service_key TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT single_row CHECK (id = 1)
);

-- Insert credentials
INSERT INTO supabase_config (id, supabase_url, service_key)
VALUES (1, 'https://rnpfeblxapdafrbmomix.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJucGZlYmx4YXBkYWZyYm1vbWl4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1OTMyMzA2MiwiZXhwIjoyMDc0ODk5MDYyfQ.YNVjIXxAtlTjHyK9LAGqgJ7H_4USPB0exYVxlwvoYb4')
ON CONFLICT (id) DO UPDATE
SET supabase_url = EXCLUDED.supabase_url,
    service_key = EXCLUDED.service_key,
    updated_at = NOW();

-- Create the database function that orchestrates the sync
CREATE OR REPLACE FUNCTION process_mixpanel_sync()
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  fetch_response jsonb;
  process_response jsonb;
  filename text;
  supabase_url text;
  service_key text;
BEGIN
  -- Get credentials from config table
  SELECT sc.supabase_url, sc.service_key
  INTO supabase_url, service_key
  FROM supabase_config sc
  WHERE id = 1;

  RAISE NOTICE 'Starting Mixpanel sync via cron job...';

  -- Step 1: Call sync-mixpanel-users to fetch and store data
  RAISE NOTICE 'Calling sync-mixpanel-users to fetch data...';

  SELECT
    status,
    content::jsonb
  INTO
    fetch_response
  FROM net.http_post(
    url := supabase_url || '/functions/v1/sync-mixpanel-users',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || service_key,
      'apikey', service_key,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000  -- 150s timeout
  );

  RAISE NOTICE 'Fetch response: %', fetch_response;

  -- Extract filename from response
  IF fetch_response ? 'data' AND fetch_response->'data' ? 'filename' THEN
    filename := fetch_response->'data'->>'filename';
    RAISE NOTICE 'Data stored in file: %', filename;
  ELSE
    RAISE EXCEPTION 'No filename returned from sync-mixpanel-users. Response: %', fetch_response;
  END IF;

  -- Step 2: Wait a few seconds to ensure storage upload is complete
  RAISE NOTICE 'Waiting 3 seconds for storage upload to finalize...';
  PERFORM pg_sleep(3);

  -- Step 3: Call process-subscribers-data to process the stored data
  RAISE NOTICE 'Calling process-subscribers-data with filename: %', filename;

  SELECT
    status,
    content::jsonb
  INTO
    process_response
  FROM net.http_post(
    url := supabase_url || '/functions/v1/process-subscribers-data',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || service_key,
      'apikey', service_key,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('filename', filename),
    timeout_milliseconds := 300000  -- 5 minute timeout (plenty of time now!)
  );

  RAISE NOTICE 'Process response: %', process_response;

  -- Return combined results
  RETURN jsonb_build_object(
    'success', true,
    'fetch_response', fetch_response,
    'process_response', process_response,
    'completed_at', NOW()
  );

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Error in process_mixpanel_sync: %', SQLERRM;
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'failed_at', NOW()
  );
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION process_mixpanel_sync() TO postgres;

-- Schedule the cron job (runs daily at 2 AM UTC)
SELECT cron.schedule(
  'mixpanel-users-sync-daily',
  '0 2 * * *',  -- 2 AM UTC daily
  'SELECT process_mixpanel_sync();'
);

-- To test immediately, you can manually run:
-- SELECT process_mixpanel_sync();

-- To view scheduled jobs:
-- SELECT * FROM cron.job;

-- To unschedule if needed:
-- SELECT cron.unschedule('mixpanel-users-sync-daily');
