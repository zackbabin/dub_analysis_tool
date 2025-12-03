# Subscription Count Discrepancy Analysis

## Problem
@dubAdvisors shows different total subscription counts in different sections:
- **Premium Creator Breakdown**: 391 subscriptions (CORRECT)
- **Premium Creator Retention**: 410 subscriptions (INCORRECT - 19 extra)

## Root Cause Analysis

### Premium Creator Breakdown (391 - CORRECT)
**Data Source**: `premium_creator_breakdown` view
**Query Path**:
1. Uses `premium_creator_metrics` table
2. Populated by `sync-creator-data` edge function
3. Sources from **Mixpanel Chart 85821646**: "Premium Creator Subscription Metrics"
4. Aggregation: `MAX(pcm.total_subscriptions)` per creator_username

**Why MAX()?** The `premium_creator_metrics` table keeps historical records with `UNIQUE(creator_id, synced_at)`. Each sync creates a new row. The view uses `MAX()` to get the most recent value.

**SQL (from 20251127_fix_premium_creator_breakdown_aggregation.sql)**:
```sql
subscription_by_username AS (
    SELECT pc.creator_username,
        MAX(pcm.total_subscriptions) AS total_subscriptions,
        MAX(pcm.total_paywall_views) AS total_paywall_views,
        MAX(pcm.total_cancellations) AS total_cancellations
    FROM premium_creators pc
    LEFT JOIN premium_creator_metrics pcm
        ON pc.creator_id = pcm.creator_id
    GROUP BY pc.creator_username
)
```

### Premium Creator Retention (410 - INCORRECT)
**Data Source**: `premium_creator_retention_analysis` materialized view
**Query Path**:
1. Uses `premium_creator_retention_events` table
2. Populated by `fetch-creator-retention` edge function
3. Sources from **Mixpanel Chart 85857452**: "Total Subscriptions (net refunds)" - **DIFFERENT CHART**
4. Aggregation: Sums `COUNT(DISTINCT distinct_id)` per cohort for each creator_username

**SQL (from fix_premium_creator_retention_analysis.sql)**:
```sql
WITH cohort_subscribers AS (
    -- Get all users who subscribed in each creator/cohort combination
    SELECT
        creator_username,
        cohort_month,
        cohort_date,
        distinct_id,
        subscribed_count
    FROM premium_creator_retention_events
    WHERE subscribed_count > 0
),
cohort_summary AS (
    -- Count total subscribers per creator/cohort
    SELECT
        creator_username,
        cohort_month,
        cohort_date,
        COUNT(DISTINCT distinct_id) as initial_subscribers  -- "first" column
    FROM cohort_subscribers
    GROUP BY creator_username, cohort_month, cohort_date
)
```

**How UI Calculates Total:** The UI sums the "first" column across all cohorts for each creator.

## Issue Identified: Different Data Sources

The two sections use **completely different Mixpanel charts**:

| Section | Chart ID | Chart Name | Metric Type |
|---------|----------|------------|-------------|
| Premium Creator Breakdown | 85821646 | Premium Creator Subscription Metrics | Creator-level aggregates |
| Premium Creator Retention | 85857452 | Total Subscriptions (net refunds) | User-level events by cohort |

### Why Chart 85857452 Shows 410 Instead of 391

Chart 85857452 returns user-level subscription events grouped by cohort month. When the same user subscribes in multiple cohorts (e.g., resubscribes after canceling), they appear multiple times:

**Example for @dubAdvisors:**
```
user_123 | @dubAdvisors | Aug 2024 | subscribed_count: 1
user_123 | @dubAdvisors | Oct 2024 | subscribed_count: 1  <- DUPLICATE USER
user_456 | @dubAdvisors | Sep 2024 | subscribed_count: 1
...
```

The retention analysis counts:
- **Aug 2024 cohort**: user_123 counted
- **Oct 2024 cohort**: user_123 counted again
- **Sep 2024 cohort**: user_456 counted

**Total: 391 unique users + 19 duplicate entries across cohorts = 410**

### Why Chart 85821646 Shows 391 (Correct)

Chart 85821646 returns creator-level aggregates that already deduplicate users:
```
@dubAdvisors | total_subscriptions: 391
```

This chart counts each user only once regardless of how many times they subscribed.

## Question 1 Answer: Why Duplicate Creators in premium_creator_metrics?

The table has `UNIQUE(creator_id, synced_at)` constraint. This is **intentional** to keep historical records:
- Each sync creates a new row with current timestamp
- Change detection skips unchanged creators (line 168-188 in sync-creator-data/index.ts)
- The view uses `MAX(total_subscriptions)` to get most recent value
- This allows tracking metrics over time while avoiding unnecessary writes

## Solution Options

### Option 1: Replace Chart 85857452 with Chart 85821646 for Total Count ✅ RECOMMENDED
Modify `premium_creator_retention_analysis` to use `premium_creator_metrics` for the total unique subscribers count, while keeping Chart 85857452 for cohort-level retention tracking.

**Pros:**
- Consistent data source across all sections
- Correct deduplication of users
- Maintains cohort-level retention analysis

**Implementation:**
```sql
-- Add a LEFT JOIN to premium_creator_metrics to get total_subscriptions
-- Use this for display total instead of summing cohort "first" values
```

### Option 2: Deduplicate Users in Chart 85857452 Data
Count distinct users across all cohorts instead of summing cohort-level counts.

**Pros:**
- Single data source
- Preserves user-level cohort data

**Cons:**
- Loses information about which cohort a user first subscribed in
- May not match breakdown if charts filter differently

### Option 3: Document Discrepancy and Use Chart 85821646 for Both
Update retention display to show "Total Subscribers: 391 (from Breakdown)" and keep cohort breakdown separate.

## Recommended Fix: Option 1

1. Add `total_unique_subscribers` to `premium_creator_retention_analysis` by joining with `premium_creator_metrics`
2. Update UI to display this value instead of summing cohort "first" values
3. Keep cohort-level retention percentages unchanged

## Files to Modify
1. `supabase/migrations/fix_premium_creator_retention_analysis.sql` - Add JOIN to premium_creator_metrics
2. `creator_analysis_tool_supabase.js` - Update UI to use new column for totals display
