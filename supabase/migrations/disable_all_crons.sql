-- Disable all cron jobs to reduce CPU and Disk IO usage
-- This will stop all automated syncs until re-enabled

-- Unschedule all active cron jobs
SELECT cron.unschedule('sync-user-events-daily');
SELECT cron.unschedule('sync-user-properties-daily');
SELECT cron.unschedule('sync-engagement-daily');
SELECT cron.unschedule('sync-creator-data-daily');
SELECT cron.unschedule('sync-support-conversations-daily');

-- Verify all jobs are removed
SELECT jobname, schedule, active 
FROM cron.job 
WHERE jobname LIKE '%daily%';

-- If you want to see ALL cron jobs (including any others)
SELECT jobname, schedule, active, command 
FROM cron.job 
ORDER BY jobname;
