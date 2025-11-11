# Premium Creator Tables & Views Audit
**Date**: 2025-11-10
**Purpose**: Complete audit of all premium creator-related data structures to identify discrepancies and streamline data flow

---

## UI Analyses Overview

The Premium Creator Analysis tab displays 6 main analyses:

1. **Summary Stats** (Metric Cards)
2. **Premium Creator Breakdown** (Table)
3. **Premium Portfolio Breakdown** (Table)
4. **Premium Creator Retention** (Table)
5. **Premium Creator Copy Affinity** (Table)
6. **Portfolio Assets Breakdown** (Metric Cards + Table)

---

## Base Tables (Raw Data Storage)

### 1. `premium_creators`
- **Source**: Mixpanel Chart 85725073
- **Purpose**: Authoritative list of premium creators
- **Columns**: `creator_id` (PK), `creator_username`, `synced_at`, `created_at`
- **Key Issue**: Some creators have MULTIPLE creator_ids (e.g., @dubAdvisors)
- **Populated By**: `sync-creator-data` Edge Function
- **Used By**: All premium creator analyses

### 2. `premium_creator_metrics`
- **Source**: Mixpanel Chart 85821646 (Creator-level subscription metrics)
- **Purpose**: Store subscription metrics at CREATOR level (not portfolio level)
- **Columns**: `creator_id`, `creator_username`, `total_subscriptions`, `total_paywall_views`, `total_stripe_modal_views`, `total_cancellations`, `synced_at`
- **Constraint**: `UNIQUE(creator_id, synced_at)` - allows multiple syncs per creator
- **Issue Fixed**: Edge function now uses MAX across creator_ids to avoid double-counting
- **Populated By**: `sync-creator-data` Edge Function (processSubscriptionMetrics)
- **Used By**: `premium_creator_metrics_latest` view → `portfolio_creator_engagement_metrics` → `premium_creator_breakdown`

### 3. `premium_creator_portfolio_metrics`
- **Source**: Mixpanel Chart 85810770 (Portfolio-level engagement metrics)
- **Purpose**: Store portfolio-level metrics (PDP views, copies, liquidations)
- **Columns**: `creator_id`, `creator_username`, `portfolio_ticker`, `total_pdp_views`, `total_profile_views`, `total_copies`, `total_liquidations`, `synced_at`
- **Note**: Does NOT include subscription metrics (those are in premium_creator_metrics)
- **Populated By**: `sync-creator-data` Edge Function
- **Used By**: `premium_creator_portfolio_metrics_latest` view → multiple downstream views

### 4. `user_portfolio_creator_engagement`
- **Source**: Mixpanel Chart 85165580 (User-level portfolio engagement)
- **Purpose**: User-level engagement data (who viewed/copied which portfolios)
- **Columns**: `distinct_id`, `creator_id`, `creator_username`, `portfolio_ticker`, `pdp_view_count`, `did_copy`, `copy_count`, `liquidation_count`
- **Populated By**: `sync-creator-data` Edge Function
- **Used By**: `portfolio_creator_engagement_metrics`, `premium_creator_copy_affinity_base`

### 5. `premium_creator_retention_events`
- **Source**: Mixpanel Chart 85843193 (Subscription retention events)
- **Purpose**: Track subscription start/cancel events per user per creator
- **Columns**: `creator_id`, `creator_username`, `distinct_id`, `subscription_start_date`, `subscription_cancel_date`, `synced_at`
- **Populated By**: `sync-premium-creator-retention` Edge Function
- **Used By**: Premium Creator Retention analysis

### 6. `portfolio_stock_holdings`
- **Source**: Manual CSV upload
- **Purpose**: Store stock holdings per portfolio
- **Columns**: `portfolio_ticker`, `stock_ticker`, `position_count`, `total_quantity`, `uploaded_at`
- **Constraint**: `UNIQUE(portfolio_ticker, stock_ticker)`
- **Populated By**: `upload-portfolio-metrics` Edge Function (dataType=holdings)
- **Used By**: Portfolio Assets Breakdown analysis

### 7. `portfolio_performance_metrics`
- **Source**: Manual CSV upload
- **Purpose**: Store portfolio performance data
- **Columns**: `portfolio_ticker`, `inception_date`, `total_returns_percentage`, `total_position`, `uploaded_at`
- **Constraint**: `UNIQUE(portfolio_ticker)`
- **Populated By**: `upload-portfolio-metrics` Edge Function (dataType=performance)
- **Used By**: `premium_creator_breakdown`, `premium_portfolio_breakdown`

---

## Latest Views (Deduplication Layers)

### `premium_creator_metrics_latest`
- **Type**: VIEW
- **Purpose**: Get latest sync data per creator (DISTINCT ON creator_id, ORDER BY synced_at DESC)
- **Used By**: `portfolio_creator_engagement_metrics`

### `premium_creator_portfolio_metrics_latest`
- **Type**: VIEW
- **Purpose**: Get latest sync data per (creator_id, portfolio_ticker) pair
- **Used By**: `portfolio_creator_engagement_metrics`, `premium_creator_copy_affinity_base`

---

## Aggregation Layer (Materialized Views)

### 1. `portfolio_creator_engagement_metrics`
- **Type**: MATERIALIZED VIEW
- **Purpose**: Aggregate user-level engagement to portfolio level
- **Joins**:
  - `user_portfolio_creator_engagement` (base data)
  - `premium_creator_portfolio_metrics_latest` (portfolio metrics)
  - `premium_creator_metrics_latest` (creator subscription metrics)
- **Outputs**: `portfolio_ticker`, `creator_id`, `creator_username`, `unique_viewers`, `unique_copiers`, `total_pdp_views`, `total_copies`, `total_liquidations`, `total_subscriptions`, `total_paywall_views`, etc.
- **Refresh**: After `sync-creator-data` completes
- **Used By**: `premium_creator_breakdown`, `premium_portfolio_breakdown`, `premium_creator_copy_affinity_base`

### 2. `premium_creator_breakdown`
- **Type**: MATERIALIZED VIEW
- **Purpose**: Aggregate metrics to CREATOR USERNAME level
- **Data Flow**:
  - **Engagement**: SUM from `portfolio_creator_engagement_metrics` (copies, pdp_views, liquidations)
  - **Subscriptions**: MAX from `premium_creator_metrics` (to avoid double-counting)
  - **Performance**: AVG/SUM from `portfolio_performance_metrics` via `portfolio_creator_engagement_metrics`
- **Outputs**: Per creator: copies, pdp_views, liquidations, subscriptions, paywall_views, cancellations, CVRs, avg returns, total capital
- **Refresh**: After sync or manual upload
- **Used By**: Premium Creator Breakdown table, `premium_creator_summary_stats`, `premium_creator_top_5_stocks`

### 3. `premium_portfolio_breakdown`
- **Type**: MATERIALIZED VIEW (assumed based on pattern)
- **Purpose**: Show portfolio-level breakdown with creator info
- **Data Source**: Likely from `portfolio_creator_engagement_metrics` + `portfolio_performance_metrics`
- **Used By**: Premium Portfolio Breakdown table
- **Note**: Need schema to verify exact structure

### 4. `premium_creator_copy_affinity_base`
- **Type**: VIEW
- **Purpose**: Calculate which creators are copied by users who copied premium creators
- **Data Flow**:
  - Get premium creator copiers from `user_portfolio_creator_engagement`
  - Find what else those copiers copied
  - Aggregate totals from `premium_creator_portfolio_metrics_latest`
- **Used By**: `premium_creator_affinity_display`

### 5. `premium_creator_affinity_display`
- **Type**: VIEW
- **Purpose**: Pivot affinity data into top 5 display format
- **Data Source**: `premium_creator_copy_affinity_base`
- **Outputs**: Per premium creator: copies, liquidations, top_1 through top_5 (combined Regular/Premium)
- **Used By**: Premium Creator Copy Affinity table

### 6. `premium_creator_stock_holdings`
- **Type**: MATERIALIZED VIEW
- **Purpose**: Aggregate stock holdings to premium creators only
- **Data Flow**:
  - `portfolio_stock_holdings` → filter by premium creators → aggregate by (creator_username, stock_ticker)
- **Outputs**: `creator_username`, `stock_ticker`, `total_quantity`, `portfolio_count`
- **Used By**: `top_stocks_all_premium_creators`, `premium_creator_top_5_stocks`

### 7. `top_stocks_all_premium_creators`
- **Type**: MATERIALIZED VIEW
- **Purpose**: Rank top 5 stocks across ALL premium creators
- **Data Source**: `premium_creator_stock_holdings` (SUM total_quantity, rank by total)
- **Outputs**: Top 5 stocks with total_quantity, creator_count, portfolio_count, rank
- **Used By**: Portfolio Assets Breakdown metric cards

### 8. `premium_creator_top_5_stocks`
- **Type**: MATERIALIZED VIEW
- **Purpose**: Top 5 stocks per individual premium creator
- **Data Source**: `premium_creator_stock_holdings` (ARRAY_AGG top 5 per creator)
- **Joins**: `premium_creator_breakdown` (for total_copies sorting)
- **Outputs**: `creator_username`, `top_stocks[]`, `top_quantities[]`, `total_copies`
- **Used By**: Portfolio Assets Breakdown table

---

## Display Layer (Non-Materialized Views)

### `premium_creator_summary_stats`
- **Type**: VIEW
- **Purpose**: Calculate summary statistics for metric cards
- **Data Source**: `premium_creator_breakdown`
- **Outputs**: `avg_copy_cvr`, `avg_subscription_cvr`, `median_all_time_performance`, `median_copy_capital`, `total_creators`
- **Used By**: Summary Stats metric cards

---

## Data Flow by UI Analysis

### 1. Summary Stats (Metric Cards)
```
premium_creator_breakdown → premium_creator_summary_stats → UI
```
**Metrics**: Avg Copy CVR, Avg Subscription CVR, Median All-Time Returns, Median Copy Capital

### 2. Premium Creator Breakdown (Table)
```
user_portfolio_creator_engagement → portfolio_creator_engagement_metrics → premium_creator_breakdown → UI
premium_creator_metrics → (MAX aggregation) → premium_creator_breakdown
portfolio_performance_metrics → premium_creator_breakdown
```
**Metrics**: Copies, PDP Views, Liquidations, Copy CVR, Liquidation Rate, Subscriptions, Paywall Views, Cancellations, Subscription CVR, Cancellation Rate, Avg All-Time Returns, Total Copy Capital

### 3. Premium Portfolio Breakdown (Table)
```
portfolio_creator_engagement_metrics → premium_portfolio_breakdown → UI
portfolio_performance_metrics → premium_portfolio_breakdown
```
**Metrics**: Portfolio ticker, creator, copies, liquidations, returns, capital

### 4. Premium Creator Retention (Table)
```
premium_creator_retention_events → (Direct aggregation in frontend or view) → UI
```
**Metrics**: Subscribers, cancellations, retention rate per creator

### 5. Premium Creator Copy Affinity (Table)
```
user_portfolio_creator_engagement → premium_creator_copy_affinity_base → premium_creator_affinity_display → UI
premium_creator_portfolio_metrics_latest → (for total copies/liquidations)
```
**Metrics**: Total copies, liquidations, top 5 co-copied creators

### 6. Portfolio Assets Breakdown (Metric Cards + Table)
```
portfolio_stock_holdings → premium_creator_stock_holdings → top_stocks_all_premium_creators → UI (metric cards)
portfolio_stock_holdings → premium_creator_stock_holdings → premium_creator_top_5_stocks → UI (table)
premium_creator_breakdown → premium_creator_top_5_stocks (for total_copies sorting)
```
**Metrics**: Top 5 stocks overall, top 5 stocks per creator

---

## Identified Issues & Recommendations

### ✅ FIXED: Issue 1 - Subscription Double-Counting
**Problem**: Creators with multiple creator_ids had subscriptions summed instead of using max
**Root Cause**: `premium_creator_breakdown` was using SUM on `premium_creator_metrics`
**Fix Applied**:
- Edge function now aggregates at username level (takes MAX)
- View now uses MAX instead of SUM
**Status**: ✅ Fixed in latest migration

### ⚠️ POTENTIAL ISSUE 2 - Liquidations Discrepancy
**Problem**: User reports liquidations differ between Premium Creator Breakdown and Copy Affinity
**Analysis**: Both use same source (`premium_creator_portfolio_metrics_latest`) and both SUM correctly
**Likely Cause**: Materialized view refresh timing - views may be out of sync
**Recommendation**:
1. Verify both views refresh in same transaction/sequence
2. Add refresh timestamp to views for debugging
3. Consider consolidating liquidations calculation to single source

### ⚠️ POTENTIAL ISSUE 3 - Duplicate Creator IDs
**Problem**: Multiple creator_ids exist for same username (e.g., @dubAdvisors)
**Impact**: Requires MAX/deduplication logic throughout aggregation layer
**Root Cause**: Upstream Mixpanel data has duplicate creator profiles
**Recommendation**:
1. Document which creators have duplicates
2. Consider normalizing to username as primary key where possible
3. Add monitoring/alerts for new duplicate creator_ids

### ⚠️ ISSUE 4 - Complex Aggregation Chain
**Problem**: Data flows through 3-4 layers before reaching UI (raw → latest → materialized → display → UI)
**Impact**:
- Hard to debug discrepancies
- Multiple refresh points where data can be out of sync
- High maintenance burden
**Recommendation**:
1. Consider flattening some aggregation layers
2. Add data lineage/timestamp tracking at each layer
3. Create refresh orchestration to ensure atomic updates

### ⚠️ ISSUE 5 - Inconsistent Aggregation Methods
**Observation**: Some metrics use SUM (engagement), some use MAX (subscriptions), some use AVG (returns)
**Current State**: Correct for each metric type, but complex to reason about
**Recommendation**: Document aggregation method for each metric with rationale

### ⚠️ ISSUE 6 - Missing Schema for `premium_portfolio_breakdown`
**Problem**: Cannot fully audit without seeing this view's schema
**Recommendation**: Provide schema definition for complete audit

### ⚠️ ISSUE 7 - Refresh Dependencies
**Problem**: Views have dependencies that must be refreshed in correct order:
- `premium_creator_stock_holdings` (base) → `top_stocks_all_premium_creators`, `premium_creator_top_5_stocks`
- `premium_creator_breakdown` (base) → `premium_creator_summary_stats`, `premium_creator_top_5_stocks`

**Current State**: Manual refresh order required
**Recommendation**: Create refresh orchestration function that handles dependencies automatically

---

## Recommended Actions

### Immediate (Required for Data Accuracy):
1. ✅ **Run new migration**: `fix_premium_creator_breakdown_subscriptions_dedup.sql`
2. ✅ **Resync creator data**: Populate with deduplicated subscription values
3. ✅ **Refresh all views**: Run refresh functions in correct order
4. **Verify liquidations match**: Compare Premium Creator Breakdown vs Copy Affinity after refresh

### Short-term (Reduce Complexity):
1. **Add refresh timestamps**: Track when each materialized view was last refreshed
2. **Create refresh orchestration**: Single function to refresh all views in correct order
3. **Add data validation**: Compare metrics across different aggregation paths
4. **Document aggregation logic**: Clear docs for each metric's calculation method

### Long-term (Architecture Improvements):
1. **Consolidate aggregation layers**: Evaluate if `portfolio_creator_engagement_metrics` can directly feed display tables
2. **Normalize creator_ids**: Work with data team to deduplicate at source or create canonical mapping
3. **Add monitoring**: Alert on view staleness, data discrepancies between views
4. **Consider incremental refresh**: For large views, explore incremental updates vs full refresh

---

## Questions for Complete Audit

1. **What is the schema of `premium_portfolio_breakdown`?** (Need to see CREATE statement)
2. **Are there any other premium creator views not listed here?**
3. **What is the expected refresh frequency for each view?**
4. **Are there any performance issues with current refresh times?**
5. **How are retention metrics calculated?** (Need to see aggregation logic for retention table)
