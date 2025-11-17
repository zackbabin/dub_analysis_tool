# Zendesk Backfill & Analysis Window Setup

## Overview

The system now supports:
1. **60-day backfill**: Sync historical Zendesk tickets from the last 60 days
2. **30-day analysis**: Analyze only the last 30 days of conversations

## Environment Variables

Add these to your Supabase Edge Function secrets:

```bash
# For sync: Initial lookback when no sync history exists (used once)
ANALYSIS_LOOKBACK_DAYS=60  # Default for first sync

# For analysis: How many days back to analyze (used every time)
ANALYSIS_WINDOW_DAYS=30    # Analyze last 30 days
```

## Setup Steps

### Step 1: Set Environment Variables

In Supabase Dashboard → Edge Functions → Manage secrets:

```bash
# Set sync lookback (for initial/backfill syncs)
supabase secrets set ANALYSIS_LOOKBACK_DAYS=60

# Set analysis window (for ongoing analysis)
supabase secrets set ANALYSIS_WINDOW_DAYS=30
```

### Step 2: Run Backfill Migration

Run the SQL migration to reset the Zendesk sync timestamp:

```sql
-- Run in Supabase SQL Editor
-- File: 20251117_backfill_zendesk_60_days.sql

UPDATE support_sync_status
SET
  last_sync_timestamp = NOW() - INTERVAL '60 days',
  last_sync_status = 'pending_backfill',
  error_message = 'Backfill: Reset to sync last 60 days of data'
WHERE source = 'zendesk';
```

### Step 3: Deploy Updated Functions

```bash
# Deploy the updated analyze function (uses ANALYSIS_WINDOW_DAYS)
supabase functions deploy analyze-support-feedback

# Optionally redeploy sync function if needed
supabase functions deploy sync-support-conversations
```

### Step 4: Trigger Backfill (May Require Multiple Runs)

**IMPORTANT: Edge functions have a 150-second timeout. With Zendesk's 10 req/min rate limit, you can process ~2,500 tickets per run. If you have more tickets in the last 60 days, you'll need to run the sync multiple times.**

#### How It Works:
1. **First run**: Fetches as many tickets as possible before timeout (saves progress)
2. **If timeout occurs**: Data is saved, but `last_sync_timestamp` isn't updated
3. **Second run**: Continues from same point, skips duplicates (upsert), fetches more
4. **Repeat** until sync completes and updates timestamp

#### Monitor Progress:

```sql
-- Check how many tickets you have so far
SELECT
  DATE(created_at) as date,
  COUNT(*) as tickets,
  source
FROM raw_support_conversations
WHERE created_at >= NOW() - INTERVAL '60 days'
GROUP BY DATE(created_at), source
ORDER BY date;

-- Check if still in progress (timestamp won't be updated until completion)
SELECT
  source,
  last_sync_timestamp,
  EXTRACT(DAY FROM NOW() - last_sync_timestamp) as days_ago,
  last_sync_status,
  conversations_synced
FROM support_sync_status
WHERE source = 'zendesk';
```

#### Run the Backfill:

```bash
# Run sync (repeat 2-3 times if needed for large ticket volumes)
curl -X POST \
  https://your-project-ref.supabase.co/functions/v1/sync-support-conversations \
  -H "Authorization: Bearer YOUR_ANON_KEY"

# Wait for response, check logs
# If it times out or completes with "still fetching", run again
# When complete, last_sync_timestamp will update to NOW
```

#### Signs Backfill is Complete:
- ✅ `last_sync_timestamp` updates to current time (not 60 days ago)
- ✅ Function completes without timeout
- ✅ No more new tickets being added between runs
- ✅ `conversations_synced` stops increasing

#### Estimate Number of Runs Needed:

Zendesk rate limit: **10 requests/min = 6 seconds per request**
Edge function timeout: **150 seconds**
Max requests per run: **~25 requests**
Tickets per request: **~100 tickets**
**Max tickets per run: ~2,500**

If you have:
- **< 2,500 tickets**: 1 run needed ✓
- **2,500-5,000 tickets**: 2 runs needed
- **5,000-7,500 tickets**: 3 runs needed
- **> 7,500 tickets**: 3+ runs needed

### Step 5: Run Analysis

After backfill completes, run the analysis:

```bash
curl -X POST \
  https://your-project-ref.supabase.co/functions/v1/analyze-support-feedback \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

This will analyze the **last 30 days** of conversations (controlled by `ANALYSIS_WINDOW_DAYS`).

## How It Works

### Sync Behavior
- **First sync** (no `last_sync_timestamp`): Uses `ANALYSIS_LOOKBACK_DAYS` (60 days)
- **Incremental syncs**: Uses `last_sync_timestamp` (only new/updated tickets)
- Rate limited to 10 requests/minute (Zendesk Incremental API limit)

### Analysis Behavior
- Always uses `ANALYSIS_WINDOW_DAYS` (30 days)
- Queries `enriched_support_conversations` for last 30 days
- Sends to Claude AI for top 10 issues analysis

### Data Flow
```
┌─────────────────────────────────────────────────────┐
│ sync-support-conversations                          │
│ ├─ First run: last 60 days (ANALYSIS_LOOKBACK_DAYS)│
│ └─ Future runs: incremental since last_sync         │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│ raw_support_conversations                           │
│ (All tickets from last 60 days stored)              │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│ enriched_support_conversations                      │
│ (Materialized view with user data joined)           │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│ analyze-support-feedback                            │
│ └─ Analyzes last 30 days (ANALYSIS_WINDOW_DAYS)    │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│ support_analysis_results                            │
│ (Top 10 issues stored)                              │
└─────────────────────────────────────────────────────┘
```

## Verification

Check that backfill worked:

```sql
-- Verify ticket count by date
SELECT
  DATE(created_at) as date,
  COUNT(*) as ticket_count,
  source
FROM raw_support_conversations
GROUP BY DATE(created_at), source
ORDER BY date DESC
LIMIT 30;

-- Check sync status
SELECT * FROM support_sync_status WHERE source = 'zendesk';

-- Check analysis results
SELECT
  week_start_date,
  conversation_count,
  analysis_cost,
  created_at
FROM support_analysis_results
ORDER BY created_at DESC
LIMIT 5;
```

## Ongoing Maintenance

- **Daily/Weekly syncs**: Incremental, only fetches new tickets
- **Analysis**: Runs weekly (via cron), analyzes last 30 days
- **Storage**: 60 days of tickets stored, old data can be archived/deleted if needed

## Troubleshooting

**Issue: Not seeing 60 days of data**
- Check `support_sync_status.last_sync_timestamp` - should be 60 days ago
- Check function logs for rate limiting (429 errors)
- Verify `ANALYSIS_LOOKBACK_DAYS=60` is set

**Issue: Analysis only shows recent data**
- Check `ANALYSIS_WINDOW_DAYS` environment variable
- Verify `enriched_support_conversations` materialized view is refreshed
- Check analysis logs for date range

**Issue: Function timeout during backfill**
- This is expected for large backlogs (1000+ tickets)
- Data is stored incrementally in batches, so partial progress is saved
- Re-run the function to continue where it left off
