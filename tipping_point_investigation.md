# Tipping Point Investigation for Subscription Drivers

## Current State

### Tipping Point Column Status
- **Deposit Drivers**: ✅ Has tipping point column in display (line 3189-3192)
- **Copy Drivers**: ✅ Has tipping point column in display (line 3313-3316)
- **Subscription Drivers**: ❌ Missing tipping point column in display (line 3020-3026)

### Tipping Point Calculation Logic
Location: `supabase/functions/analyze-behavioral-drivers/index.ts:177-220`

```typescript
function calculateTippingPoint(
  data: MainAnalysisRow[],
  variable: string,
  outcomeField: string
): string | null
```

**Algorithm Steps:**
1. Group users by floored variable value: `Math.floor(Number(row[variable]))`
2. Calculate conversion rate for each group: `converted / total`
3. **Filter groups with strict criteria:**
   - Minimum 10 users in group: `stats.total >= 10`
   - Conversion rate > 10%: `(stats.converted / stats.total) > 0.10`
4. Find largest jump in conversion rate between consecutive groups
5. Return the value where the jump occurs

## Potential Issues Causing Null Tipping Points

### Issue 1: Strict Group Size Requirement (≥10 users)
**Problem:** When variable values have wide distribution, many groups may have <10 users.

**Example Scenario:**
```
Variable: premium_pdp_views
Value 0: 5,000 users (✅ passes)
Value 1: 200 users (✅ passes)
Value 2: 50 users (✅ passes)
Value 3: 8 users (❌ filtered out)
Value 4: 3 users (❌ filtered out)
Value 5: 2 users (❌ filtered out)
```

If only values 0-2 pass the filter, we need at least one more group to calculate a jump.

### Issue 2: Low Conversion Rates (>10% threshold)
**Problem:** Subscription conversion may be naturally low for most behavioral segments.

**Subscription Conversion Rates:**
- Overall conversion ~5-10% (typical for premium subscriptions)
- Lower-value groups (0-1 events) likely have <10% conversion
- Only high-engagement groups pass the threshold

**Example:**
```
Value 0: 10% conversion (✅ barely passes)
Value 1: 8% conversion (❌ filtered out)
Value 2: 15% conversion (✅ passes)
```

Only 2 groups pass → not enough to find meaningful jump.

### Issue 3: Insufficient Valid Groups (<2 groups required)
**Problem:** Need at least 2 groups passing both filters to calculate a jump.

```typescript
if (validGroups.length < 2) return null  // Line 205
```

### Issue 4: Event Data Sparsity
**Variables Most Likely Affected:**
1. `stripe_modal_views` - Low frequency event
2. `paywall_views` - Only for certain user paths
3. `total_premium_copies` - Subset of users
4. `premium_creator_views` - Lower volume than regular views
5. `lifetime_created_portfolios` - Power user metric

**Why This Matters for Subscriptions:**
- Subscription is already a rare outcome (~5-10% of users)
- When combined with rare predictor variables, intersection becomes very small
- Many variable-value combinations have <10 users

## Data Requirements Check

### What's Needed for Valid Tipping Point:

**Minimum Dataset Size:**
- At least 2 groups with ≥10 users each = **minimum 20 users**
- Both groups must have >10% conversion rate
- For 10% conversion: need at least 2 conversions per group
- **Practical minimum: ~100-200 users to get robust tipping points**

### Subscription Drivers Variables (26 total):
From line 72-100:
- `total_bank_links`, `total_copies`, `total_regular_copies`, `total_premium_copies`
- `regular_pdp_views`, `premium_pdp_views`, `paywall_views`
- `regular_creator_views`, `premium_creator_views`
- `app_sessions`, `discover_tab_views`, `leaderboard_tab_views`, `premium_tab_views`
- `stripe_modal_views`, `creator_card_taps`, `portfolio_card_taps`
- `total_ach_deposits`, `unique_creators_viewed`, `unique_portfolios_viewed`
- `available_copy_credits`, `buying_power`
- `active_created_portfolios`, `lifetime_created_portfolios`
- `active_copied_portfolios`, `lifetime_copied_portfolios`, `total_deposits`

## Expected Null Tipping Point Rates

### High-Frequency Events (likely have tipping points):
- `app_sessions` - Most users have multiple
- `discover_tab_views` - Common activity
- `regular_pdp_views` - High volume
- `unique_creators_viewed` - Well-distributed

**Expected null rate: 0-20%**

### Medium-Frequency Events:
- `premium_pdp_views` - Subset of users
- `creator_card_taps` - Moderate engagement
- `total_copies` - Many users have 0

**Expected null rate: 20-50%**

### Low-Frequency Events (likely null tipping points):
- `stripe_modal_views` - Rare action
- `paywall_views` - Specific user path
- `lifetime_created_portfolios` - Power users only
- `total_premium_copies` - Small subset

**Expected null rate: 50-80%+**

## Recommendations

### Option 1: Relax Filters (Easier)
```typescript
// Current:
.filter(([_, stats]) => stats.total >= 10 && (stats.converted / stats.total) > 0.10)

// Proposed:
.filter(([_, stats]) => stats.total >= 5 && (stats.converted / stats.total) > 0.05)
```

**Trade-offs:**
- ✅ More tipping points calculated
- ❌ Less statistical confidence
- ❌ More noise/false positives

### Option 2: Add Debug Logging (Recommended First Step)
Add logging to `calculateTippingPoint` to understand why tipping points are null:

```typescript
console.log(`Tipping point analysis for ${variable}:`)
console.log(`  - Total groups: ${Object.keys(groups).length}`)
console.log(`  - Valid groups: ${validGroups.length}`)
console.log(`  - Filtered out: ${Object.keys(groups).length - validGroups.length}`)
if (validGroups.length > 0) {
  console.log(`  - Value range: ${validGroups[0].value} to ${validGroups[validGroups.length-1].value}`)
}
```

### Option 3: Adaptive Thresholds
Use different thresholds based on overall dataset size:

```typescript
const minGroupSize = data.length > 1000 ? 10 : 5
const minConversionRate = data.length > 1000 ? 0.10 : 0.05
```

### Option 4: Report Null Reasons
Instead of returning null, return diagnostic info:

```typescript
return {
  tipping_point: null,
  reason: 'insufficient_groups',  // or 'low_conversion', 'small_sample'
  debug: { total_groups: X, valid_groups: Y }
}
```

## Next Steps

1. **Check actual null rate in database:**
   ```sql
   SELECT
     COUNT(*) as total,
     COUNT(tipping_point) as has_tipping_point,
     COUNT(*) - COUNT(tipping_point) as null_tipping_point,
     ROUND(100.0 * (COUNT(*) - COUNT(tipping_point)) / COUNT(*), 1) as null_percentage
   FROM subscription_drivers;
   ```

2. **Identify which variables have null tipping points:**
   ```sql
   SELECT variable_name, tipping_point, correlation_coefficient
   FROM subscription_drivers
   WHERE tipping_point IS NULL
   ORDER BY ABS(correlation_coefficient) DESC;
   ```

3. **Add debug logging** to understand why specific variables return null

4. **Decide on threshold adjustments** based on data analysis

5. **Add tipping point column back to display** once we're confident in the data quality
