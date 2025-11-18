# 60-Day Backfill Instructions

This document provides step-by-step instructions for backfilling `subscribers_insights` with 60 days of user events and current user properties.

## Overview

The backfill process:
1. Clears all existing data (clean slate)
2. Fetches 60 days of events via 4 auto-chaining chunks
3. Fetches current user properties
4. Processes and aggregates data
5. Refreshes materialized views

**Total time:** ~30-40 minutes

---

## Prerequisites

✅ All migrations applied (especially these critical ones):
- `20251117_add_60day_filter_to_events.sql` - 60-day filtering
- `20251117_move_event_processing_to_postgres.sql` - Postgres processing
- `20251117_create_all_cron_jobs_programmatically.sql` - Cron jobs

✅ Edge functions deployed:
- `sync-mixpanel-user-events-v2` (Insights API - no chunking needed)
- `sync-mixpanel-user-properties-v2` (Engage API with pagination)

✅ Environment variables set in Supabase Dashboard > Settings > Edge Functions:
- `MIXPANEL_PROJECT_ID`
- `MIXPANEL_USERNAME`
- `MIXPANEL_SECRET`

---

## Step 1: Flush Existing Data

Run the flush migration to start with a clean slate:

```bash
supabase db execute --file supabase/migrations/20251117_flush_all_user_data_for_backfill.sql
```

This will:
- Clear `raw_mixpanel_events_staging`
- Clear `portfolio_engagement_staging` (if exists)
- Clear `creator_engagement_staging` (if exists)
- Truncate `subscribers_insights`
- Refresh `main_analysis`, `copy_engagement_summary`, `retention_analysis` (now empty)

**Expected output:**
```
Step 1: Clearing staging tables...
  Cleared raw_mixpanel_events_staging
  Cleared portfolio_engagement_staging
  Cleared creator_engagement_staging
Step 1 complete: All staging tables cleared

Step 2: Clearing subscribers_insights table...
  Current record count: X
  Cleared subscribers_insights (X records removed)
Step 2 complete: subscribers_insights cleared

Step 3: Refreshing dependent materialized views...
  Refreshed main_analysis (now empty)
  Refreshed copy_engagement_summary (now empty)
  Refreshed retention_analysis (now empty)
Step 3 complete: All materialized views refreshed

Step 4: Verifying flush completed...
  subscribers_insights: 0 records
  raw_mixpanel_events_staging: 0 records
  main_analysis: 0 records

FLUSH SUCCESSFUL - All tables are empty and ready for backfill
```

---

## Step 2: Deploy Edge Functions

Deploy the updated edge functions:

```bash
supabase functions deploy sync-mixpanel-user-events-v2
supabase functions deploy sync-mixpanel-user-properties-v2
```

**Verify deployment:**
- Go to Supabase Dashboard > Edge Functions
- Both functions should show "Active"
- Check recent deployments timestamp

**Note:** The new `sync-mixpanel-user-events-v2` uses the Insights API instead of Export API for better performance.

---

## Step 3: Trigger Event Metrics Sync (Insights API)

Invoke the new Insights API function to fetch aggregated event metrics:

### Option A: Via Supabase Dashboard

1. Go to Edge Functions > `sync-mixpanel-user-events-v2`
2. Click "Invoke"
3. Leave body empty or set to `{}`
4. Click "Send request"

### Option B: Via curl

```bash
curl -X POST 'https://rnpfeblxapdafrbmomix.supabase.co/functions/v1/sync-mixpanel-user-events-v2' \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**What happens:**
- Fetches pre-aggregated metrics from Mixpanel Insights API chart 85713544
- Syncs 17 event metrics (total bank links, copies, views, sessions, etc.)
- Single API call - no chunking needed!

**Expected timeline:**
- ~2-5 minutes (much faster than Export API approach)

**Monitor progress:**

```sql
-- Check that event metrics are being populated
SELECT
  COUNT(*) as total_users,
  COUNT(*) FILTER (WHERE total_copies > 0) as users_with_copies,
  COUNT(*) FILTER (WHERE app_sessions > 0) as users_with_sessions,
  COUNT(*) FILTER (WHERE total_bank_links > 0) as users_with_bank_links
FROM subscribers_insights;

-- Sample data
SELECT
  distinct_id,
  total_copies,
  total_bank_links,
  app_sessions,
  total_subscriptions,
  updated_at
FROM subscribers_insights
WHERE total_copies > 0 OR total_subscriptions > 0
LIMIT 10;
```

**Expected result:**
- `subscribers_insights`: ~15k-20k profiles with event metrics populated

---

## Step 4: Trigger User Properties Sync

After the 60-day backfill completes, sync current user properties:

### Option A: Via Supabase Dashboard

1. Go to Edge Functions > `sync-mixpanel-user-properties-v2`
2. Click "Invoke"
3. Leave body empty or set to `{}`
4. Click "Send request"

### Option B: Via curl

```bash
curl -X POST 'https://rnpfeblxapdafrbmomix.supabase.co/functions/v1/sync-mixpanel-user-properties-v2' \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**What happens:**
- Fetches all user properties via paginated Engage API
- Auto-chains through all pages until complete
- Upserts properties to `subscribers_insights`

**Expected timeline:**
- ~5-10 minutes (depends on user count)

**Monitor progress:**

```sql
-- Check properties being populated
SELECT
  COUNT(*) as total_users,
  COUNT(income) as has_income,
  COUNT(net_worth) as has_net_worth,
  COUNT(total_deposits) as has_deposits,
  COUNT(linked_bank_account) as has_bank_linked
FROM subscribers_insights;
```

---

## Step 5: Verification

After both backfills complete, verify the data:

### 5.1 Check Record Counts

```sql
-- Main data table
SELECT COUNT(*) as total_profiles FROM subscribers_insights;
-- Expected: 15k-20k profiles

-- Materialized view
SELECT COUNT(*) as total_rows FROM main_analysis;
-- Expected: Same as subscribers_insights
```

**Note:** With Insights API, we no longer use `raw_mixpanel_events_staging` - metrics come pre-aggregated.

### 5.2 Check Last Sync

```sql
-- Last sync timestamp
SELECT
  distinct_id,
  updated_at,
  total_copies,
  app_sessions,
  total_bank_links
FROM subscribers_insights
ORDER BY updated_at DESC
LIMIT 10;
```

### 5.3 Check Data Quality

```sql
-- Users with event data
SELECT
  COUNT(*) as total_users,
  COUNT(*) FILTER (WHERE total_copies > 0) as users_with_copies,
  COUNT(*) FILTER (WHERE app_sessions > 0) as users_with_sessions,
  COUNT(*) FILTER (WHERE total_subscriptions > 0) as users_with_subscriptions
FROM subscribers_insights;

-- Users with property data
SELECT
  COUNT(*) as total_users,
  COUNT(*) FILTER (WHERE income IS NOT NULL) as has_income,
  COUNT(*) FILTER (WHERE net_worth IS NOT NULL) as has_net_worth,
  COUNT(*) FILTER (WHERE total_deposits > 0) as has_deposits
FROM subscribers_insights;

-- Sample data
SELECT
  distinct_id,
  income,
  total_deposits,
  total_copies,
  app_sessions,
  total_subscriptions,
  updated_at
FROM subscribers_insights
WHERE total_copies > 0 OR total_subscriptions > 0
LIMIT 10;
```

### 5.4 Check Materialized Views

```sql
-- Main analysis view
SELECT COUNT(*) FROM main_analysis;

-- Copy engagement summary
SELECT COUNT(*) FROM copy_engagement_summary;

-- If any are empty, refresh them:
SELECT refresh_main_analysis();
SELECT refresh_copy_engagement_summary();
```

---

## Expected Results

After successful backfill:

| Table/View | Expected Count | Notes |
|------------|---------------|-------|
| `subscribers_insights` | 15k-20k | All unique users with events or properties |
| `main_analysis` | 15k-20k | Same as subscribers_insights |
| `copy_engagement_summary` | Varies | Aggregated copy metrics |

**Event metrics (from Insights API chart 85713544):**
- All 17 metrics synced: total_bank_links, total_copies, app_sessions, etc.
- Data reflects lifetime/all-time totals from Mixpanel

---

## Troubleshooting

### Issue: Chunk timing out

**Symptoms:**
- Function returns timeout error
- Events staged but not all 4 chunks complete

**Solution:**
- The next chunk should auto-trigger
- Check staging table to see if events are accumulating
- Manually trigger next chunk if needed: `{"chunk_start_day": 15}` then 30, then 45

### Issue: No events in staging

**Symptoms:**
- `raw_mixpanel_events_staging` is empty after backfill
- Function completes but no data

**Solution:**
1. Check Mixpanel credentials in Edge Function environment
2. Check function logs for errors
3. Verify tracked events match Mixpanel event names
4. Try manual date range: `{"from_date": "2024-10-18", "to_date": "2024-10-18"}`

### Issue: Properties not syncing

**Symptoms:**
- Event counts populated but income, net_worth, etc. are NULL
- `sync-mixpanel-user-properties-v2` returns errors

**Solution:**
1. Check Mixpanel cohort ID (should be `5825472`)
2. Verify Engage API credentials
3. Check function logs for pagination errors
4. Try re-running sync (it will auto-paginate)

### Issue: Materialized views not updating

**Symptoms:**
- `subscribers_insights` has data but `main_analysis` is empty
- Views show stale data

**Solution:**
```sql
-- Manually refresh views
SELECT refresh_main_analysis();
SELECT refresh_copy_engagement_summary();

-- Check refresh status
SELECT * FROM refresh_tracking
WHERE view_name IN ('main_analysis', 'copy_engagement_summary')
ORDER BY last_refresh_at DESC;
```

---

## Next Steps After Backfill

1. **Monitor daily cron jobs** (they start at 2:00 AM UTC)
   - Check cron jobs in Supabase Dashboard > Database > Cron
   - Verify `sync-user-events-daily` runs successfully (now using Insights API v2)
   - Verify `sync-user-properties-daily` runs successfully

2. **Verify daily updates**
   - Each day, metrics will be refreshed from the Insights API chart
   - Metrics reflect all-time totals (not rolling windows)

3. **Set up monitoring** (optional)
   ```sql
   -- Create a daily check
   SELECT
     COUNT(*) as total_users,
     MAX(updated_at) as last_sync,
     (SELECT COUNT(*) FROM raw_mixpanel_events_staging) as total_events
   FROM subscribers_insights;
   ```

4. **Document baseline metrics** for comparison

---

## Rollback (If Needed)

If backfill fails and you need to start over:

```bash
# 1. Re-run flush migration
supabase db execute --file supabase/migrations/20251117_flush_all_user_data_for_backfill.sql

# 2. Check for any orphaned data
SELECT COUNT(*) FROM subscribers_insights; -- Should be 0
SELECT COUNT(*) FROM raw_mixpanel_events_staging; -- Should be 0

# 3. Start backfill process again from Step 3
```

---

## Support

For issues or questions:
- Check function logs in Supabase Dashboard > Edge Functions > Logs
- Review migration history: `SELECT * FROM _prisma_migrations ORDER BY finished_at DESC;`
- Check sync logs: `SELECT * FROM sync_logs ORDER BY started_at DESC LIMIT 20;`
