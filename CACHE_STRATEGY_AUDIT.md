# Cache Strategy Audit Across All Tabs
**Date**: 2025-11-10
**Purpose**: Document inconsistent caching strategies and propose unified approach

---

## Current State: 4 Different Caching Strategies

### Tab 1: Summary Stats
**Cache Key**: `dubAnalysisResults` (shared)
**Strategy**:
- Saves/restores HTML to unified cache
- On page load: Restores from cache
- On sync: Fetches new data, rebuilds HTML, saves to cache

**Sections**:
- Metric cards (4-5 cards at top)

### Tab 2: Portfolio Analysis
**Cache Key**: `dubAnalysisResults.portfolio` (nested in unified cache)
**Strategy**:
- Same as Summary Stats
- Shares same unified cache object

**Sections**:
- Portfolio breakdown table
- Hidden gems table
- Other portfolio metrics

### Tab 3: Subscription Analysis
**Cache Key**: `dubAnalysisResults.subscription` (nested in unified cache)
**Strategy**:
- Same as Summary Stats
- Shares same unified cache object

**Sections**:
- Subscription metrics
- Conversion path analysis
- Event sequences

### Tab 4: Premium Creator Analysis
**Cache Key**: `dubAnalysisResults.creator` (nested in unified cache)
**Strategy**: **INCONSISTENT** - Mix of both approaches

**Sections & Their Caching**:

1. **Summary Stats (Metric Cards)**
   - ✅ Uses cache: Restored from `dubAnalysisResults.creator`
   - Fetches from: `premium_creator_summary_stats` view

2. **Premium Creator Breakdown (Table)**
   - ✅ Uses cache: Restored from `dubAnalysisResults.creator`
   - Fetches from: `premium_creator_breakdown` materialized view

3. **Portfolio Assets Breakdown (Metric Cards + Table)**
   - ✅ Uses cache: Restored from `dubAnalysisResults.creator`
   - Fetches from: `top_stocks_all_premium_creators`, `premium_creator_top_5_stocks`

4. **Premium Portfolio Breakdown (Table)**
   - ✅ Uses cache: Restored from `dubAnalysisResults.creator`
   - Fetches from: `portfolio_breakdown_with_metrics` view

5. **Premium Creator Retention (Table)**
   - ✅ Uses cache: Restored from `dubAnalysisResults.creator`
   - Fetches from: Aggregates `premium_creator_retention_events`

6. **Premium Creator Copy Affinity (Table)**
   - ❌ **DOES NOT use cache**: Always queries database on page load
   - Fetches from: `premium_creator_affinity_display` view
   - **This is why it survived the cache clear!**

---

## The Problem

When we cleared `dubAnalysisResults`:
- ✅ Affinity section loaded (queries DB directly)
- ❌ All other sections disappeared (expected cached HTML)

**Root cause**: Affinity section has different caching behavior than all other sections.

---

## Why Is Affinity Different?

Looking at the code:

```javascript
// Premium Creator Breakdown (cached)
async loadAndDisplayPremiumCreatorBreakdown() {
    const { data } = await this.supabaseIntegration.supabase
        .from('premium_creator_breakdown')
        .select('*');
    this.displayPremiumCreatorBreakdown(data);
    // HTML gets cached via saveToUnifiedCache()
}

// Premium Creator Affinity (NOT cached)
async loadAndDisplayPremiumCreatorAffinity() {
    const affinityData = await this.supabaseIntegration.loadPremiumCreatorCopyAffinity();
    this.displayPremiumCreatorAffinity(affinityData);
    // NO saveToUnifiedCache() call!
}
```

The affinity section:
1. Always fetches from DB on page load (line 187 in creator_analysis_tool_supabase.js)
2. Never saves HTML to cache
3. Never restores HTML from cache

**This is inconsistent with all other sections.**

---

## Options for Unified Strategy

### Option 1: Everything Uses Cache (Current Approach)
**Description**: Make affinity section consistent with others - cache HTML

**Pros**:
- Fast page loads (instant restore from cache)
- Consistent behavior across all sections
- Reduces DB queries

**Cons**:
- Requires "Sync Live Data" to see UI updates
- Stale data until sync is run
- Cache can get out of sync with DB

**Implementation**:
- Remove direct DB query from affinity on page load
- Make it restore from cache like other sections
- Only query DB during sync

### Option 2: Nothing Uses Cache (Always Fresh)
**Description**: Remove caching entirely - always query DB on page load

**Pros**:
- Always shows latest data
- No cache staleness issues
- UI updates reflect immediately on refresh
- Simpler code (no cache management)

**Cons**:
- Slower page loads (multiple DB queries)
- More load on Supabase
- Network latency affects UX

**Implementation**:
- Remove `restoreFromUnifiedCache()` calls
- Always run `loadAndDisplay*()` functions on page load
- Remove `saveToUnifiedCache()` calls

### Option 3: Hybrid with Smart Invalidation (Best of Both)
**Description**: Use cache but invalidate intelligently

**Pros**:
- Fast page loads from cache
- Auto-refresh when code changes detected
- Clear cache only when necessary

**Cons**:
- Most complex to implement
- Need version tracking per section

**Implementation**:
- Keep cache for performance
- Add version stamps to each cached section
- On refresh: Compare versions, rebuild only changed sections
- When toast clicked: Invalidate cache, fetch fresh data

---

## Recommendation

**Option 3: Hybrid with Smart Invalidation**

Here's why:
1. **Performance**: Cache gives us instant page loads (critical for UX)
2. **Freshness**: Smart invalidation ensures users see updates
3. **Consistency**: All sections behave the same way

### Proposed Implementation:

```javascript
// In version-checker.js refreshPage()
refreshPage() {
    // Mark cache as stale (don't delete it)
    localStorage.setItem('dubAnalysisCacheStale', 'true');
    localStorage.setItem(this.storageKey, CURRENT_VERSION);
    window.location.reload(true);
}

// In each tab's init
async init() {
    const cacheStale = localStorage.getItem('dubAnalysisCacheStale');

    if (cacheStale === 'true') {
        // Cache is stale - fetch fresh data
        localStorage.removeItem('dubAnalysisCacheStale');
        await this.syncLiveData(); // Rebuilds with fresh data
    } else {
        // Cache is good - restore from cache
        this.restoreFromUnifiedCache();

        // If cache is empty (first load), fetch data
        if (!this.outputContainer.innerHTML) {
            await this.syncLiveData();
        }
    }
}
```

This approach:
- ✅ Fast loads from cache (normal case)
- ✅ Auto-refreshes when toast is clicked
- ✅ Handles first-time visitors
- ✅ All sections behave consistently
- ✅ No data loss

---

## Action Items

### Immediate (Fix Affinity Inconsistency):
1. Make affinity section restore from cache on page load
2. Only query DB during sync, not on every page load
3. Add `saveToUnifiedCache()` after affinity loads

### Short-term (Smart Invalidation):
1. Implement cache staleness flag
2. Update `refreshPage()` to mark cache as stale
3. Update init functions to check staleness
4. Test across all 4 tabs

### Long-term (Version Per Section):
1. Add version stamps to each cached section
2. Only rebuild sections with version mismatches
3. Granular cache invalidation

---

## Testing Plan

1. **Test Cache Restore**: Hard refresh → all sections should load instantly from cache
2. **Test Sync**: Click "Sync Live Data" → all sections rebuild with fresh data
3. **Test Toast Refresh**: Click toast "Refresh" → all sections reload with fresh data
4. **Test First Load**: Clear all cache → sync should fetch data
5. **Test Consistency**: All 6 sections in Premium Creator tab should behave identically

---

## Questions

1. **Do you want fast page loads (cache) or always-fresh data (no cache)?**
2. **Is it acceptable to require "Sync" to see UI updates, or must refresh work?**
3. **Should we implement Option 1, 2, or 3?**
