# Total Copies & Total Liquidations Data Flow

Complete trace from data source → database → UI for Premium Creator Breakdown, Premium Portfolio Breakdown, and Premium Creator Copy Affinity.

---

## 📊 Data Source: Mixpanel

### Chart: 85165580 (PDP Views by Portfolio)
**Mixpanel Insights API returns 3 metrics in one chart:**
- `A. Total PDP Views` - Portfolio detail page views
- `B. Total Copies` - Number of times a portfolio was copied
- `C. Total Liquidations` - Number of times a copied portfolio was liquidated

**Data Structure:**
```
{
  series: {
    "B. Total Copies": {
      "distinctId1": {
        "$PORTFOLIO_TICKER": {
          "creatorId1": {
            "creatorUsername": { all: 5 }  // 5 copies
          }
        }
      }
    },
    "C. Total Liquidations": {
      "distinctId1": {
        "$PORTFOLIO_TICKER": {
          "creatorId1": {
            "creatorUsername": { all: 2 }  // 2 liquidations
          }
        }
      }
    }
  }
}
```

**Key Insight:** Data is nested by `distinctId → portfolioTicker → creatorId → username`

---

## 🔄 Step 1: Edge Function Fetch

**File:** `supabase/functions/sync-mixpanel-engagement/index.ts`

### Function: `sync-mixpanel-engagement`

```typescript
// Fetch Chart 85165580 (contains copies + liquidations)
const pdpViewsData = await fetchInsightsData(
  credentials,
  '85165580',
  'PDP Views by Portfolio (with Copies & Liquidations)'
)
```

**Output:** Raw Mixpanel JSON with nested structure

---

## 🔧 Step 2: Data Processing

**File:** `supabase/functions/_shared/data-processing.ts`

### Function: `processPortfolioCreatorPairs()`

**Lines 200-330:** Extracts copies and liquidations from nested structure

```typescript
// Extract metrics from Chart 85165580
const pdpMetric = pdpViewsData?.series?.['A. Total PDP Views']
const copiesMetric = pdpViewsData?.series?.['B. Total Copies']
const liquidationsMetric = pdpViewsData?.series?.['C. Total Liquidations']

// For each distinctId → portfolioTicker → creatorId combination:

// Extract copy count (lines 279-296)
let copyCount = 0
const copyData = copiesMetric?.[distinctId]?.[rawPortfolioTicker]?.[creatorId]
if (copyData) {
  if (copyData['$overall']) {
    copyCount = parseInt(String(copyData['$overall'].all)) || 0
  } else if (copyData[creatorUsername]) {
    copyCount = parseInt(String(copyData[creatorUsername].all)) || 0
  }
}

// Extract liquidation count (lines 298-313)
let liquidationCount = 0
const liqData = liquidationsMetric?.[distinctId]?.[rawPortfolioTicker]?.[creatorId]
if (liqData) {
  if (liqData['$overall']) {
    liquidationCount = parseInt(String(liqData['$overall'].all)) || 0
  } else if (liqData[creatorUsername]) {
    liquidationCount = parseInt(String(liqData[creatorUsername].all)) || 0
  }
}

// Create record (lines 319-329)
portfolioCreatorPairs.push({
  distinct_id: distinctId,
  portfolio_ticker: portfolioTicker,
  creator_id: creatorId,
  creator_username: creatorUsername,
  pdp_view_count: pdpCount,
  did_copy: copyCount > 0,
  copy_count: copyCount,           // ✅ COPIES
  liquidation_count: liquidationCount,  // ✅ LIQUIDATIONS
  synced_at: syncedAt,
})
```

**Output:** Array of portfolio-creator engagement objects with `copy_count` and `liquidation_count`

---

## 💾 Step 3: Database Insertion

**File:** `supabase/functions/sync-mixpanel-engagement/index.ts`

### Table: `user_portfolio_creator_engagement`

**Lines 175-193:** Parallel batch upsert

```typescript
await upsertInParallelBatches(
  portfolioCreatorPairs,
  'user_portfolio_creator_engagement',
  'distinct_id,portfolio_ticker,creator_id',
  'portfolio-creator pairs'
)
```

**Schema:**
```sql
user_portfolio_creator_engagement (
  distinct_id,          -- User who viewed/copied
  portfolio_ticker,     -- Portfolio copied (e.g., $PORTFOLIO1)
  creator_id,           -- Creator of the portfolio
  creator_username,     -- Creator username
  pdp_view_count,       -- PDP views
  did_copy,             -- Boolean: did user copy?
  copy_count,           -- ✅ COPIES (from Mixpanel Chart B)
  liquidation_count,    -- ✅ LIQUIDATIONS (from Mixpanel Chart C)
  synced_at             -- Timestamp
)
```

**Result:** User-level granular data (one row per user-portfolio-creator combination)

---

## 🗂️ Step 4: Aggregation to Materialized View

**File:** `supabase/migrations/update_portfolio_creator_engagement_with_premium_metrics.sql`

### Materialized View: `portfolio_creator_engagement_metrics`

**Purpose:** Aggregate user-level data to portfolio-creator level

```sql
CREATE MATERIALIZED VIEW portfolio_creator_engagement_metrics AS
SELECT
  upce.portfolio_ticker,
  upce.creator_id,
  upce.creator_username,

  COUNT(DISTINCT upce.distinct_id) AS unique_viewers,
  SUM(upce.pdp_view_count) AS total_pdp_views,

  -- ✅ AGGREGATE COPIES (line 25)
  SUM(CASE WHEN upce.did_copy THEN upce.copy_count ELSE 0 END) AS total_copies,

  -- ✅ AGGREGATE LIQUIDATIONS (line 26)
  SUM(upce.liquidation_count) AS total_liquidations,

  -- ... other metrics ...
FROM user_portfolio_creator_engagement upce
GROUP BY
  upce.portfolio_ticker,
  upce.creator_id,
  upce.creator_username
```

**Schema:**
```
portfolio_creator_engagement_metrics (
  portfolio_ticker,
  creator_id,
  creator_username,
  unique_viewers,
  total_pdp_views,
  total_copies,        -- ✅ SUM of copy_count
  total_liquidations,  -- ✅ SUM of liquidation_count
  ...
)
```

**Result:** One row per portfolio-creator combination with aggregated totals

**Refresh Trigger:** Called by `refresh_portfolio_engagement_views()` RPC function

---

## 📈 Step 5: View-Specific Aggregations

### 5A. Premium Creator Breakdown

**File:** `supabase/migrations/fix_premium_creator_breakdown_group_by.sql`

**Materialized View:** `premium_creator_breakdown`

```sql
WITH engagement_by_username AS (
    SELECT
        pc.creator_username,
        -- ✅ SUM COPIES across all portfolios for this creator (line 11)
        SUM(pcem.total_copies) AS total_copies,
        -- ✅ SUM LIQUIDATIONS across all portfolios for this creator (line 12)
        COALESCE(SUM(pcem.total_liquidations), 0) AS total_liquidations,
        SUM(pcem.total_pdp_views) AS total_pdp_views
    FROM premium_creators pc
    LEFT JOIN portfolio_creator_engagement_metrics pcem
      ON pc.creator_id = pcem.creator_id
    GROUP BY pc.creator_username
)
SELECT
    pc.creator_username,
    COALESCE(eng.total_copies, 0) AS total_copies,        -- ✅ COPIES
    COALESCE(eng.total_liquidations, 0) AS total_liquidations,  -- ✅ LIQUIDATIONS
    -- ... other metrics ...
FROM (SELECT DISTINCT creator_username FROM premium_creators) pc
LEFT JOIN engagement_by_username eng ON pc.creator_username = eng.creator_username
```

**Aggregation Level:** Creator-level (SUM across all portfolios)

**Calculation:**
```
Creator Total Copies = SUM(portfolio_creator_engagement_metrics.total_copies)
                       WHERE creator_id matches
```

**UI Display:** `creator_analysis_tool_supabase.js:580-650` (Premium Creator Breakdown table)

---

### 5B. Premium Portfolio Breakdown

**File:** `supabase/migrations/update_portfolio_breakdown_view_direct_join.sql`

**Materialized View:** `portfolio_breakdown_with_metrics`

```sql
CREATE MATERIALIZED VIEW portfolio_breakdown_with_metrics AS
SELECT
    pcem.portfolio_ticker,
    pcem.creator_id,
    pc.creator_username,
    -- ✅ COPIES - directly from pcem (line 11)
    pcem.total_copies,
    pcem.total_pdp_views,
    -- ✅ LIQUIDATIONS - directly from pcem (line 13)
    pcem.total_liquidations,
    -- Calculate rates
    CASE
        WHEN pcem.total_pdp_views > 0
        THEN (pcem.total_copies::numeric / pcem.total_pdp_views::numeric) * 100
        ELSE 0
    END as copy_cvr,
    CASE
        WHEN pcem.total_copies > 0
        THEN (pcem.total_liquidations::numeric / pcem.total_copies::numeric) * 100
        ELSE 0
    END as liquidation_rate,
    -- ... performance metrics ...
FROM portfolio_creator_engagement_metrics pcem
JOIN premium_creators pc ON pcem.creator_id = pc.creator_id
LEFT JOIN portfolio_performance_metrics ppm ON pcem.portfolio_ticker = ppm.portfolio_ticker
```

**Aggregation Level:** Portfolio-level (no additional aggregation - direct pass-through)

**Calculation:**
```
Portfolio Total Copies = portfolio_creator_engagement_metrics.total_copies
Portfolio Total Liquidations = portfolio_creator_engagement_metrics.total_liquidations
```

**UI Display:** `creator_analysis_tool_supabase.js:990-1050` (Premium Portfolio Breakdown table)

---

### 5C. Premium Creator Copy Affinity

**File:** `supabase/migrations/restore_all_premium_creator_views.sql`

**View:** `premium_creator_copy_affinity_base`

```sql
WITH premium_totals AS (
  SELECT
    pc.creator_username AS premium_creator,
    -- ✅ SUM COPIES for affinity totals (line 187)
    SUM(pcem.total_copies) AS total_copies,
    -- ✅ SUM LIQUIDATIONS for affinity totals (line 188)
    SUM(pcem.total_liquidations) AS total_liquidations
  FROM premium_creators_list pc
  CROSS JOIN LATERAL unnest(pc.creator_ids) AS pc_creator_id
  LEFT JOIN portfolio_creator_engagement_metrics pcem
    ON pc_creator_id = pcem.creator_id
  GROUP BY pc.creator_username
)
SELECT
  ar.premium_creator,
  -- ✅ COPIES from aggregated totals (line 210)
  pt.total_copies AS premium_creator_total_copies,
  -- ✅ LIQUIDATIONS from aggregated totals (line 211)
  pt.total_liquidations AS premium_creator_total_liquidations,
  ar.copied_creator,
  -- ... affinity metrics ...
FROM affinity_raw ar
JOIN premium_totals pt ON ar.premium_creator = pt.premium_creator
```

**Aggregation Level:** Creator-level (SUM across all portfolios)

**Calculation:**
```
Creator Total Copies (for affinity) = SUM(portfolio_creator_engagement_metrics.total_copies)
                                      WHERE creator_id matches
```

**UI Display:** `creator_analysis_tool_supabase.js:1830-1920` (Premium Creator Copy Affinity table)

---

## 🎨 Step 6: UI Rendering

### Premium Creator Breakdown

**File:** `creator_analysis_tool_supabase.js`

**Query:**
```javascript
// Line 545
const { data: creatorData, error: creatorError } = await this.supabaseIntegration.supabase
    .from('premium_creator_breakdown')
    .select('*')
    .order('total_copies', { ascending: false })
```

**Display:** Lines 580-650 render table with:
- `total_copies` column
- `total_liquidations` column
- Calculated `liquidation_rate` percentage

---

### Premium Portfolio Breakdown

**File:** `creator_analysis_tool_supabase.js`

**Query:**
```javascript
// Line 915
const { data: portfolioData, error: portfolioError } = await this.supabaseIntegration.supabase
    .from('portfolio_breakdown_with_metrics')
    .select('*')
    .order('total_copies', { ascending: false })
```

**Display:** Lines 990-1050 render table with:
- `total_copies` column
- `total_liquidations` column
- Calculated `liquidation_rate` percentage

---

### Premium Creator Copy Affinity

**File:** `creator_analysis_tool_supabase.js`

**Query:**
```javascript
// Line 1805
const { data: affinityData, error: affinityError } = await this.supabaseIntegration.supabase
    .from('premium_creator_affinity_display')
    .select('*')
```

**Display:** Lines 1830-1920 render table with:
- `premium_creator_total_copies` column
- `premium_creator_total_liquidations` column
- Affinity breakdown by copied creator

---

## 🔄 Complete Flow Summary

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. MIXPANEL DATA SOURCE                                         │
│    Chart 85165580: B. Total Copies, C. Total Liquidations      │
│    Structure: distinctId → portfolio → creator → username → count│
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. EDGE FUNCTION: sync-mixpanel-engagement                     │
│    - Fetches Chart 85165580 via Mixpanel Insights API          │
│    - Calls processPortfolioCreatorPairs()                      │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. DATA PROCESSING: processPortfolioCreatorPairs()             │
│    - Extracts copy_count from series["B. Total Copies"]        │
│    - Extracts liquidation_count from series["C. Total Liquidations"]│
│    - Creates portfolioCreatorPairs array                       │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. DATABASE TABLE: user_portfolio_creator_engagement           │
│    - Stores user-level granular data                           │
│    - Columns: copy_count, liquidation_count                    │
│    - One row per user-portfolio-creator combination            │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. MATERIALIZED VIEW: portfolio_creator_engagement_metrics     │
│    - Aggregates to portfolio-creator level                     │
│    - total_copies = SUM(copy_count)                            │
│    - total_liquidations = SUM(liquidation_count)               │
│    - One row per portfolio-creator combination                 │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ├─────────────────┬─────────────────┐
                          ▼                 ▼                 ▼
┌───────────────────┐ ┌──────────────────┐ ┌─────────────────────┐
│ 6A. CREATOR VIEW  │ │ 6B. PORTFOLIO    │ │ 6C. AFFINITY VIEW   │
│ premium_creator_  │ │ portfolio_       │ │ premium_creator_    │
│ breakdown         │ │ breakdown_with_  │ │ copy_affinity_base  │
│                   │ │ metrics          │ │                     │
│ SUM by creator    │ │ Pass-through     │ │ SUM by creator      │
│ (all portfolios)  │ │ (per portfolio)  │ │ (all portfolios)    │
└─────────┬─────────┘ └────────┬─────────┘ └──────────┬──────────┘
          │                    │                       │
          ▼                    ▼                       ▼
┌───────────────────────────────────────────────────────────────────┐
│ 7. UI DISPLAY (creator_analysis_tool_supabase.js)                │
│    - Premium Creator Breakdown table                              │
│    - Premium Portfolio Breakdown table                            │
│    - Premium Creator Copy Affinity table                          │
└───────────────────────────────────────────────────────────────────┘
```

---

## 🔑 Key Consistency Points

### ✅ All Three Views Use Same Data Source

1. **Source Table:** `user_portfolio_creator_engagement`
2. **Aggregation Layer:** `portfolio_creator_engagement_metrics`
3. **Final Views:** All three views query from `portfolio_creator_engagement_metrics`

### ✅ Aggregation Logic

- **Premium Creator Breakdown:** `SUM(pcem.total_copies)` grouped by `creator_username`
- **Premium Portfolio Breakdown:** Direct `pcem.total_copies` (no additional aggregation)
- **Premium Creator Copy Affinity:** `SUM(pcem.total_copies)` grouped by `creator_username`

### ✅ Refresh Workflow

1. **Manual Trigger:** User clicks "Sync Live Data"
2. **Edge Function:** `sync-mixpanel-engagement` fetches and upserts data
3. **Background Refresh:** Triggers `refresh-engagement-views` Edge Function
4. **Materialized Views:** Refreshes `portfolio_creator_engagement_metrics` (includes `premium_creator_breakdown`)
5. **Regular Views:** `premium_creator_copy_affinity_base` auto-updates (depends on materialized views)

---

## 🐛 Common Issues & Debugging

### Issue: Counts don't match between views

**Check:**
1. Materialized views need refresh: `REFRESH MATERIALIZED VIEW portfolio_creator_engagement_metrics`
2. Data sync completed successfully (check `sync_logs` table)
3. All creators in `premium_creators` table

### Issue: Creator missing from breakdown

**Check:**
1. Creator exists in `premium_creators` table
2. `premium_creator_breakdown` materialized view has been refreshed
3. LEFT JOINs are used (should show 0 if no engagement)

### Issue: Total Copies = 0 but should have data

**Check:**
1. Chart 85165580 in Mixpanel returns data for "B. Total Copies"
2. `processPortfolioCreatorPairs()` extracts copy_count correctly
3. `user_portfolio_creator_engagement` table has `copy_count > 0`
4. `portfolio_creator_engagement_metrics` aggregates correctly

---

## 📝 Notes

- **Liquidations are always ≤ Copies** (can't liquidate what wasn't copied)
- **Materialized views are snapshots** - must be manually refreshed
- **Regular views auto-update** when underlying data changes
- **User-level data** retained in `user_portfolio_creator_engagement` for granular analysis
- **Aggregations** happen at multiple levels: user → portfolio-creator → creator
