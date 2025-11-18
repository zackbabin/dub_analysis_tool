-- Fix cron jobs authentication and clean up obsolete jobs
-- This migration:
-- 1. Removes obsolete cron jobs (superseded by function chaining)
-- 2. Documents the service_role_key configuration issue

-- ============================================================================
-- DELETE OBSOLETE CRON JOBS
-- ============================================================================

-- Delete trigger-support-analysis-daily (deprecated - handled by function chaining)
DO $$
BEGIN
  PERFORM cron.unschedule('trigger-support-analysis-daily');
  RAISE NOTICE 'Deleted cron job: trigger-support-analysis-daily (deprecated)';
EXCEPTION
  WHEN undefined_object THEN
    RAISE NOTICE 'Job trigger-support-analysis-daily does not exist, skipping';
END $$;

-- Delete sync-linear-issues-daily (now triggered by sync-support-conversations)
DO $$
BEGIN
  PERFORM cron.unschedule('sync-linear-issues-daily');
  RAISE NOTICE 'Deleted cron job: sync-linear-issues-daily (now auto-triggered)';
EXCEPTION
  WHEN undefined_object THEN
    RAISE NOTICE 'Job sync-linear-issues-daily does not exist, skipping';
END $$;

-- Delete map-linear-to-feedback-daily (now triggered by analyze-support-feedback)
DO $$
BEGIN
  PERFORM cron.unschedule('map-linear-to-feedback-daily');
  RAISE NOTICE 'Deleted cron job: map-linear-to-feedback-daily (now auto-triggered)';
EXCEPTION
  WHEN undefined_object THEN
    RAISE NOTICE 'Job map-linear-to-feedback-daily does not exist, skipping';
END $$;

-- Delete weekly-support-analysis if it exists (duplicate/obsolete)
DO $$
BEGIN
  PERFORM cron.unschedule('weekly-support-analysis');
  RAISE NOTICE 'Deleted cron job: weekly-support-analysis (obsolete)';
EXCEPTION
  WHEN undefined_object THEN
    RAISE NOTICE 'Job weekly-support-analysis does not exist, skipping';
END $$;

-- ============================================================================
-- SERVICE ROLE KEY CONFIGURATION
-- ============================================================================

-- The remaining cron jobs use: current_setting('app.settings.service_role_key')
-- This setting must be configured with your Supabase service_role key

-- MANUAL STEP REQUIRED:
-- Run this SQL command in the Supabase SQL Editor, replacing YOUR_SERVICE_ROLE_KEY:
--
-- ALTER DATABASE postgres SET app.settings.service_role_key = 'YOUR_SERVICE_ROLE_KEY';
--
-- Get your service_role key from: Project Settings > API > service_role (secret)

DO $$
BEGIN
  -- Test if the setting exists
  PERFORM current_setting('app.settings.service_role_key', true);
  RAISE NOTICE '✅ Service role key is configured';
EXCEPTION
  WHEN undefined_object THEN
    RAISE WARNING '⚠️  Service role key NOT configured. Cron jobs will fail until you run:';
    RAISE WARNING '    ALTER DATABASE postgres SET app.settings.service_role_key = ''YOUR_SERVICE_ROLE_KEY'';';
  WHEN OTHERS THEN
    RAISE WARNING '⚠️  Service role key NOT configured. Cron jobs will fail until you run:';
    RAISE WARNING '    ALTER DATABASE postgres SET app.settings.service_role_key = ''YOUR_SERVICE_ROLE_KEY'';';
END $$;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON EXTENSION pg_cron IS
'Cron jobs require service_role_key to be set. Run: ALTER DATABASE postgres SET app.settings.service_role_key = ''your-key'';';

DO $$
BEGIN
  RAISE NOTICE '===============================================';
  RAISE NOTICE 'Migration completed:';
  RAISE NOTICE '  ✓ Deleted 4 obsolete cron jobs';
  RAISE NOTICE '  ⚠ Action required: Configure service_role_key';
  RAISE NOTICE '===============================================';
END $$;
