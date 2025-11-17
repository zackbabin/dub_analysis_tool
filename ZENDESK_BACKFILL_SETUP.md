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

### Step 4: Trigger Backfill

Trigger the sync manually to pull 60 days of data:

```bash
# Option A: Via curl
curl -X POST \
  https://your-project-ref.supabase.co/functions/v1/sync-support-conversations \
  -H "Authorization: Bearer YOUR_ANON_KEY"

# Option B: Via Supabase Dashboard
# Edge Functions → sync-support-conversations → Invoke
```

This will:
- Fetch all Zendesk tickets from the last 60 days
- Store them in `raw_support_conversations`
- Update `last_sync_timestamp` to current time
- Future syncs will be incremental from this point

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
