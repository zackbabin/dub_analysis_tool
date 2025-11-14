# Universal Resilient Data Loading Pattern

## Problem Statement
Previously, if any Mixpanel API call failed (rate limit, timeout, etc.), the entire section would show an error and no data would be displayed, even if we had cached data in the database.

## Solution
Use the **universal `loadAndDisplayWithFallback`** pattern for ALL data loading across all tabs.

## Pattern Overview
```
1. Try to sync fresh data from API (non-blocking, can fail)
2. Always load from database (regardless of sync success)
3. Display data if available (even if stale)
4. Show warning banner if sync failed but data exists
5. Only show "no data" message if database is truly empty
```

## Implementation

### Step 1: Add Database Load Function
For each section, create a database load function if it doesn't exist:

```javascript
// Example in supabase_integration.js
async loadCreatorRetentionFromDatabase() {
    const { data, error } = await this.supabase
        .from('premium_creator_retention_analysis')
        .select('*')
        .order('cohort_date', { ascending: false });

    if (error) throw error;

    return {
        rawData: data,
        success: true,
        source: 'database'
    };
}
```

### Step 2: Update Display Function
Update display function to accept `syncFailed` parameter and show warning:

```javascript
displayPremiumCreatorRetention(retentionData, syncFailed = false) {
    const section = document.createElement('div');

    // Show warning banner if sync failed
    if (syncFailed) {
        const warning = this.supabaseIntegration.createStaleDataWarning(
            'Unable to refresh data from Mixpanel. Showing cached data from database.'
        );
        section.appendChild(warning);
    }

    // ... rest of display logic
}
```

### Step 3: Use Universal Pattern
Replace old loading logic with the universal pattern:

```javascript
async loadAndDisplaySection() {
    const container = document.getElementById('sectionContainer');

    // UNIVERSAL PATTERN - Use this everywhere!
    await this.supabaseIntegration.loadAndDisplayWithFallback({
        // Optional: Function to sync fresh data
        syncFunction: async () => await this.supabaseIntegration.syncFromAPI(),

        // Required: Function to load from database
        loadFunction: async () => await this.supabaseIntegration.loadFromDatabase(),

        // Required: Section name for logging
        dataLabel: 'section name',

        // Required: DOM container
        container: container,

        // Required: Display function
        displayFunction: (data, syncFailed, container) => {
            this.displaySection(data, syncFailed);
        },

        // Optional: Message when no data exists
        emptyMessage: 'No data available yet. Click "Sync Live Data" to fetch.'
    });
}
```

## Sections That Need This Pattern

### User Analysis Tab
- [ ] Demographics/Breakdown (main_analysis view)
- [ ] Subscription Pricing Distribution
- [ ] Copy Patterns Analysis
- [ ] Subscription Patterns Analysis
- [ ] Event Sequences Analysis

### Creator Analysis Tab
- [x] Premium Creator Retention (DONE)
- [ ] Creator Profiles
- [ ] Portfolio Metrics
- [ ] Premium Creator Stats

### Summary Tab
- [ ] Marketing Metrics
- [ ] Engagement Summary
- [ ] Conversion Summary

## Benefits
1. **Resilience**: Sections never fail completely if API is down
2. **User Experience**: Users always see data (even if slightly stale)
3. **Transparency**: Warning banners inform users when data might be stale
4. **Consistency**: Same pattern across all sections
5. **Debugging**: Better logging shows exactly where failures occur

## Migration Checklist

For each section:
1. ✅ Identify database table/view for the section
2. ✅ Create `load{Section}FromDatabase()` method
3. ✅ Update display function to accept `syncFailed` parameter
4. ✅ Add warning banner logic in display function
5. ✅ Replace old loading code with `loadAndDisplayWithFallback`
6. ✅ Test with API failure (disconnect internet, simulate rate limit)

## Example: Before and After

### Before (Fragile)
```javascript
async loadSection() {
    try {
        // If this fails, entire section breaks
        const data = await this.fetchFromMixpanel();
        this.displaySection(data);
    } catch (error) {
        container.innerHTML = 'Failed to load data'; // User sees nothing!
    }
}
```

### After (Resilient)
```javascript
async loadSection() {
    await this.supabaseIntegration.loadAndDisplayWithFallback({
        syncFunction: async () => await this.fetchFromMixpanel(),
        loadFunction: async () => await this.loadFromDatabase(),
        dataLabel: 'section',
        container: document.getElementById('container'),
        displayFunction: (data, syncFailed) => this.displaySection(data, syncFailed)
    });
}
```

## Notes
- The `syncFunction` is **optional** - omit it for sections that only load from database
- The `loadFunction` is **required** - must always have a database source
- All display functions must support the `syncFailed` parameter (can default to false)
- Use `createStaleDataWarning()` helper for consistent warning styling
