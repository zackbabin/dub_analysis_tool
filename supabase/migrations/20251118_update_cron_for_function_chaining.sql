-- Update cron jobs to use function chaining instead of manual orchestration
-- With function chaining, only sync-support-conversations needs to be scheduled
-- It will automatically trigger: sync-linear-issues → analyze-support-feedback → map-linear-to-feedback

-- ============================================================================
-- REMOVE OBSOLETE CRON JOBS
-- ============================================================================

-- Delete trigger-support-analysis-daily (deprecated - now handled by function chaining)
DELETE FROM cron_job_config WHERE job_name = 'trigger-support-analysis-daily';

-- Delete sync-linear-issues-daily (now triggered by sync-support-conversations)
DELETE FROM cron_job_config WHERE job_name = 'sync-linear-issues-daily';

-- Delete map-linear-to-feedback-daily (now triggered by analyze-support-feedback)
DELETE FROM cron_job_config WHERE job_name = 'map-linear-to-feedback-daily';

-- ============================================================================
-- UPDATE REMAINING JOB
-- ============================================================================

-- Update sync-support-conversations-daily to reflect that it triggers the full chain
UPDATE cron_job_config
SET
  description = 'Daily sync of Zendesk support tickets (incremental). Automatically chains: sync-support-conversations → sync-linear-issues → analyze-support-feedback → map-linear-to-feedback.',
  estimated_duration_minutes = 35,  -- Total chain duration (~35 min)
  depends_on = ARRAY['sync-creator-data-daily']
WHERE job_name = 'sync-support-conversations-daily';

-- ============================================================================
-- COMMENTS
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '✅ Updated cron jobs for function chaining';
  RAISE NOTICE '   Only sync-support-conversations-daily will run from cron';
  RAISE NOTICE '   It will automatically trigger the full workflow chain';
  RAISE NOTICE '   Removed 3 obsolete jobs: trigger-support-analysis-daily, sync-linear-issues-daily, map-linear-to-feedback-daily';
END $$;
