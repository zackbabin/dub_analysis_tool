# Plan: Parallel Export API Implementation for sync-mixpanel-users

## Goal
Test Event Export API approach alongside existing Insights API without disrupting current functionality.

## Key Differences from Current Approach

### Current (Insights API)
- Metrics are **pre-aggregated** by Mixpanel (e.g., "D. Total Copies" column)
- User properties included in aggregation
- Timeout: 140s+

### New (Event Export API)
- Metrics must be **counted from events** (e.g., count "DubAutoCopyInitiated" events)
- User properties included in each event
- Fast: ~10-30s
- Event names != column names (need smart mapping)

## Event Name → Column Mapping

Based on your example and the 12 events from cURL:

| Column | Event Name(s) | Logic |
|--------|--------------|-------|
| `linked_bank_account` | `BankAccountLinked` | Has event? → true |
| `total_deposits` | `AchTransferInitiated` | Count events (if deposit) |
| `total_copies` | `DubAutoCopyInitiated` | Count events |
| `regular_pdp_views` | `Viewed Portfolio Details` | Count events (filter by creator type?) |
| `premium_pdp_views` | `Viewed Portfolio Details` | Count events (filter by creator type?) |
| `paywall_views` | `Viewed Creator Paywall` | Count events |
| `premium_creator_profile_views` | `Viewed Creator Profile` | Count events (filter by premium?) |
| `regular_creator_profile_views` | `Viewed Creator Profile` | Count events (filter by regular?) |
| `stripe_modal_views` | `Viewed Stripe Modal` | Count events |
| `app_sessions` | `$ae_session` | Count events |
| `discover_tab_views` | `Viewed Discover Tab` | Count events |
| `creator_card_taps` | `Tapped Creator Card` | Count events |
| `portfolio_card_taps` | `Tapped Portfolio Card` | Count events |
| `total_subscriptions` | `SubscriptionCreated` | Count events |

**Note**: Some columns may not have matching events - leave NULL/0.

## Parallel Implementation Architecture

### Step 1: New Database Table
Create `subscribers_insights_v2` (identical schema to `subscribers_insights`)

```sql
-- Migration: create_subscribers_insights_v2.sql
CREATE TABLE subscribers_insights_v2 (
  distinct_id TEXT PRIMARY KEY,
  -- User properties (from event properties)
  income TEXT,
  net_worth TEXT,
  investing_activity TEXT,
  investing_experience_years INT,
  investing_objective TEXT,
  investment_type TEXT,
  acquisition_survey TEXT,
  -- Account properties (from event properties)
  linked_bank_account BOOLEAN DEFAULT FALSE,
  available_copy_credits NUMERIC DEFAULT 0,
  buying_power NUMERIC DEFAULT 0,
  -- Metrics (from event counts)
  total_deposits NUMERIC DEFAULT 0,
  total_deposit_count INT DEFAULT 0,
  total_withdrawals NUMERIC DEFAULT 0,
  total_withdrawal_count INT DEFAULT 0,
  active_created_portfolios INT DEFAULT 0,
  lifetime_created_portfolios INT DEFAULT 0,
  total_copies INT DEFAULT 0,
  total_regular_copies INT DEFAULT 0,
  total_premium_copies INT DEFAULT 0,
  regular_pdp_views INT DEFAULT 0,
  premium_pdp_views INT DEFAULT 0,
  paywall_views INT DEFAULT 0,
  regular_creator_profile_views INT DEFAULT 0,
  premium_creator_profile_views INT DEFAULT 0,
  stripe_modal_views INT DEFAULT 0,
  app_sessions INT DEFAULT 0,
  discover_tab_views INT DEFAULT 0,
  leaderboard_tab_views INT DEFAULT 0,
  premium_tab_views INT DEFAULT 0,
  creator_card_taps INT DEFAULT 0,
  portfolio_card_taps INT DEFAULT 0,
  total_subscriptions INT DEFAULT 0,
  -- Metadata
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  data_source TEXT DEFAULT 'export_api' -- Track which API populated this
);

CREATE INDEX idx_subscribers_v2_distinct_id ON subscribers_insights_v2(distinct_id);
CREATE INDEX idx_subscribers_v2_total_subscriptions ON subscribers_insights_v2(total_subscriptions) WHERE total_subscriptions > 0;

GRANT SELECT ON subscribers_insights_v2 TO anon, authenticated;

COMMENT ON TABLE subscribers_insights_v2 IS 'Test table for Event Export API approach. Identical schema to subscribers_insights but populated from raw events instead of Insights API.';
```

### Step 2: New Edge Functions

Create new functions alongside existing ones:

```
supabase/functions/
├── sync-mixpanel-users/          # Existing (Insights API)
│   └── index.ts
├── sync-mixpanel-users-v2/       # NEW (Export API)
│   └── index.ts
├── process-subscribers-data/     # Existing
│   └── index.ts
└── process-subscribers-data-v2/  # NEW (Event counting)
    └── index.ts
```

### Step 3: New Shared Module

Create event processing utilities:

```
supabase/functions/_shared/
├── mixpanel-api.ts                    # Existing (Insights API)
└── mixpanel-events-processor.ts       # NEW (Event counting + mapping)
```

## Implementation Details

### sync-mixpanel-users-v2/index.ts

```typescript
// Fetch events from Export API
const events = await fetchEventsExport(credentials, {
  fromDate: '2025-01-01',
  toDate: new Date().toISOString().split('T')[0],
  events: [
    'Viewed Portfolio Details',
    'Viewed Creator Profile',
    'BankAccountLinked',
    'AchTransferInitiated',
    'DubAutoCopyInitiated',
    'Viewed Creator Paywall',
    'SubscriptionCreated',
    '$ae_session',
    'Viewed Discover Tab',
    'Viewed Stripe Modal',
    'Tapped Creator Card',
    'Tapped Portfolio Card',
  ]
})

// Store raw events in Storage
const filename = `subscribers-v2-${timestamp}.json`
await supabase.storage.from('mixpanel-raw-data').upload(filename, JSON.stringify({
  events,
  syncStartTime,
  fetchedAt: new Date().toISOString()
}))

// Trigger processing
fetch(`${supabaseUrl}/functions/v1/process-subscribers-data-v2`, {
  body: JSON.stringify({ filename })
})
```

### process-subscribers-data-v2/index.ts

```typescript
// Download events from storage
const { events } = JSON.parse(rawData)

// Process events into user profiles
const userProfiles = processEventsToUserProfiles(events)

// Batch upsert to subscribers_insights_v2
for (const batch of batches) {
  await supabase
    .from('subscribers_insights_v2')
    .upsert(batch, { onConflict: 'distinct_id' })
}
```

### _shared/mixpanel-events-processor.ts

```typescript
/**
 * Process raw Mixpanel events into user profiles for subscribers_insights_v2
 */
export function processEventsToUserProfiles(events: MixpanelEvent[]): UserProfile[] {
  // Group events by distinct_id
  const userEventsMap = new Map<string, MixpanelEvent[]>()

  for (const event of events) {
    const distinctId = event.properties.$distinct_id
    if (!distinctId) continue

    if (!userEventsMap.has(distinctId)) {
      userEventsMap.set(distinctId, [])
    }
    userEventsMap.get(distinctId)!.push(event)
  }

  // Process each user's events
  const profiles: UserProfile[] = []

  for (const [distinctId, userEvents] of userEventsMap) {
    const profile = {
      distinct_id: distinctId,

      // Extract user properties (take most recent non-null value)
      ...extractUserProperties(userEvents),

      // Count events for metrics
      ...countEventMetrics(userEvents),
    }

    profiles.push(profile)
  }

  return profiles
}

function extractUserProperties(events: MixpanelEvent[]): UserProperties {
  // Sort by time descending (most recent first)
  const sortedEvents = [...events].sort((a, b) => b.properties.time - a.properties.time)

  const properties: UserProperties = {}

  // Take most recent non-null value for each property
  for (const event of sortedEvents) {
    if (!properties.income && event.properties.income) {
      properties.income = event.properties.income
    }
    if (!properties.net_worth && event.properties.netWorth) {
      properties.net_worth = event.properties.netWorth
    }
    // ... repeat for all user property fields
  }

  return properties
}

function countEventMetrics(events: MixpanelEvent[]): EventMetrics {
  const metrics: EventMetrics = {
    linked_bank_account: false,
    total_copies: 0,
    paywall_views: 0,
    app_sessions: 0,
    discover_tab_views: 0,
    creator_card_taps: 0,
    portfolio_card_taps: 0,
    total_subscriptions: 0,
    stripe_modal_views: 0,
    // Initialize all metric fields to 0
  }

  // Count events
  for (const event of events) {
    switch (event.event) {
      case 'BankAccountLinked':
        metrics.linked_bank_account = true
        break
      case 'DubAutoCopyInitiated':
        metrics.total_copies++
        break
      case 'Viewed Creator Paywall':
        metrics.paywall_views++
        break
      case '$ae_session':
        metrics.app_sessions++
        break
      case 'Viewed Discover Tab':
        metrics.discover_tab_views++
        break
      case 'Tapped Creator Card':
        metrics.creator_card_taps++
        break
      case 'Tapped Portfolio Card':
        metrics.portfolio_card_taps++
        break
      case 'SubscriptionCreated':
        metrics.total_subscriptions++
        break
      case 'Viewed Stripe Modal':
        metrics.stripe_modal_views++
        break
      case 'Viewed Creator Profile':
        // Need to determine if premium or regular from event properties
        if (event.properties.creator_type === 'premium' || event.properties.is_premium) {
          metrics.premium_creator_profile_views++
        } else {
          metrics.regular_creator_profile_views++
        }
        break
      case 'Viewed Portfolio Details':
        // Need to determine if premium or regular
        if (event.properties.creator_type === 'premium' || event.properties.is_premium) {
          metrics.premium_pdp_views++
        } else {
          metrics.regular_pdp_views++
        }
        break
      // Add other event mappings as needed
    }
  }

  return metrics
}
```

## Testing Strategy

### Phase 1: Create Parallel Infrastructure (No Impact)
1. Create `subscribers_insights_v2` table
2. Create `sync-mixpanel-users-v2` function
3. Create `process-subscribers-data-v2` function
4. Create `mixpanel-events-processor.ts` module

### Phase 2: Test New Approach
1. Manually trigger `sync-mixpanel-users-v2`
2. Monitor logs for:
   - Fetch time (should be <60s)
   - Number of events fetched
   - Number of users processed
3. Verify data in `subscribers_insights_v2`

### Phase 3: Compare Results
```sql
-- Compare user counts
SELECT
  (SELECT COUNT(*) FROM subscribers_insights) as old_count,
  (SELECT COUNT(*) FROM subscribers_insights_v2) as new_count;

-- Compare specific users
SELECT
  old.distinct_id,
  old.total_copies as old_copies,
  new.total_copies as new_copies,
  old.total_subscriptions as old_subs,
  new.total_subscriptions as new_subs,
  old.app_sessions as old_sessions,
  new.app_sessions as new_sessions
FROM subscribers_insights old
FULL OUTER JOIN subscribers_insights_v2 new ON old.distinct_id = new.distinct_id
WHERE old.total_copies != new.total_copies
   OR old.total_subscriptions != new.total_subscriptions
ORDER BY old.total_copies DESC NULLS LAST
LIMIT 20;

-- Check for missing users
SELECT distinct_id, 'missing_in_v2' as status
FROM subscribers_insights
WHERE distinct_id NOT IN (SELECT distinct_id FROM subscribers_insights_v2)
UNION ALL
SELECT distinct_id, 'missing_in_v1' as status
FROM subscribers_insights_v2
WHERE distinct_id NOT IN (SELECT distinct_id FROM subscribers_insights);
```

### Phase 4: Decision
Based on comparison:
- **If results match**: Migrate to v2, deprecate v1
- **If discrepancies**: Debug event mapping, adjust logic
- **If performance issues**: Optimize or rollback

## Migration Checklist

- [ ] Create `subscribers_insights_v2` table
- [ ] Create `mixpanel-events-processor.ts` module
- [ ] Create `sync-mixpanel-users-v2` function
- [ ] Create `process-subscribers-data-v2` function
- [ ] Test v2 sync manually
- [ ] Compare v1 vs v2 data
- [ ] Identify and fix discrepancies
- [ ] Document event mapping completeness
- [ ] Get approval for cutover
- [ ] Update UI to use v2 (if needed)
- [ ] Deprecate v1 functions
- [ ] Drop `subscribers_insights` table (after backup)

## Open Questions

1. **Event property names**: What are the exact property names in events?
   - Is it `creator_type`, `is_premium`, or something else?
   - Do we need to fetch a sample to see actual structure?

2. **Missing metrics**: Which columns won't have events?
   - `total_deposits`, `total_withdrawals` (financial data)
   - `available_copy_credits`, `buying_power` (account data)
   - These might need to remain NULL or come from different source

3. **Date range**: Should we fetch all-time or recent data?
   - All-time: More complete but slower
   - Recent (e.g., last 90 days): Faster but incomplete

4. **Event filtering**: Do we need to filter events?
   - Premium vs Regular creators
   - Deposit vs Withdrawal transactions
   - How to identify from event properties?

## Rollback Plan

If v2 doesn't work:
1. Keep using v1 (no impact since parallel)
2. Drop `subscribers_insights_v2` table
3. Delete v2 functions
4. Return to optimizing Insights API timeout
