# Daily Automated Data Sync Setup

This document explains how to set up automated daily syncs to keep your dashboard data fresh without manual intervention.

## Overview

The automated sync replicates the "Sync Live Data" button workflow, running four Edge Functions in sequence:

1. **sync-mixpanel-user-events** (2:00 AM UTC) - Fetches user event data from last 15 days
2. **sync-mixpanel-user-properties-v2** (2:20 AM UTC) - Fetches user properties from Mixpanel
3. **sync-mixpanel-engagement** (2:45 AM UTC) - Fetches engagement data and triggers processing chain
4. **sync-creator-data** (3:15 AM UTC) - Fetches creator insights data

**Total runtime:** ~75 minutes
**Dashboard fresh by:** 3:30 AM UTC daily

## Setup Steps

### 1. Run the Migration

First, apply the cron job configuration migration:

```bash
supabase db push
```

This will:
- Enable the `pg_cron` extension
- Create a `cron_job_config` table with all job definitions
- Document the cron job setup

### 2. Create Cron Jobs via Supabase Dashboard

Go to your Supabase project dashboard:

**Dashboard > Database > Cron Jobs > Create a new cron job**

Create 4 cron jobs with the following settings:

#### Job 1: User Events Sync
- **Name:** `sync-user-events-daily`
- **Schedule:** `0 2 * * *` (Every day at 2:00 AM UTC)
- **Command:**
  ```sql
  SELECT extensions.http_post_edge_function('sync-mixpanel-user-events', '{}');
  ```

#### Job 2: User Properties Sync
- **Name:** `sync-user-properties-daily`
- **Schedule:** `20 2 * * *` (Every day at 2:20 AM UTC)
- **Command:**
  ```sql
  SELECT extensions.http_post_edge_function('sync-mixpanel-user-properties-v2', '{}');
  ```

#### Job 3: Engagement Sync
- **Name:** `sync-engagement-daily`
- **Schedule:** `45 2 * * *` (Every day at 2:45 AM UTC)
- **Command:**
  ```sql
  SELECT extensions.http_post_edge_function('sync-mixpanel-engagement', '{}');
  ```

#### Job 4: Creator Data Sync
- **Name:** `sync-creator-data-daily`
- **Schedule:** `15 3 * * *` (Every day at 3:15 AM UTC)
- **Command:**
  ```sql
  SELECT extensions.http_post_edge_function('sync-creator-data', '{}');
  ```

### 3. Verify Setup

After creating the cron jobs, verify they're scheduled correctly:

```sql
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname LIKE '%sync%daily%'
ORDER BY jobname;
```

You should see 4 active cron jobs.

## Timing Explanation

The jobs are spaced out to allow each to complete before the next one starts:

- **2:00 AM** - User events starts (takes ~2 minutes)
- **2:20 AM** - User properties starts (takes ~2 minutes)
  *(20 min buffer allows events to complete)*
- **2:45 AM** - Engagement starts (takes ~3-5 minutes + processing chain)
  *(45 min buffer allows both previous jobs to complete)*
- **3:15 AM** - Creator data starts (takes ~2 minutes)
  *(75 min buffer allows all previous jobs and processing to complete)*

The engagement sync automatically triggers:
- `process-portfolio-engagement`
- `process-creator-engagement`
- `refresh-materialized-views`

## Monitoring

### View Sync Logs

Check the `sync_logs` table to monitor sync execution:

```sql
SELECT
  function_name,
  sync_type,
  status,
  total_records_inserted,
  synced_at,
  error_message
FROM sync_logs
WHERE synced_at > NOW() - INTERVAL '7 days'
ORDER BY synced_at DESC;
```

### View Cron Job Execution History

```sql
SELECT
  runid,
  jobid,
  job_pid,
  database,
  username,
  command,
  status,
  return_message,
  start_time,
  end_time
FROM cron.job_run_details
WHERE job_pid IN (
  SELECT jobid FROM cron.job WHERE jobname LIKE '%sync%daily%'
)
ORDER BY start_time DESC
LIMIT 20;
```

## Troubleshooting

### Cron Jobs Not Running

1. **Check if pg_cron extension is enabled:**
   ```sql
   SELECT * FROM pg_extension WHERE extname = 'pg_cron';
   ```

2. **Check if cron jobs are active:**
   ```sql
   SELECT * FROM cron.job WHERE active = false;
   ```

3. **Enable a disabled job:**
   ```sql
   UPDATE cron.job SET active = true WHERE jobname = 'sync-user-events-daily';
   ```

### Edge Function Errors

If cron jobs are running but Edge Functions are failing:

1. Check the `sync_logs` table for error messages
2. Test the Edge Function manually via Supabase Dashboard
3. Check Edge Function logs in Supabase Dashboard > Edge Functions

### Adjust Timing

If jobs are timing out due to overlapping execution:

1. Increase the time buffer between jobs
2. Update the schedule in Supabase Dashboard > Database > Cron Jobs

## Disabling Automated Sync

To temporarily disable automated syncs without deleting the jobs:

```sql
UPDATE cron.job
SET active = false
WHERE jobname LIKE '%sync%daily%';
```

To re-enable:

```sql
UPDATE cron.job
SET active = true
WHERE jobname LIKE '%sync%daily%';
```

## Manual Sync

You can still manually trigger syncs via the "Sync Live Data" button in the dashboard. Manual syncs and automated syncs both use the same Edge Functions and won't conflict.

## Notes

- All times are in UTC
- Cron jobs use Supabase's built-in function invocation (no external HTTP calls)
- Edge Functions authenticate automatically using Supabase environment variables
- No credentials are stored in SQL or exposed in logs
