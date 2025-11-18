-- Update cron job to use sync-mixpanel-user-events-v2 (Insights API)
-- Date: 2025-11-17

-- Unschedule the old user events cron job
SELECT cron.unschedule('sync-user-events-daily');

-- Create new cron job for Insights API sync
SELECT cron.schedule(
  'sync-user-events-daily',
  '0 2 * * *',
  $$SELECT net.http_post(
    url := 'https://rnpfeblxapdafrbmomix.supabase.co/functions/v1/sync-mixpanel-user-events-v2',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  ) AS request_id$$
);

-- Verification
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Updated sync-user-events-daily cron job to use Insights API (v2)';
  RAISE NOTICE '   Schedule: 2:00 AM UTC daily';
  RAISE NOTICE '   Endpoint: sync-mixpanel-user-events-v2';
  RAISE NOTICE '';
  RAISE NOTICE 'The new Insights API approach:';
  RAISE NOTICE '   - Fetches aggregated metrics from Mixpanel chart 85713544';
  RAISE NOTICE '   - Much faster than Export API (single API call vs streaming)';
  RAISE NOTICE '   - Syncs 17 event metrics directly';
  RAISE NOTICE '';
END $$;
