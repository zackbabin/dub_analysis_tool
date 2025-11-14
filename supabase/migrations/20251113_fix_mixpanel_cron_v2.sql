-- Fix process_mixpanel_sync function - pg_net returns id, need to query response separately
CREATE OR REPLACE FUNCTION process_mixpanel_sync()
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  fetch_request_id bigint;
  process_request_id bigint;
  fetch_response record;
  process_response record;
  filename text;
  supabase_url text;
  service_key text;
  max_wait_seconds int := 160;
  wait_counter int := 0;
BEGIN
  -- Get credentials from config table
  SELECT sc.supabase_url, sc.service_key
  INTO supabase_url, service_key
  FROM supabase_config sc
  WHERE id = 1;

  RAISE NOTICE 'Starting Mixpanel sync via cron job...';

  -- Step 1: Call sync-mixpanel-users to fetch and store data
  RAISE NOTICE 'Calling sync-mixpanel-users to fetch data...';

  SELECT id INTO fetch_request_id
  FROM net.http_post(
    url := supabase_url || '/functions/v1/sync-mixpanel-users',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || service_key,
      'apikey', service_key,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );

  RAISE NOTICE 'Fetch request ID: %', fetch_request_id;

  -- Wait for response (poll every 2 seconds)
  LOOP
    SELECT status_code, content::text, content::jsonb as content_json
    INTO fetch_response
    FROM net._http_response
    WHERE id = fetch_request_id;

    EXIT WHEN fetch_response.status_code IS NOT NULL;

    wait_counter := wait_counter + 2;
    IF wait_counter > max_wait_seconds THEN
      RAISE EXCEPTION 'Timeout waiting for sync-mixpanel-users response after % seconds', max_wait_seconds;
    END IF;

    PERFORM pg_sleep(2);
  END LOOP;

  RAISE NOTICE 'Fetch response status: %, content: %', fetch_response.status_code, fetch_response.content;

  -- Check if request was successful
  IF fetch_response.status_code NOT BETWEEN 200 AND 299 THEN
    RAISE EXCEPTION 'sync-mixpanel-users failed with status %: %', fetch_response.status_code, fetch_response.content;
  END IF;

  -- Extract filename from response
  IF fetch_response.content_json ? 'data' AND fetch_response.content_json->'data' ? 'filename' THEN
    filename := fetch_response.content_json->'data'->>'filename';
    RAISE NOTICE 'Data stored in file: %', filename;
  ELSE
    RAISE EXCEPTION 'No filename returned from sync-mixpanel-users. Response: %', fetch_response.content;
  END IF;

  -- Step 2: Wait a few seconds to ensure storage upload is complete
  RAISE NOTICE 'Waiting 3 seconds for storage upload to finalize...';
  PERFORM pg_sleep(3);

  -- Step 3: Call process-subscribers-data to process the stored data
  RAISE NOTICE 'Calling process-subscribers-data with filename: %', filename;

  SELECT id INTO process_request_id
  FROM net.http_post(
    url := supabase_url || '/functions/v1/process-subscribers-data',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || service_key,
      'apikey', service_key,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('filename', filename),
    timeout_milliseconds := 300000
  );

  RAISE NOTICE 'Process request ID: %', process_request_id;

  -- Wait for processing response (poll every 2 seconds, up to 5 minutes)
  wait_counter := 0;
  max_wait_seconds := 320;

  LOOP
    SELECT status_code, content::text, content::jsonb as content_json
    INTO process_response
    FROM net._http_response
    WHERE id = process_request_id;

    EXIT WHEN process_response.status_code IS NOT NULL;

    wait_counter := wait_counter + 2;
    IF wait_counter > max_wait_seconds THEN
      RAISE EXCEPTION 'Timeout waiting for process-subscribers-data response after % seconds', max_wait_seconds;
    END IF;

    PERFORM pg_sleep(2);
  END LOOP;

  RAISE NOTICE 'Process response status: %, content: %', process_response.status_code, process_response.content;

  -- Check if request was successful
  IF process_response.status_code NOT BETWEEN 200 AND 299 THEN
    RAISE EXCEPTION 'process-subscribers-data failed with status %: %', process_response.status_code, process_response.content;
  END IF;

  -- Return combined results
  RETURN jsonb_build_object(
    'success', true,
    'fetch_response', jsonb_build_object(
      'status_code', fetch_response.status_code,
      'content', fetch_response.content_json
    ),
    'process_response', jsonb_build_object(
      'status_code', process_response.status_code,
      'content', process_response.content_json
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
