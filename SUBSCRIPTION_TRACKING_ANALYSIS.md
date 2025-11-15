# Subscription Tracking Analysis

## Issue #1: SubscriptionCreated Event Tracking

### Current Status: ✅ CORRECTLY IMPLEMENTED

**Finding**: `SubscriptionCreated` is already being tracked correctly in the events sync.

**Data Flow**:
1. **Source**: Mixpanel Export API (`sync-mixpanel-user-events`)
2. **Event**: `SubscriptionCreated`
3. **Processing**: `supabase/functions/_shared/mixpanel-events-processor.ts:220-222`
   ```typescript
   case 'SubscriptionCreated':
     metrics.total_subscriptions!++
     break
   ```
4. **Storage**: `subscribers_insights.total_subscriptions`
5. **View**: `subscription_engagement_summary` (aggregates from `main_analysis` → `subscribers_insights`)

**Verification**:
- Event is listed in `TRACKED_EVENTS` array (line 26)
- Event processor increments `total_subscriptions` counter
- Database column exists in `subscribers_insights` table

---

## Issue #2: Premium Creator Subscription Discrepancy

### Problem: Different Data Sources

**Premium Creator Breakdown** and **Premium Creator Retention** show different subscription counts because they use **two completely different data sources**:

### Data Source 1: Premium Creator Breakdown
- **Source**: `premium_creator_metrics` table
- **Populated by**: `sync-creator-data` Edge Function
- **Mixpanel Chart**: 85821646 (Creator-level subscription metrics from Insights API)
- **SQL**:
  ```sql
  SELECT MAX(pcm.total_subscriptions) AS total_subscriptions
  FROM premium_creators pc
  LEFT JOIN premium_creator_metrics pcm ON pc.creator_id = pcm.creator_id
  GROUP BY pc.creator_username
  ```
- **View**: `premium_creator_breakdown` (line 29-35 in convert_premium_creator_breakdown_to_regular_view.sql)

### Data Source 2: Premium Creator Retention
- **Source**: `premium_creator_retention_events` table
- **Populated by**: `fetch-creator-retention` Edge Function
- **Mixpanel Chart**: 85857452 (Cohort-based subscription/renewal tracking)
- **SQL**:
  ```sql
  SELECT COUNT(DISTINCT distinct_id) as initial_subscribers
  FROM premium_creator_retention_events
  WHERE subscribed_count > 0
  GROUP BY creator_username, cohort_month, cohort_date
  ```
- **View**: `premium_creator_retention_analysis` (sums all cohort first counts)

### Why They're Different

| Aspect | Premium Creator Breakdown | Premium Creator Retention |
|--------|---------------------------|---------------------------|
| **Aggregation** | Creator-level total from Insights | User-creator-cohort level from Chart 85857452 |
| **Grouping** | All-time total per creator | Per cohort month per creator |
| **Deduplication** | Uses MAX across creator_ids | Uses COUNT(DISTINCT distinct_id) per cohort |
| **Time Scope** | Cumulative all-time | Broken down by subscription month |

### Root Cause
The two charts in Mixpanel (85821646 vs 85857452) may be using:
- Different event definitions
- Different time windows
- Different user filtering logic
- Different handling of subscription renewals vs new subscriptions

---

## Recommended Fix

### Option 1: Use Single Source of Truth (Recommended)
**Make both views use the same underlying data source.**

**Recommended**: Use `premium_creator_metrics` (Chart 85821646) as the single source because:
- It's simpler (creator-level aggregation)
- Already used for Premium Creator Breakdown
- More performant (fewer joins)

**Changes Required**:
1. Update `premium_creator_retention_events` to derive from `premium_creator_metrics` instead of Chart 85857452
2. OR: Create a reconciliation layer that ensures both sources match

### Option 2: Document the Discrepancy
If the different metrics serve different purposes:
- Breakdown shows "Total Lifetime Subscriptions"
- Retention shows "Cohort-Based Initial Subscriptions"

Add clear labels in the UI to explain the difference.

### Option 3: Cross-Validation Query
Add a diagnostic query to check discrepancies:
```sql
SELECT
  pcb.creator_username,
  pcb.total_subscriptions as breakdown_total,
  SUM(pcra.first) as retention_total,
  pcb.total_subscriptions - SUM(pcra.first) as discrepancy
FROM premium_creator_breakdown pcb
LEFT JOIN premium_creator_retention_analysis pcra
  ON pcb.creator_username = pcra.creator_username
GROUP BY pcb.creator_username, pcb.total_subscriptions
HAVING pcb.total_subscriptions != SUM(pcra.first)
ORDER BY ABS(pcb.total_subscriptions - SUM(pcra.first)) DESC;
```

---

## Next Steps

1. **Verify Chart Configuration** in Mixpanel:
   - Chart 85821646: How does it calculate total_subscriptions?
   - Chart 85857452: How does it track cohort subscriptions?

2. **Choose Fix Approach**:
   - Align on single source of truth
   - Or document why they should differ

3. **Test After Fix**:
   - Run both sync functions
   - Compare counts
   - Verify UI displays match expected behavior
