# Migrations to Run - Fix 404 Errors

## Problem
After rollback and recent changes, several views need to be recreated in the database. The UI is getting 404 errors because these views don't exist yet.

## 404 Errors in Browser Console

```
❌ premium_creator_summary_stats?select=* → 404
❌ premium_creator_top_5_stocks?select=*&order=total_copies.desc → 404
```

## Migrations to Run (IN ORDER)

Run these migrations in your Supabase dashboard SQL editor:

### 1. `restore_all_premium_creator_views.sql`
**Purpose:** Restore all premium creator views after Chart 86055000 rollback

**What it does:**
- Drops and recreates `premium_creator_breakdown` (materialized view)
- Drops and recreates `premium_creator_summary_stats` (view) ✅ Fixes 404
- Drops and recreates `premium_creator_top_5_stocks` (view)
- Drops and recreates `premium_creator_affinity` views (base + display)

**Important:** This is the base restoration - must run first

---

### 2. `add_total_copies_to_premium_creator_top_5_stocks.sql`
**Purpose:** Add total_copies column to premium_creator_top_5_stocks for sorting

**What it does:**
- Drops `premium_creator_top_5_stocks` view
- Recreates with `total_copies` column (joins with premium_creator_breakdown) ✅ Fixes 404
- Enables sorting by engagement in UI

**Why needed:** UI code sorts by `total_copies` but the restored view didn't have this column

---

### 3. `fix_premium_creator_breakdown_group_by.sql`
**Purpose:** Ensure all premium creators appear in breakdown (refresh materialized view)

**What it does:**
- Drops and recreates `premium_creator_breakdown` (materialized view)
- Adds explicit `REFRESH MATERIALIZED VIEW` command
- Ensures all creators from `premium_creators` table are included

**Why needed:** Materialized views are snapshots - must be refreshed to show new data

---

## Verification After Running Migrations

Run these queries to verify views exist:

```sql
-- Check if views exist
SELECT table_name, table_type
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN (
  'premium_creator_summary_stats',
  'premium_creator_top_5_stocks',
  'premium_creator_breakdown',
  'premium_creator_affinity_display'
);

-- Check row counts
SELECT 'premium_creator_breakdown' as view_name, COUNT(*) as rows FROM premium_creator_breakdown
UNION ALL
SELECT 'premium_creator_summary_stats', COUNT(*) FROM premium_creator_summary_stats
UNION ALL
SELECT 'premium_creator_top_5_stocks', COUNT(*) FROM premium_creator_top_5_stocks;
```

Expected results:
- `premium_creator_breakdown`: 20 rows (one per premium creator)
- `premium_creator_summary_stats`: 1 row (summary stats)
- `premium_creator_top_5_stocks`: 20 rows (one per premium creator)

---

## What Gets Fixed

### ✅ Metric Cards (4 cards at top)
- Pulls from `premium_creator_summary_stats` view
- Shows: Avg Copy CVR, Avg Subscription CVR, Median Performance, Median Copy Capital

### ✅ Portfolio Assets Breakdown
- Pulls from `premium_creator_top_5_stocks` view
- Shows: Top 5 stocks per creator, sorted by total_copies

### ✅ Premium Creator Breakdown Table
- Pulls from `premium_creator_breakdown` materialized view
- Shows: All 20 premium creators with engagement metrics

### ✅ Premium Creator Copy Affinity Table
- Depends on `premium_creator_affinity_display` view
- Shows: Which creators are copied together

---

## Future Syncs

After running these migrations once, future data syncs will work automatically:

1. User clicks "Sync Live Data"
2. `sync-mixpanel-engagement` fetches and upserts data
3. `refresh-engagement-views` triggers in background
4. `refresh_portfolio_engagement_views()` RPC refreshes materialized views
5. Regular views auto-update (depend on materialized views)

---

## Cache Busting

Version has been bumped to v10 in:
- `index.html`: `creator_analysis_tool_supabase.js?v=10`
- `version-checker.js`: `CURRENT_VERSION = '2025-11-11-02'`

This ensures users get the latest tooltip changes and fixes after hard refresh.
