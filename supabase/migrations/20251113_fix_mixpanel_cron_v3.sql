-- Fix process_mixpanel_sync function - use pg_net asynchronously and check _http_response table
-- pg_net queues requests and processes them in background, we need to wait and poll for results

CREATE OR REPLACE FUNCTION process_mixpanel_sync()
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  request_id_fetch bigint;
  request_id_process bigint;
  fetch_response record;
  process_response record;
  filename text;
  supabase_url text;
  service_key text;
  wait_counter int := 0;
  max_wait int := 160;
BEGIN
  -- Get credentials from config table
  SELECT sc.supabase_url, sc.service_key
  INTO supabase_url, service_key
  FROM supabase_config sc
  WHERE id = 1;

  RAISE NOTICE 'Starting Mixpanel sync via cron job...';

  -- Step 1: Queue sync-mixpanel-users request
  RAISE NOTICE 'Queueing sync-mixpanel-users request...';

  -- Get the next request ID before making the request
  SELECT COALESCE(MAX(id), 0) + 1 INTO request_id_fetch FROM net._http_response;

  -- Queue the HTTP request (returns immediately)
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

  RAISE NOTICE 'Waiting for fetch response (request ~ID: %)...', request_id_fetch;

  -- Poll for response (check every 3 seconds)
  LOOP
    -- Get the latest response for our approximate request ID
    SELECT * INTO fetch_response
    FROM net._http_response
    WHERE id >= request_id_fetch
    ORDER BY id DESC
    LIMIT 1;

    -- Check if we have a response
    IF fetch_response.id IS NOT NULL THEN
      RAISE NOTICE 'Fetch response received (ID: %, status: %)', fetch_response.id, fetch_response.status_code;
      EXIT;
    END IF;

    wait_counter := wait_counter + 3;
    IF wait_counter >= max_wait THEN
      RAISE EXCEPTION 'Timeout waiting for sync-mixpanel-users response after % seconds', max_wait;
    END IF;

    PERFORM pg_sleep(3);
  END LOOP;

  RAISE NOTICE 'Fetch response status: %', fetch_response.status_code;

  -- Check if request was successful
  IF fetch_response.status_code NOT BETWEEN 200 AND 299 THEN
    RAISE EXCEPTION 'sync-mixpanel-users failed with status %: %',
      fetch_response.status_code,
      fetch_response.content;
  END IF;

  -- Parse response content
  BEGIN
    filename := (fetch_response.content::jsonb)->'data'->>'filename';
    IF filename IS NULL THEN
      RAISE EXCEPTION 'No filename in response: %', fetch_response.content;
    END IF;
    RAISE NOTICE 'Data stored in file: %', filename;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Failed to parse fetch response: %. Content: %', SQLERRM, fetch_response.content;
  END;

  -- Step 2: Wait for storage upload to complete
  RAISE NOTICE 'Waiting 5 seconds for storage upload...';
  PERFORM pg_sleep(5);

  -- Step 3: Queue process-subscribers-data request
  RAISE NOTICE 'Queueing process-subscribers-data request with filename: %', filename;

  -- Get the next request ID
  SELECT COALESCE(MAX(id), 0) + 1 INTO request_id_process FROM net._http_response;

  PERFORM net.http_post(
    url := supabase_url || '/functions/v1/process-subscribers-data',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || service_key,
      'apikey', service_key,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('filename', filename),
    timeout_milliseconds := 300000
  );

  RAISE NOTICE 'Waiting for process response (request ~ID: %)...', request_id_process;

  -- Poll for processing response (check every 5 seconds, up to 5 minutes)
  wait_counter := 0;
  max_wait := 320;

  LOOP
    SELECT * INTO process_response
    FROM net._http_response
    WHERE id >= request_id_process
    ORDER BY id DESC
    LIMIT 1;

    IF process_response.id IS NOT NULL AND process_response.id != fetch_response.id THEN
      RAISE NOTICE 'Process response received (ID: %, status: %)', process_response.id, process_response.status_code;
      EXIT;
    END IF;

    wait_counter := wait_counter + 5;
    IF wait_counter >= max_wait THEN
      RAISE EXCEPTION 'Timeout waiting for process-subscribers-data response after % seconds', max_wait;
    END IF;

    PERFORM pg_sleep(5);
  END LOOP;

  RAISE NOTICE 'Process response status: %', process_response.status_code;

  -- Check if request was successful
  IF process_response.status_code NOT BETWEEN 200 AND 299 THEN
    RAISE EXCEPTION 'process-subscribers-data failed with status %: %',
      process_response.status_code,
      process_response.content;
  END IF;

  -- Return combined results
  RETURN jsonb_build_object(
    'success', true,
    'fetch_response', jsonb_build_object(
      'status_code', fetch_response.status_code,
      'content', fetch_response.content::jsonb
    ),
    'process_response', jsonb_build_object(
      'status_code', process_response.status_code,
      'content', process_response.content::jsonb
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
