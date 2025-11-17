-- Programmatically create all 8 daily cron jobs
-- This creates the actual cron jobs in pg_cron (not just documentation)
-- Date: 2025-11-17

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Unschedule existing jobs first (in case of re-running migration)
-- This prevents duplicate job errors
DO $$
BEGIN
  -- User Analysis Jobs
  PERFORM cron.unschedule('sync-user-events-daily');
  PERFORM cron.unschedule('sync-user-properties-daily');
  PERFORM cron.unschedule('sync-engagement-daily');

  -- Creator Analysis Jobs
  PERFORM cron.unschedule('sync-creator-data-daily');

  -- Support Analysis Jobs
  PERFORM cron.unschedule('sync-support-conversations-daily');
  PERFORM cron.unschedule('trigger-support-analysis-daily');

  -- Linear Integration Jobs
  PERFORM cron.unschedule('sync-linear-issues-daily');
  PERFORM cron.unschedule('map-linear-to-feedback-daily');

  RAISE NOTICE 'Unscheduled existing cron jobs (if any)';
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'No existing jobs to unschedule or error occurred: %', SQLERRM;
END $$;

-- ============================================================================
-- USER ANALYSIS JOBS (Mixpanel)
-- ============================================================================

-- Job 1: Daily User Events Sync (2:00 AM UTC)
SELECT cron.schedule(
  'sync-user-events-daily',
  '0 2 * * *',
  $$SELECT net.http_post(
    url := 'https://rnpfeblxapdafrbmomix.supabase.co/functions/v1/sync-mixpanel-user-events',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) AS request_id$$
);

-- Job 2: Daily User Properties Sync (2:20 AM UTC)
SELECT cron.schedule(
  'sync-user-properties-daily',
  '20 2 * * *',
  $$SELECT net.http_post(
    url := 'https://rnpfeblxapdafrbmomix.supabase.co/functions/v1/sync-mixpanel-user-properties-v2',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) AS request_id$$
);

-- Job 3: Daily Engagement Sync (2:45 AM UTC)
SELECT cron.schedule(
  'sync-engagement-daily',
  '45 2 * * *',
  $$SELECT net.http_post(
    url := 'https://rnpfeblxapdafrbmomix.supabase.co/functions/v1/sync-mixpanel-engagement',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) AS request_id$$
);

-- ============================================================================
-- CREATOR ANALYSIS JOBS (Mixpanel)
-- ============================================================================

-- Job 4: Daily Creator Data Sync (3:15 AM UTC)
SELECT cron.schedule(
  'sync-creator-data-daily',
  '15 3 * * *',
  $$SELECT net.http_post(
    url := 'https://rnpfeblxapdafrbmomix.supabase.co/functions/v1/sync-creator-data',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) AS request_id$$
);

-- ============================================================================
-- SUPPORT ANALYSIS JOBS (Zendesk)
-- ============================================================================

-- Job 5: Daily Support Conversations Sync (3:30 AM UTC)
SELECT cron.schedule(
  'sync-support-conversations-daily',
  '30 3 * * *',
  $$SELECT net.http_post(
    url := 'https://rnpfeblxapdafrbmomix.supabase.co/functions/v1/sync-support-conversations',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) AS request_id$$
);

-- Job 6: Daily Support Analysis Trigger (3:50 AM UTC)
SELECT cron.schedule(
  'trigger-support-analysis-daily',
  '50 3 * * *',
  $$SELECT net.http_post(
    url := 'https://rnpfeblxapdafrbmomix.supabase.co/functions/v1/trigger-support-analysis',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) AS request_id$$
);

-- ============================================================================
-- LINEAR INTEGRATION JOBS
-- ============================================================================

-- Job 7: Daily Linear Issues Sync (4:00 AM UTC)
SELECT cron.schedule(
  'sync-linear-issues-daily',
  '0 4 * * *',
  $$SELECT net.http_post(
    url := 'https://rnpfeblxapdafrbmomix.supabase.co/functions/v1/sync-linear-issues',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) AS request_id$$
);

-- Job 8: Daily Linear-to-Feedback Mapping (4:10 AM UTC)
SELECT cron.schedule(
  'map-linear-to-feedback-daily',
  '10 4 * * *',
  $$SELECT net.http_post(
    url := 'https://rnpfeblxapdafrbmomix.supabase.co/functions/v1/map-linear-to-feedback',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) AS request_id$$
);

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Show all created cron jobs
DO $$
DECLARE
  job_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO job_count
  FROM cron.job
  WHERE jobname LIKE '%-daily';

  RAISE NOTICE '';
  RAISE NOTICE 'Successfully created % daily cron jobs', job_count;
  RAISE NOTICE '';
  RAISE NOTICE 'Jobs created:';
  RAISE NOTICE '   User Analysis (3 jobs):';
  RAISE NOTICE '     - sync-user-events-daily       (2:00 AM UTC)';
  RAISE NOTICE '     - sync-user-properties-daily   (2:20 AM UTC)';
  RAISE NOTICE '     - sync-engagement-daily        (2:45 AM UTC)';
  RAISE NOTICE '';
  RAISE NOTICE '   Creator Analysis (1 job):';
  RAISE NOTICE '     - sync-creator-data-daily      (3:15 AM UTC)';
  RAISE NOTICE '';
  RAISE NOTICE '   Support Analysis (2 jobs):';
  RAISE NOTICE '     - sync-support-conversations-daily (3:30 AM UTC)';
  RAISE NOTICE '     - trigger-support-analysis-daily   (3:50 AM UTC)';
  RAISE NOTICE '';
  RAISE NOTICE '   Linear Integration (2 jobs):';
  RAISE NOTICE '     - sync-linear-issues-daily     (4:00 AM UTC)';
  RAISE NOTICE '     - map-linear-to-feedback-daily (4:10 AM UTC)';
  RAISE NOTICE '';
  RAISE NOTICE 'Complete schedule: 2:00 AM - 4:15 AM UTC (about 45 min)';
  RAISE NOTICE '';
  RAISE NOTICE 'View jobs in Supabase Dashboard > Database > Cron';
  RAISE NOTICE 'Query: SELECT * FROM cron.job WHERE jobname LIKE ''%%-daily'';';
END $$;
