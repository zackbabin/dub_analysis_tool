# Investigation: sync-mixpanel-users Data Flow and Schema Compatibility

## Current Data Flow

### sync-mixpanel-users (Insights API)
```
1. Fetch from Mixpanel Insights API
   - Chart ID: 85713544 (Subscribers Insights)
   - Timeout: 140s (still timing out)
   - Returns: Nested aggregated data structure

2. Store raw Insights response in Storage
   - Bucket: mixpanel-raw-data
   - Filename: subscribers-{timestamp}.json

3. Trigger process-subscribers-data
```

### process-subscribers-data
```
1. Download from Storage

2. Parse Insights data (complex recursive traversal)
   - Extract user_id from nested structure
   - Extract user properties (income, netWorth, etc.)
   - Extract metrics (A-S labeled metrics)

3. Map to database columns (33 fields):
   - distinct_id
   - User properties: income, net_worth, investing_activity, etc.
   - Metrics with labels:
     * A. Linked Bank Account
     * B. Total Deposits ($)
     * C. Total Deposit Count
     * D. Total Copies
     * E. Total Regular Copies
     * F. Total Premium Copies
     * G. Regular PDP Views
     * H. Premium PDP Views
     * I. Paywall Views
     * J. Regular Creator Profile Views
     * K. Premium Creator Profile Views
     * L. Total Subscriptions
     * M. App Sessions
     * N. Discover Tab Views
     * O. Leaderboard Tab Views
     * P. Premium Tab Views
     * Q. Stripe Modal Views
     * R. Creator Card Taps
     * S. Portfolio Card Taps

4. Upsert to subscribers_insights table
   - Conflict key: distinct_id
   - Update existing records
```

## Database Schema: subscribers_insights

Based on the processing code (lines 317-352), the table has **33 columns**:

### Core Fields
- `distinct_id` (PRIMARY KEY)
- `updated_at` (timestamp)

### User Profile Properties (6 fields)
- `income` (text/enum)
- `net_worth` (text/enum)
- `investing_activity` (text/enum)
- `investing_experience_years` (int)
- `investing_objective` (text/enum)
- `investment_type` (text/enum)
- `acquisition_survey` (text)

### Account Status (3 fields)
- `linked_bank_account` (boolean)
- `available_copy_credits` (numeric)
- `buying_power` (numeric)

### Financial Activity (4 fields)
- `total_deposits` (numeric)
- `total_deposit_count` (int)
- `total_withdrawals` (numeric)
- `total_withdrawal_count` (int)

### Portfolio Activity (2 fields)
- `active_created_portfolios` (int)
- `lifetime_created_portfolios` (int)

### Copy Activity (3 fields)
- `total_copies` (int)
- `total_regular_copies` (int)
- `total_premium_copies` (int)

### Engagement Metrics (11 fields)
- `regular_pdp_views` (int)
- `premium_pdp_views` (int)
- `paywall_views` (int)
- `regular_creator_profile_views` (int)
- `premium_creator_profile_views` (int)
- `stripe_modal_views` (int)
- `app_sessions` (int)
- `discover_tab_views` (int)
- `leaderboard_tab_views` (int)
- `premium_tab_views` (int)
- `total_subscriptions` (int)

### Taps/Interactions (2 fields)
- `creator_card_taps` (int)
- `portfolio_card_taps` (int)

## Event Export API Comparison

### What Event Export Returns
```json
{
  "event": "Signed up",
  "properties": {
    "time": 1602611311,
    "$insert_id": "hpuDqcvpltpCjBsebtxwadtEBDnFAdycabFb",
    "mp_processing_time_ms": 1602625711874,
    "$distinct_id": "user123",
    // User properties (varies by event and user)
    "income": "50000-100000",
    "netWorth": "100000-500000",
    // Event-specific properties
    ...
  }
}
```

### Key Differences

| Aspect | Insights API | Event Export API |
|--------|-------------|------------------|
| **Data Type** | Pre-aggregated metrics | Raw individual events |
| **User Properties** | Included in aggregation | Included in event properties |
| **Metrics (A-S)** | Computed server-side (counts, sums) | Must compute client-side from events |
| **Structure** | Nested by user → property → metric | Flat NDJSON (one event per line) |
| **Performance** | Slow (140s+ timeout) | Fast (~10-30s) |

## Migration Challenges

### Challenge 1: Aggregated Metrics
**Problem**: Insights API returns pre-computed aggregates like "D. Total Copies". Event Export returns individual copy events.

**Solution Options**:
1. **Count events client-side**: Group events by distinct_id and event type, count occurrences
2. **Use event properties**: Some metrics might be stored as properties (e.g., `total_copies` property)
3. **Hybrid approach**: Fetch user properties from Events, keep Insights for metrics

### Challenge 2: Labeled Metrics (A-S)
**Problem**: Processing code expects specific labels like "A. Linked Bank Account", "B. Total Deposits ($)"

**Solution**: These are Insights chart column names. With Event Export, we'd need to:
- Map event names → metric fields
- Aggregate event counts → metrics
- Extract cumulative properties (deposits, withdrawals) from event properties

### Challenge 3: User Properties
**Problem**: Are user properties consistently present in all events?

**Solution**: Extract user properties from events and take most recent non-null value per user.

## Recommendation

### Option A: Fix Insights API Timeout (SIMPLEST)
**Approach**: Optimize the Subscribers Insights chart in Mixpanel
- Reduce date range (e.g., last 90 days instead of all-time)
- Remove unused breakdowns/filters
- Simplify metrics

**Pros**: No code changes, maintains exact functionality
**Cons**: May still timeout if dataset grows

### Option B: Hybrid Approach (BALANCED)
**Approach**: Use Event Export for user properties, keep existing logic for metrics
- Fetch events with user properties
- Extract most recent property values per user
- Keep Insights API for aggregated metrics (or compute from events)

**Pros**: Faster user property fetching, maintains metric accuracy
**Cons**: Still need to solve metric aggregation

### Option C: Full Event Export Migration (COMPLEX)
**Approach**: Replace Insights API entirely with Event Export
- Fetch all relevant events
- Group by distinct_id
- Compute all 22 metrics client-side
- Extract user properties

**Pros**: No more timeout issues, full control
**Cons**: Significant code changes, risk of metric calculation errors

## Questions to Answer Before Proceeding

1. **What's in the Subscribers Insights chart?**
   - What date range is configured?
   - What breakdowns/filters are applied?
   - Can it be optimized?

2. **Are metrics computed or stored?**
   - Does "D. Total Copies" come from event counts or a user property?
   - Are metrics cumulative (all-time) or time-bound?

3. **Which user properties are critical?**
   - income, netWorth, etc. - where do these come from?
   - Are they set once or updated over time?

4. **What's the acceptable solution complexity?**
   - Quick fix (optimize chart) vs. full rewrite (Event Export)?

## Next Steps

1. **Inspect Subscribers Insights chart in Mixpanel UI**
   - Check date range, filters, breakdowns
   - Identify optimization opportunities

2. **Test Event Export sample**
   - Fetch 1 day of events
   - Check if user properties are present
   - Verify which events contain which properties

3. **Decision**: Choose Option A, B, or C based on findings
