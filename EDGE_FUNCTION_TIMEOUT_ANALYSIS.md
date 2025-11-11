# Edge Function Timeout Analysis - sync-mixpanel-engagement

## Problem
The `sync-mixpanel-engagement` Edge Function is timing out (60 second limit on Supabase hosted platform).

## Current Flow
1. **Fetch Mixpanel data** (~5-15 seconds) - 3 charts in parallel
2. **Process data** (~1-5 seconds) - Transform to database format
3. **Upsert portfolio-creator pairs** (~10-30 seconds) - Sequential batches of 500
4. **Upsert creator pairs** (~5-15 seconds) - Sequential batches of 500
5. **Trigger background tasks** (~0 seconds) - Fire-and-forget

**Total: 21-65 seconds** (can exceed 60s limit with large datasets)

## Bottleneck Analysis

### Current Upsert Pattern (Sequential)
```typescript
// Portfolio-creator pairs (can be 10,000+ records)
for (let i = 0; i < portfolioCreatorPairs.length; i += 500) {
  const batch = portfolioCreatorPairs.slice(i, i + 500)
  await supabase.from('table').upsert(batch) // ~0.5-1.5s per batch
}
```

**Problem:** If we have 10,000 records:
- 20 batches × 1 second/batch = 20 seconds
- 20 batches × 1.5 seconds/batch = 30 seconds

## Solutions

### Option 1: Parallel Batch Processing ⚡ (Fastest)
Process multiple batches concurrently (5-10 at a time):
```typescript
const BATCH_SIZE = 1000  // Larger batches
const MAX_CONCURRENT = 5  // Process 5 batches in parallel

const batches = []
for (let i = 0; i < data.length; i += BATCH_SIZE) {
  batches.push(data.slice(i, i + BATCH_SIZE))
}

// Process in chunks of MAX_CONCURRENT
for (let i = 0; i < batches.length; i += MAX_CONCURRENT) {
  const chunk = batches.slice(i, i + MAX_CONCURRENT)
  await Promise.all(chunk.map(batch =>
    supabase.from('table').upsert(batch)
  ))
}
```

**Impact:**
- 10,000 records / 1000 per batch = 10 batches
- 10 batches / 5 concurrent = 2 rounds
- 2 rounds × 1.5s/round = 3 seconds (vs 20-30 seconds)
- **Saves 15-27 seconds** ✅

### Option 2: Increase Batch Size
Change from 500 to 2000 records per batch:
```typescript
const batchSize = 2000  // Up from 500
```

**Impact:**
- 10,000 records / 2000 per batch = 5 batches (vs 20)
- 5 batches × 1s/batch = 5 seconds (vs 20 seconds)
- **Saves 15 seconds** ✅

### Option 3: Early Timeout Detection
Track elapsed time and return early if approaching limit:
```typescript
const startTime = Date.now()
const TIMEOUT_BUFFER = 5000  // Leave 5s buffer

if (Date.now() - startTime > 55000) {  // 55 seconds
  console.warn('Approaching timeout, returning partial results')
  return createSuccessResponse('Partial sync completed', stats)
}
```

**Impact:**
- Prevents function from timing out
- User gets partial results
- **Prevents error, enables incremental progress** ✅

### Option 4: Split Into Multiple Functions
Create separate functions:
- `sync-mixpanel-engagement-fetch` - Just fetch and store raw data
- `sync-mixpanel-engagement-process` - Process and upsert (triggered by first)

**Impact:**
- Each function stays under 60s
- More complex architecture
- **Good for very large datasets** ✅

## Recommended Approach

**Combination of Options 1 + 2 + 3:**

1. **Increase batch size** to 1000 (from 500)
2. **Add parallel processing** - 5 concurrent batches
3. **Add timeout detection** - Return partial results if needed

**Expected improvement:**
- Current worst case: 65 seconds (timeout)
- New worst case: ~25 seconds (well under limit)
- **Saves 40 seconds, eliminates timeouts** ✅

## Implementation Priority

1. **HIGH**: Parallel batch processing (biggest impact)
2. **MEDIUM**: Increase batch size (easy, significant impact)
3. **LOW**: Timeout detection (safety net)
4. **FUTURE**: Split functions (if parallel still times out)
