-- Complete daily cron job configuration for all data syncs
-- Consolidates user analysis, creator analysis, support analysis, and Linear integration
-- Date: 2025-11-17
--
-- SETUP INSTRUCTIONS:
-- 1. Run this migration: `supabase db push`
-- 2. Go to Supabase Dashboard > Database > Cron Jobs
-- 3. Create 8 new cron jobs using the settings below:
--
-- ============================================================================
-- USER ANALYSIS JOBS (Mixpanel)
-- ============================================================================
--
-- Job 1: Daily User Events Sync
--   Name: sync-user-events-daily
--   Schedule: 0 2 * * * (2:00 AM UTC daily)
--   Command: SELECT net.http_post(
--              url := 'https://rnpfeblxapdafrbmomix.supabase.co/functions/v1/sync-mixpanel-user-events',
--              headers := '{"Authorization": "Bearer ' || current_setting('app.settings.service_role_key') || '", "Content-Type": "application/json"}',
--              body := '{}'
--            );
--
-- Job 2: Daily User Properties Sync
--   Name: sync-user-properties-daily
--   Schedule: 20 2 * * * (2:20 AM UTC daily)
--   Command: SELECT net.http_post(
--              url := 'https://rnpfeblxapdafrbmomix.supabase.co/functions/v1/sync-mixpanel-user-properties-v2',
--              headers := '{"Authorization": "Bearer ' || current_setting('app.settings.service_role_key') || '", "Content-Type": "application/json"}',
--              body := '{}'
--            );
--
-- Job 3: Daily Engagement Sync (auto-triggers processing chain)
--   Name: sync-engagement-daily
--   Schedule: 45 2 * * * (2:45 AM UTC daily)
--   Command: SELECT net.http_post(
--              url := 'https://rnpfeblxapdafrbmomix.supabase.co/functions/v1/sync-mixpanel-engagement',
--              headers := '{"Authorization": "Bearer ' || current_setting('app.settings.service_role_key') || '", "Content-Type": "application/json"}',
--              body := '{}'
--            );
--
-- ============================================================================
-- CREATOR ANALYSIS JOBS (Mixpanel)
-- ============================================================================
--
-- Job 4: Daily Creator Data Sync
--   Name: sync-creator-data-daily
--   Schedule: 15 3 * * * (3:15 AM UTC daily)
--   Command: SELECT net.http_post(
--              url := 'https://rnpfeblxapdafrbmomix.supabase.co/functions/v1/sync-creator-data',
--              headers := '{"Authorization": "Bearer ' || current_setting('app.settings.service_role_key') || '", "Content-Type": "application/json"}',
--              body := '{}'
--            );
--
-- ============================================================================
-- SUPPORT ANALYSIS JOBS (Zendesk)
-- ============================================================================
--
-- Job 5: Daily Support Conversations Sync
--   Name: sync-support-conversations-daily
--   Schedule: 30 3 * * * (3:30 AM UTC daily)
--   Command: SELECT net.http_post(
--              url := 'https://rnpfeblxapdafrbmomix.supabase.co/functions/v1/sync-support-conversations',
--              headers := '{"Authorization": "Bearer ' || current_setting('app.settings.service_role_key') || '", "Content-Type": "application/json"}',
--              body := '{}'
--            );
--
-- Job 6: Daily Support Analysis Trigger (AI analysis)
--   Name: trigger-support-analysis-daily
--   Schedule: 50 3 * * * (3:50 AM UTC daily)
--   Command: SELECT net.http_post(
--              url := 'https://rnpfeblxapdafrbmomix.supabase.co/functions/v1/trigger-support-analysis',
--              headers := '{"Authorization": "Bearer ' || current_setting('app.settings.service_role_key') || '", "Content-Type": "application/json"}',
--              body := '{}'
--            );
--
-- ============================================================================
-- LINEAR INTEGRATION JOBS
-- ============================================================================
--
-- Job 7: Daily Linear Issues Sync
--   Name: sync-linear-issues-daily
--   Schedule: 0 4 * * * (4:00 AM UTC daily)
--   Command: SELECT net.http_post(
--              url := 'https://rnpfeblxapdafrbmomix.supabase.co/functions/v1/sync-linear-issues',
--              headers := '{"Authorization": "Bearer ' || current_setting('app.settings.service_role_key') || '", "Content-Type": "application/json"}',
--              body := '{}'
--            );
--
-- Job 8: Daily Linear-to-Feedback Mapping
--   Name: map-linear-to-feedback-daily
--   Schedule: 10 4 * * * (4:10 AM UTC daily)
--   Command: SELECT net.http_post(
--              url := 'https://rnpfeblxapdafrbmomix.supabase.co/functions/v1/map-linear-to-feedback',
--              headers := '{"Authorization": "Bearer ' || current_setting('app.settings.service_role_key') || '", "Content-Type": "application/json"}',
--              body := '{}'
--            );
--
-- ============================================================================
-- COMPLETE DAILY SCHEDULE
-- ============================================================================
--
-- 2:00 AM - sync-user-events-daily            (~2 min)
--   └─ Fetches yesterday's events, processes last 60 days
--
-- 2:20 AM - sync-user-properties-daily        (~2 min)
--   └─ Fetches current user properties from Mixpanel
--
-- 2:45 AM - sync-engagement-daily             (~5 min + auto-chain)
--   └─ Fetches engagement data
--   └─ Auto-triggers: process-portfolio-engagement
--   └─ Auto-triggers: process-creator-engagement
--   └─ Auto-triggers: refresh materialized views
--
-- 3:15 AM - sync-creator-data-daily           (~2 min)
--   └─ Fetches creator insights from Mixpanel
--
-- 3:30 AM - sync-support-conversations-daily  (~15 min)
--   └─ Fetches new Zendesk tickets (incremental)
--   └─ Updates raw_support_conversations table
--
-- 3:50 AM - trigger-support-analysis-daily    (~10 min)
--   └─ Analyzes support conversations with AI
--   └─ Generates feedback themes and sentiment
--
-- 4:00 AM - sync-linear-issues-daily          (~5 min)
--   └─ Fetches Linear issues from "dub 3.0" team
--
-- 4:10 AM - map-linear-to-feedback-daily      (~5 min)
--   └─ Maps Linear issues to support feedback items
--   └─ Uses Zendesk integration + AI semantic matching
--
-- Total workflow time: ~45 minutes
-- All dashboards fresh by 4:15 AM UTC daily
--
-- ============================================================================

-- Enable pg_cron extension (required for cron jobs)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Create cron_job_config table if it doesn't exist
CREATE TABLE IF NOT EXISTS cron_job_config (
  job_name TEXT PRIMARY KEY,
  schedule TEXT NOT NULL,
  command TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  estimated_duration_minutes INTEGER,
  depends_on TEXT[], -- Jobs that should complete before this one
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for category filtering
CREATE INDEX IF NOT EXISTS idx_cron_job_config_category ON cron_job_config(category);

-- Insert/update all cron job configurations
INSERT INTO cron_job_config (job_name, schedule, command, description, category, estimated_duration_minutes, depends_on) VALUES

-- User Analysis Jobs
('sync-user-events-daily', '0 2 * * *',
 'SELECT net.http_post(url := ''https://rnpfeblxapdafrbmomix.supabase.co/functions/v1/sync-mixpanel-user-events'', headers := ''{"Authorization": "Bearer '' || current_setting(''app.settings.service_role_key'') || ''", "Content-Type": "application/json"}'', body := ''{}'')',
 'Daily sync of user events from Mixpanel Export API. Fetches yesterday only, processes last 60 days (rolling 60-day window)',
 'user_analysis', 2, NULL),

('sync-user-properties-daily', '20 2 * * *',
 'SELECT net.http_post(url := ''https://rnpfeblxapdafrbmomix.supabase.co/functions/v1/sync-mixpanel-user-properties-v2'', headers := ''{"Authorization": "Bearer '' || current_setting(''app.settings.service_role_key'') || ''", "Content-Type": "application/json"}'', body := ''{}'')',
 'Daily sync of user properties from Mixpanel Engage API. Fetches current state properties (totalDeposits, income, etc.)',
 'user_analysis', 2, ARRAY['sync-user-events-daily']),

('sync-engagement-daily', '45 2 * * *',
 'SELECT net.http_post(url := ''https://rnpfeblxapdafrbmomix.supabase.co/functions/v1/sync-mixpanel-engagement'', headers := ''{"Authorization": "Bearer '' || current_setting(''app.settings.service_role_key'') || ''", "Content-Type": "application/json"}'', body := ''{}'')',
 'Daily sync of engagement data (views, subscriptions, copies). Auto-triggers processing chain and materialized view refresh.',
 'user_analysis', 5, ARRAY['sync-user-properties-daily']),

-- Creator Analysis Jobs
('sync-creator-data-daily', '15 3 * * *',
 'SELECT net.http_post(url := ''https://rnpfeblxapdafrbmomix.supabase.co/functions/v1/sync-creator-data'', headers := ''{"Authorization": "Bearer '' || current_setting(''app.settings.service_role_key'') || ''", "Content-Type": "application/json"}'', body := ''{}'')',
 'Daily sync of creator insights data from Mixpanel. Updates premium creator metrics and portfolio performance.',
 'creator_analysis', 2, ARRAY['sync-engagement-daily']),

-- Support Analysis Jobs
('sync-support-conversations-daily', '30 3 * * *',
 'SELECT net.http_post(url := ''https://rnpfeblxapdafrbmomix.supabase.co/functions/v1/sync-support-conversations'', headers := ''{"Authorization": "Bearer '' || current_setting(''app.settings.service_role_key'') || ''", "Content-Type": "application/json"}'', body := ''{}'')',
 'Daily sync of Zendesk support tickets (incremental). Fetches new and updated tickets since last sync.',
 'support_analysis', 15, ARRAY['sync-creator-data-daily']),

('trigger-support-analysis-daily', '50 3 * * *',
 'SELECT net.http_post(url := ''https://rnpfeblxapdafrbmomix.supabase.co/functions/v1/trigger-support-analysis'', headers := ''{"Authorization": "Bearer '' || current_setting(''app.settings.service_role_key'') || ''", "Content-Type": "application/json"}'', body := ''{}'')',
 'Daily AI analysis of support conversations. Generates feedback themes, sentiment analysis, and top issues.',
 'support_analysis', 10, ARRAY['sync-support-conversations-daily']),

-- Linear Integration Jobs
('sync-linear-issues-daily', '0 4 * * *',
 'SELECT net.http_post(url := ''https://rnpfeblxapdafrbmomix.supabase.co/functions/v1/sync-linear-issues'', headers := ''{"Authorization": "Bearer '' || current_setting(''app.settings.service_role_key'') || ''", "Content-Type": "application/json"}'', body := ''{}'')',
 'Daily sync of Linear issues from "dub 3.0" team (last 6 months). Updates linear_issues table with current status.',
 'linear_integration', 5, ARRAY['trigger-support-analysis-daily']),

('map-linear-to-feedback-daily', '10 4 * * *',
 'SELECT net.http_post(url := ''https://rnpfeblxapdafrbmomix.supabase.co/functions/v1/map-linear-to-feedback'', headers := ''{"Authorization": "Bearer '' || current_setting(''app.settings.service_role_key'') || ''", "Content-Type": "application/json"}'', body := ''{}'')',
 'Daily mapping of Linear issues to top 10 support feedback items. Uses Zendesk integration + AI semantic matching.',
 'linear_integration', 5, ARRAY['sync-linear-issues-daily'])

ON CONFLICT (job_name) DO UPDATE SET
  schedule = EXCLUDED.schedule,
  command = EXCLUDED.command,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  estimated_duration_minutes = EXCLUDED.estimated_duration_minutes,
  depends_on = EXCLUDED.depends_on,
  updated_at = NOW();

-- Grant read access to cron_job_config table
GRANT SELECT ON cron_job_config TO anon, authenticated, service_role;

-- Add helpful comments
COMMENT ON TABLE cron_job_config IS
'Complete configuration reference for all daily cron jobs. These jobs must be created manually via Supabase Dashboard > Database > Cron Jobs. This table documents the intended schedule, commands, dependencies, and timing for all automated data syncs.';

COMMENT ON COLUMN cron_job_config.category IS
'Job category: user_analysis, creator_analysis, support_analysis, or linear_integration';

COMMENT ON COLUMN cron_job_config.depends_on IS
'Array of job names that should complete before this job runs. Used for documentation and dependency tracking.';

COMMENT ON COLUMN cron_job_config.estimated_duration_minutes IS
'Approximate runtime in minutes. Used for scheduling jobs with proper time buffers.';

-- Create a helpful view to see the daily schedule
CREATE OR REPLACE VIEW daily_cron_schedule AS
SELECT
  job_name,
  category,
  schedule,
  estimated_duration_minutes,
  depends_on,
  description,
  -- Parse cron schedule to get hour and minute (assumes format: 'minute hour * * *')
  CASE
    WHEN schedule ~ '^\d+ \d+ \* \* \*$' THEN
      TO_TIMESTAMP(
        SPLIT_PART(schedule, ' ', 2) || ':' || SPLIT_PART(schedule, ' ', 1),
        'HH24:MI'
      )::TIME
    ELSE NULL
  END AS run_time_utc,
  -- Calculate estimated completion time
  CASE
    WHEN schedule ~ '^\d+ \d+ \* \* \*$' THEN
      (TO_TIMESTAMP(
        SPLIT_PART(schedule, ' ', 2) || ':' || SPLIT_PART(schedule, ' ', 1),
        'HH24:MI'
      ) + (estimated_duration_minutes || ' minutes')::INTERVAL)::TIME
    ELSE NULL
  END AS estimated_completion_utc
FROM cron_job_config
ORDER BY run_time_utc;

GRANT SELECT ON daily_cron_schedule TO anon, authenticated, service_role;

COMMENT ON VIEW daily_cron_schedule IS
'Helpful view showing daily cron job schedule with start times and estimated completion times in UTC.';

-- Verification message
DO $$
BEGIN
  RAISE NOTICE '✅ Complete daily cron job configuration created successfully';
  RAISE NOTICE '';
  RAISE NOTICE '📋 8 cron jobs configured:';
  RAISE NOTICE '   - 3 user analysis jobs (Mixpanel user data)';
  RAISE NOTICE '   - 1 creator analysis job (Mixpanel creator data)';
  RAISE NOTICE '   - 2 support analysis jobs (Zendesk + AI)';
  RAISE NOTICE '   - 2 Linear integration jobs (issue tracking)';
  RAISE NOTICE '';
  RAISE NOTICE '⏰ Daily schedule: 2:00 AM - 4:15 AM UTC (~45 min total)';
  RAISE NOTICE '';
  RAISE NOTICE '🔧 NEXT STEPS:';
  RAISE NOTICE '   1. Go to Supabase Dashboard > Database > Cron Jobs';
  RAISE NOTICE '   2. Create 8 cron jobs using configuration from this migration';
  RAISE NOTICE '   3. Query daily_cron_schedule view to verify schedule';
  RAISE NOTICE '';
  RAISE NOTICE '📊 Helpful queries:';
  RAISE NOTICE '   SELECT * FROM daily_cron_schedule;';
  RAISE NOTICE '   SELECT * FROM cron_job_config WHERE category = ''user_analysis'';';
END $$;
