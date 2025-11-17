-- Create daily cron jobs to automate data syncing
-- These replicate the "Sync Live Data" button workflow
-- Runs daily at 2 AM UTC to keep dashboard data fresh
-- Date: 2025-11-17
--
-- SETUP INSTRUCTIONS:
-- 1. Run this migration: `supabase db push`
-- 2. Go to Supabase Dashboard > Database > Cron Jobs
-- 3. Create 4 new cron jobs using the settings below:
--
-- Job 1: Daily User Events Sync
--   Name: sync-user-events-daily
--   Schedule: 0 2 * * * (2:00 AM UTC daily)
--   Command: SELECT extensions.http_post_edge_function('sync-mixpanel-user-events', '{}');
--
-- Job 2: Daily User Properties Sync
--   Name: sync-user-properties-daily
--   Schedule: 20 2 * * * (2:20 AM UTC daily)
--   Command: SELECT extensions.http_post_edge_function('sync-mixpanel-user-properties-v2', '{}');
--
-- Job 3: Daily Engagement Sync (auto-triggers processing chain)
--   Name: sync-engagement-daily
--   Schedule: 45 2 * * * (2:45 AM UTC daily)
--   Command: SELECT extensions.http_post_edge_function('sync-mixpanel-engagement', '{}');
--
-- Job 4: Daily Creator Data Sync
--   Name: sync-creator-data-daily
--   Schedule: 15 3 * * * (3:15 AM UTC daily)
--   Command: SELECT extensions.http_post_edge_function('sync-creator-data', '{}');
--
-- TIMING EXPLANATION:
-- - 2:00 AM: User events sync starts (takes ~2 min)
-- - 2:20 AM: User properties sync starts (takes ~2 min, runs after events)
-- - 2:45 AM: Engagement sync starts (takes ~3-5 min, auto-chains to processing and view refresh)
-- - 3:15 AM: Creator data sync starts (runs after all other syncs complete)
--
-- Total workflow time: ~75 minutes
-- Dashboard data is fresh by 3:30 AM UTC daily

-- Enable pg_cron extension (required for cron jobs)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Create a comment to document the cron job setup
COMMENT ON SCHEMA public IS
'Cron jobs should be created via Supabase Dashboard > Database > Cron Jobs. See migration 20251117_create_daily_sync_cron_jobs.sql for complete setup instructions and schedule details.';

-- Document the cron job configuration in a table for reference
CREATE TABLE IF NOT EXISTS cron_job_config (
  job_name TEXT PRIMARY KEY,
  schedule TEXT NOT NULL,
  command TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert cron job configurations for documentation
INSERT INTO cron_job_config (job_name, schedule, command, description) VALUES
('sync-user-events-daily', '0 2 * * *',
 'SELECT extensions.http_post_edge_function(''sync-mixpanel-user-events'', ''{}'')',
 'Daily sync of user events from Mixpanel Export API (30-day rolling window)'),

('sync-user-properties-daily', '20 2 * * *',
 'SELECT extensions.http_post_edge_function(''sync-mixpanel-user-properties-v2'', ''{}'')',
 'Daily sync of user properties from Mixpanel Engage API'),

('sync-engagement-daily', '45 2 * * *',
 'SELECT extensions.http_post_edge_function(''sync-mixpanel-engagement'', ''{}'')',
 'Daily sync of engagement data (views, subscriptions, copies). Auto-triggers processing chain and view refresh.'),

('sync-creator-data-daily', '15 3 * * *',
 'SELECT extensions.http_post_edge_function(''sync-creator-data'', ''{}'')',
 'Daily sync of creator insights data from Mixpanel')
ON CONFLICT (job_name) DO UPDATE SET
  schedule = EXCLUDED.schedule,
  command = EXCLUDED.command,
  description = EXCLUDED.description;

-- Grant read access to cron_job_config table
GRANT SELECT ON cron_job_config TO anon, authenticated;

COMMENT ON TABLE cron_job_config IS
'Configuration reference for cron jobs. These should be created via Supabase Dashboard > Database > Cron Jobs. This table documents the intended schedule and commands.';
