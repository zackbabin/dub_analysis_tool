-- Migration: Drop cron_job_config table
-- Date: 2025-12-03
--
-- Removes the cron_job_config table since cron jobs are no longer being run.
-- This table was used for documenting cron job schedules and dependencies,
-- but all cron jobs were disabled via disable_all_crons.sql migration.
--
-- Objects being dropped:
-- - cron_job_config table (and its index)
--
-- Verified that:
-- - No edge functions reference this table
-- - No application code queries this table
-- - No database functions depend on this table
-- - The daily_cron_schedule view (which depended on this table) was already dropped in 20251119_drop_unused_objects.sql
-- - All cron jobs were unscheduled via disable_all_crons.sql

-- Drop the cron_job_config table
DROP TABLE IF EXISTS cron_job_config CASCADE;

-- The CASCADE will automatically drop:
-- - idx_cron_job_config_category index
-- - Any remaining permissions/grants

COMMENT ON SCHEMA public IS 'Cleaned up cron configuration on 2025-12-03: Removed cron_job_config table as cron jobs are no longer running';
