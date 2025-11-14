-- Fix process_mixpanel_sync function to use correct pg_net response columns
CREATE OR REPLACE FUNCTION process_mixpanel_sync()
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  fetch_response record;
  process_response record;
  fetch_content jsonb;
  process_content jsonb;
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

  SELECT status_code, content::jsonb
  INTO fetch_response
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

  fetch_content := fetch_response.content;
  RAISE NOTICE 'Fetch response status: %, content: %', fetch_response.status_code, fetch_content;

  -- Check if request was successful
  IF fetch_response.status_code NOT BETWEEN 200 AND 299 THEN
    RAISE EXCEPTION 'sync-mixpanel-users failed with status %: %', fetch_response.status_code, fetch_content;
  END IF;

  -- Extract filename from response
  IF fetch_content ? 'data' AND fetch_content->'data' ? 'filename' THEN
    filename := fetch_content->'data'->>'filename';
    RAISE NOTICE 'Data stored in file: %', filename;
  ELSE
    RAISE EXCEPTION 'No filename returned from sync-mixpanel-users. Response: %', fetch_content;
  END IF;

  -- Step 2: Wait a few seconds to ensure storage upload is complete
  RAISE NOTICE 'Waiting 3 seconds for storage upload to finalize...';
  PERFORM pg_sleep(3);

  -- Step 3: Call process-subscribers-data to process the stored data
  RAISE NOTICE 'Calling process-subscribers-data with filename: %', filename;

  SELECT status_code, content::jsonb
  INTO process_response
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

  process_content := process_response.content;
  RAISE NOTICE 'Process response status: %, content: %', process_response.status_code, process_content;

  -- Check if request was successful
  IF process_response.status_code NOT BETWEEN 200 AND 299 THEN
    RAISE EXCEPTION 'process-subscribers-data failed with status %: %', process_response.status_code, process_content;
  END IF;

  -- Return combined results
  RETURN jsonb_build_object(
    'success', true,
    'fetch_response', jsonb_build_object(
      'status_code', fetch_response.status_code,
      'content', fetch_content
    ),
    'process_response', jsonb_build_object(
      'status_code', process_response.status_code,
      'content', process_content
    ),
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
