-- Use Supabase Vault for secure cron job authentication
-- Vault stores secrets encrypted, much more secure than database settings

-- ============================================================================
-- SETUP SUPABASE VAULT SECRET
-- ============================================================================

-- Verify that service_role_key exists in Vault
-- (User should add it via Supabase UI: Project Settings > Vault > New Secret)
DO $$
DECLARE
  secret_exists BOOLEAN;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM vault.secrets WHERE name = 'service_role_key'
  ) INTO secret_exists;

  IF secret_exists THEN
    RAISE NOTICE '✅ service_role_key found in Vault';
  ELSE
    RAISE EXCEPTION 'service_role_key not found in Vault. Please add it via Supabase UI: Project Settings > Vault > New Secret (name: service_role_key)';
  END IF;
END $$;

-- ============================================================================
-- UPDATE CRON JOBS TO USE VAULT
-- ============================================================================

-- Helper function to make authenticated HTTP calls to Edge Functions
-- Uses Vault to securely retrieve the service_role_key
CREATE OR REPLACE FUNCTION invoke_edge_function(function_name TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  service_key TEXT;
  supabase_url TEXT := 'https://rnpfeblxapdafrbmomix.supabase.co';
BEGIN
  -- Retrieve service_role_key from Vault (encrypted storage)
  SELECT decrypted_secret INTO service_key
  FROM vault.decrypted_secrets
  WHERE name = 'service_role_key'
  LIMIT 1;

  IF service_key IS NULL THEN
    RAISE EXCEPTION 'service_role_key not found in Vault. Please add it using: INSERT INTO vault.secrets (name, secret) VALUES (''service_role_key'', ''your-key'');';
  END IF;

  -- Call Edge Function with authentication
  PERFORM net.http_post(
    url := supabase_url || '/functions/v1/' || function_name,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || service_key,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION invoke_edge_function(TEXT) TO postgres;

-- ============================================================================
-- UPDATE EXISTING CRON JOBS TO USE HELPER FUNCTION
-- ============================================================================

-- Update sync-user-events-daily
SELECT cron.schedule(
  'sync-user-events-daily',
  '0 2 * * *',
  $$SELECT invoke_edge_function('sync-mixpanel-user-events')$$
);

-- Update sync-user-properties-daily
SELECT cron.schedule(
  'sync-user-properties-daily',
  '20 2 * * *',
  $$SELECT invoke_edge_function('sync-mixpanel-user-properties-v2')$$
);

-- Update sync-engagement-daily
SELECT cron.schedule(
  'sync-engagement-daily',
  '45 2 * * *',
  $$SELECT invoke_edge_function('sync-mixpanel-engagement')$$
);

-- Update sync-creator-data-daily
SELECT cron.schedule(
  'sync-creator-data-daily',
  '15 3 * * *',
  $$SELECT invoke_edge_function('sync-creator-data')$$
);

-- Update sync-support-conversations-daily
SELECT cron.schedule(
  'sync-support-conversations-daily',
  '30 3 * * *',
  $$SELECT invoke_edge_function('sync-support-conversations')$$
);

-- ============================================================================
-- CLEANUP OLD DATABASE SETTING (if it exists)
-- ============================================================================

-- Remove the insecure database setting
DO $$
BEGIN
  EXECUTE 'ALTER DATABASE postgres RESET app.settings.service_role_key';
  RAISE NOTICE 'Removed insecure service_role_key from database settings';
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'No database setting to remove';
END $$;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON FUNCTION invoke_edge_function(TEXT) IS
'Securely invokes Supabase Edge Functions using service_role_key from Vault. Usage: SELECT invoke_edge_function(''function-name'');';

DO $$
BEGIN
  RAISE NOTICE '===============================================';
  RAISE NOTICE 'Migration completed:';
  RAISE NOTICE '  ✓ Verified service_role_key in Vault';
  RAISE NOTICE '  ✓ Created invoke_edge_function helper';
  RAISE NOTICE '  ✓ Updated 5 cron jobs to use Vault';
  RAISE NOTICE '  ✓ Cron jobs now use encrypted Vault storage';
  RAISE NOTICE '===============================================';
END $$;
