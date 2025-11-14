-- Migration to update service role key in supabase_config
--
-- IMPORTANT: After rotating your service role key in Supabase Dashboard,
-- run this migration with the new key to update the cron jobs.
--
-- This table is used by:
-- - trigger_mixpanel_user_events() - Daily at 2 AM
-- - trigger_user_properties_sync() - Daily at 3 AM
--
-- HOW TO USE:
-- 1. Go to Supabase Dashboard → Project Settings → API
-- 2. Generate a new service_role key
-- 3. Replace 'YOUR_NEW_SERVICE_ROLE_KEY_HERE' below with the new key
-- 4. Run this migration
--
-- NOTE: Remove this file from git after using it (contains sensitive data)

UPDATE supabase_config
SET
  service_key = 'YOUR_NEW_SERVICE_ROLE_KEY_HERE',
  updated_at = NOW()
WHERE id = 1;

-- Verify the update
SELECT
  id,
  supabase_url,
  CASE
    WHEN service_key = 'YOUR_NEW_SERVICE_ROLE_KEY_HERE'
    THEN '⚠️ REMEMBER TO REPLACE WITH ACTUAL KEY'
    ELSE '✅ Key updated'
  END as status,
  updated_at
FROM supabase_config
WHERE id = 1;
