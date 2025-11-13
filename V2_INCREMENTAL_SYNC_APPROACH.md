# Sync-Mixpanel-Users-V2: Incremental Aggregation Approach

## Overview

This approach uses the **Mixpanel Export API** with **incremental aggregation** to avoid timeout issues while maintaining cumulative event totals.

## How It Works

### Daily Incremental Syncs
- **Fetches:** Yesterday's events only (~5k-50k events)
- **Processes:** Streams events line-by-line, aggregates by user
- **Upserts:** ADDS new event counts to existing database totals
- **Duration:** ~10-30 seconds (no timeout risk)

### Key Innovation: Incremental Upsert

Instead of replacing values:
```sql
-- OLD (v2 original): Replaces totals ❌
UPDATE subscribers_insights_v2 SET total_copies = 5

-- NEW (v2 incremental): Adds to existing totals ✅
UPDATE subscribers_insights_v2
SET total_copies = COALESCE(total_copies, 0) + 5
```

## Database Changes

### New PostgreSQL Function: `upsert_subscribers_incremental()`

**Event Metrics (INCREMENTED):**
- `total_copies` - adds new copies to existing count
- `total_subscriptions` - adds new subscriptions
- `total_pdp_views` - adds new views
- `total_creator_profile_views` - adds new views
- `paywall_views`, `app_sessions`, `discover_tab_views`, etc.

**User Properties (REPLACED):**
- `income`, `net_worth` - takes latest non-null value
- `investing_activity`, `investing_objective` - takes latest
- `linked_bank_account` - takes latest boolean

**Account Metrics (REPLACED):**
- `available_copy_credits`, `buying_power` - current balance
- `total_deposits`, `total_deposit_count` - current totals from Mixpanel
- `active_created_portfolios` - current count

## Deployment Steps

### 1. Deploy Database Migration
```bash
# Run in Supabase SQL Editor
# File: supabase/migrations/20251113_create_incremental_upsert_function.sql
```

This creates the `upsert_subscribers_incremental()` function.

### 2. Deploy Updated Edge Function
```bash
supabase functions deploy sync-mixpanel-users-v2
```

The updated function now calls `upsert_subscribers_incremental()` instead of regular upsert.

### 3. Initial Historical Backfill (One-Time)

**Option A: Manual Trigger (Recommended for Testing)**
Manually trigger sync-mixpanel-users-v2 in Supabase Dashboard with extended date range:
- Test with 7 days first
- Then 30 days
- Then 60-90 days

**Option B: Chunked Backfill (Robust)**
Modify the function temporarily to accept date range parameter and run multiple times:
- Days 0-30
- Days 31-60
- Days 61-90

### 4. Set Up Daily Cron Job
```bash
# Run in Supabase SQL Editor
# File: supabase/migrations/20251113_cron_v2_incremental.sql
```

This schedules daily sync at 2:00 AM UTC.

## Data Flow

```
Day 1 Backfill (0-30 days):
  Fetch 30 days of events → Count: User A has 100 total_copies
  → Insert into DB: total_copies = 100

Day 2 (Daily Sync):
  Fetch yesterday's events → Count: User A has 5 new copies
  → Update DB: total_copies = 100 + 5 = 105

Day 3 (Daily Sync):
  Fetch yesterday's events → Count: User A has 3 new copies
  → Update DB: total_copies = 105 + 3 = 108
```

## Comparison with Original sync-mixpanel-users

| Feature | Original (Insights API) | V2 Incremental (Export API) |
|---------|------------------------|----------------------------|
| **Data Source** | Chart 85713544 (Insights) | Raw Events (Export) |
| **Date Range** | Configured in chart | Programmatic (1 day) |
| **Aggregation** | Mixpanel server-side | Client-side streaming |
| **Timeout Risk** | High (>140s with large data) | Low (~10-30s per day) |
| **Data Structure** | Pre-aggregated totals | Raw events → aggregated |
| **Update Type** | Replace totals | Increment totals |
| **Historical Data** | Query all time = timeout | Backfill once + daily increments |

## Advantages

✅ **No Timeout Issues** - Only processes 1 day of events at a time
✅ **Scalable** - Performance doesn't degrade as historical data grows
✅ **Accurate Cumulative Totals** - Incremental aggregation maintains lifetime counts
✅ **All User Properties** - Export API includes user profile properties on events
✅ **Independent from Insights API** - Not affected by Mixpanel chart performance
✅ **Cron-Ready** - No timeout pressure when called from cron job

## Testing Plan

### 1. Test Incremental Upsert Function
```sql
-- Insert test user
INSERT INTO subscribers_insights_v2 (distinct_id, total_copies, updated_at)
VALUES ('test_user_123', 10, NOW());

-- Test increment
SELECT upsert_subscribers_incremental('[
  {
    "distinct_id": "test_user_123",
    "total_copies": 5,
    "updated_at": "2025-11-13T00:00:00Z",
    "events_processed": 10,
    "first_event_time": "2025-11-13T00:00:00Z",
    "last_event_time": "2025-11-13T01:00:00Z"
  }
]'::jsonb);

-- Verify: Should show total_copies = 15 (10 + 5)
SELECT distinct_id, total_copies FROM subscribers_insights_v2
WHERE distinct_id = 'test_user_123';
```

### 2. Test Edge Function Manually
Trigger sync-mixpanel-users-v2 from Supabase Dashboard → Edge Functions

### 3. Verify Data
```sql
-- Check that event counts are accumulating
SELECT distinct_id, total_copies, total_subscriptions, updated_at
FROM subscribers_insights_v2
ORDER BY updated_at DESC
LIMIT 10;
```

## Monitoring

Track sync performance:
```sql
SELECT
  source,
  status,
  created_at,
  completed_at,
  EXTRACT(EPOCH FROM (completed_at - created_at)) as duration_seconds,
  sync_metadata
FROM sync_logs
WHERE source = 'mixpanel_users_v2'
ORDER BY created_at DESC
LIMIT 10;
```

## Rollback Plan

If issues occur:
1. Unschedule cron job: `SELECT cron.unschedule('mixpanel-v2-incremental-daily');`
2. Re-enable original sync-mixpanel-users with reduced chart date range
3. Drop function: `DROP FUNCTION upsert_subscribers_incremental(jsonb);`

## Future Enhancements

1. **Deduplication:** Track processed event IDs to prevent double-counting
2. **Backfill Automation:** Create separate function for historical backfill
3. **Date Range Parameter:** Allow v2 to accept custom date ranges for backfill
4. **Monitoring Dashboard:** Track sync success rates and data freshness
