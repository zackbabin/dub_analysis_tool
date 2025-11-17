-- Add Linear integration cron jobs to daily sync workflow
-- Runs after support analysis completes
-- Date: 2025-11-17
--
-- SETUP INSTRUCTIONS:
-- 1. Run this migration: `supabase db push`
-- 2. Go to Supabase Dashboard > Database > Cron Jobs
-- 3. Create 2 new cron jobs using the settings below:
--
-- Job 5: Daily Linear Issues Sync
--   Name: sync-linear-issues-daily
--   Schedule: 0 4 * * * (4:00 AM UTC daily)
--   Command: SELECT extensions.http_post_edge_function('sync-linear-issues', '{}');
--
-- Job 6: Daily Linear-to-Feedback Mapping
--   Name: map-linear-to-feedback-daily
--   Schedule: 10 4 * * * (4:10 AM UTC daily)
--   Command: SELECT extensions.http_post_edge_function('map-linear-to-feedback', '{}');
--
-- TIMING EXPLANATION:
-- These jobs run AFTER the support analysis (trigger-support-analysis) completes:
-- - 4:00 AM: Linear issues sync (fetches from "dub 3.0" team, last 6 months)
-- - 4:10 AM: Linear-to-feedback mapping (maps issues to top 10 feedback items)
--
-- Total workflow time: ~10-15 minutes
-- CX Analysis tab will show Linear status by 4:15 AM UTC daily

-- Insert Linear cron job configurations for documentation
INSERT INTO cron_job_config (job_name, schedule, command, description) VALUES
('sync-linear-issues-daily', '0 4 * * *',
 'SELECT extensions.http_post_edge_function(''sync-linear-issues'', ''{}'')',
 'Daily sync of Linear issues from "dub 3.0" team (last 6 months)'),

('map-linear-to-feedback-daily', '10 4 * * *',
 'SELECT extensions.http_post_edge_function(''map-linear-to-feedback'', ''{}'')',
 'Daily mapping of Linear issues to top 10 support feedback items using Zendesk integration + AI semantic matching')
ON CONFLICT (job_name) DO UPDATE SET
  schedule = EXCLUDED.schedule,
  command = EXCLUDED.command,
  description = EXCLUDED.description;

COMMENT ON TABLE cron_job_config IS
'Configuration reference for cron jobs. Includes Linear integration jobs (sync-linear-issues-daily, map-linear-to-feedback-daily) that run after support analysis. These should be created via Supabase Dashboard > Database > Cron Jobs.';
