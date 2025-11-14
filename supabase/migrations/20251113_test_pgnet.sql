-- Test to see what pg_net actually returns
CREATE OR REPLACE FUNCTION test_pgnet_response()
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  result record;
  supabase_url text;
  service_key text;
BEGIN
  -- Get credentials
  SELECT sc.supabase_url, sc.service_key
  INTO supabase_url, service_key
  FROM supabase_config sc
  WHERE id = 1;

  -- Make a simple request and see what columns are returned
  SELECT * INTO result
  FROM net.http_post(
    url := supabase_url || '/functions/v1/sync-mixpanel-users',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || service_key,
      'apikey', service_key,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );

  -- Return the entire result as jsonb to see structure
  RETURN to_jsonb(result);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'error', SQLERRM,
    'detail', SQLSTATE
  );
END;
$$;

-- Run the test
SELECT test_pgnet_response();
