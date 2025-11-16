# Sync Optimization Test Plan

**Date:** 2025-11-16
**Optimizations Implemented:**
1. Set-based DB upsert function (REPLACE strategy)
2. Incremental event sync with watermark tracking
3. Change detection for user properties sync

---

## Prerequisites

Before testing, ensure:
- [ ] All migration files have been reviewed
- [ ] Backup of `subscribers_insights` table created
- [ ] Test environment available (staging or local Supabase)
- [ ] Baseline metrics captured (current sync times, event counts)

---

## Optimization #1: Set-Based DB Upsert

### Files Changed
- `/supabase/migrations/20251116_optimize_upsert_set_based.sql` - New optimized function
- `/supabase/migrations/20251116_verify_upsert_optimization.sql` - Verification script

### Test 1.1: Functional Equivalence Verification

**Objective:** Prove set-based version produces identical results to loop-based version

**Steps:**
```sql
-- Run verification script
\i supabase/migrations/20251116_verify_upsert_optimization.sql
```

**Expected Results:**
```
NOTICE: ✅ SUCCESS: Both versions produce IDENTICAL results!
NOTICE: Row counts match: 2
```

**Pass Criteria:**
- No WARNING messages about mismatches
- All field comparisons pass
- Row counts match exactly

---

### Test 1.2: Performance Comparison

**Objective:** Measure speedup of set-based vs. loop-based approach

**Setup:**
```sql
-- Create test data (250 profiles - typical batch size)
\timing on
```

**Test Loop-Based (OLD):**
```typescript
// In a test Edge Function or psql
SELECT upsert_subscribers_incremental('[...250 profiles...]'::jsonb);
-- Record execution time
```

**Test Set-Based (NEW):**
```typescript
// Same test data
SELECT upsert_subscribers_incremental('[...250 profiles...]'::jsonb);
// After running 20251116_optimize_upsert_set_based.sql
-- Record execution time
```

**Expected Results:**
- Old (loop): ~500-1000ms for 250 records
- New (set-based): ~50-100ms for 250 records
- Speedup: 10-20x faster

**Pass Criteria:**
- New version completes in <200ms for 250 records
- At least 5x faster than loop version
- No errors during execution

---

### Test 1.3: Real Sync Integration Test

**Objective:** Verify optimization works in actual sync function

**Steps:**
1. Deploy optimized function to test environment
2. Trigger `sync-mixpanel-user-events` manually
3. Monitor logs for chunk processing times

**Expected Log Output:**
```
✓ Processed 250 events, 180 users upserted (2s elapsed)
✓ Processed 500 events, 350 users upserted (4s elapsed)
...
```

**Pass Criteria:**
- Sync completes successfully
- No "statement timeout" errors
- Chunk processing faster than before (<1s per 250-user chunk)
- Final user counts in DB match expected values

---

### Test 1.4: Data Integrity Check

**Objective:** Ensure no data loss or corruption after optimization

**Steps:**
```sql
-- Before migration: capture baseline
SELECT
  COUNT(*) as total_users,
  SUM(total_copies) as total_copies_sum,
  SUM(total_subscriptions) as total_subscriptions_sum,
  SUM(app_sessions) as total_sessions_sum
FROM subscribers_insights;

-- After migration and full sync: compare
SELECT
  COUNT(*) as total_users,
  SUM(total_copies) as total_copies_sum,
  SUM(total_subscriptions) as total_subscriptions_sum,
  SUM(app_sessions) as total_sessions_sum
FROM subscribers_insights;
```

**Pass Criteria:**
- Row counts match or increase (never decrease)
- Aggregate metrics match expected values
- No NULL values where data should exist
- Sample random users - verify their counts are correct

---

## Optimization #2: Incremental Event Sync with Watermark

### Files Changed
- `/supabase/migrations/20251116_create_sync_watermarks_table.sql` - Watermark table
- `/supabase/migrations/20251116_create_incremental_add_upsert.sql` - ADD-strategy function
- `/supabase/migrations/20251116_add_incremental_sync_to_user_events.md` - Implementation guide

### Test 2.1: Watermark Table Creation

**Objective:** Verify watermark table and functions created successfully

**Steps:**
```sql
-- Check table exists
\d sync_watermarks

-- Check initial watermark
SELECT * FROM sync_watermarks WHERE source = 'mixpanel_user_events';

-- Test upsert_sync_watermark function
SELECT upsert_sync_watermark(
  'test_source',
  NOW() - INTERVAL '1 day',
  1000,
  'Test watermark'
);

SELECT * FROM sync_watermarks WHERE source = 'test_source';
```

**Expected Results:**
- Table has all required columns
- Initial watermark set to 45 days ago
- Upsert function works correctly
- total_events_synced accumulates on repeated calls

**Pass Criteria:**
- All schema objects exist
- Permissions granted correctly
- Functions execute without errors

---

### Test 2.2: ADD-Strategy Function Verification

**Objective:** Verify new ADD-strategy function accumulates counts correctly

**Setup:**
```sql
-- Create test data
CREATE TEMP TABLE test_users (LIKE subscribers_insights INCLUDING ALL);

INSERT INTO test_users (distinct_id, total_copies, total_subscriptions)
VALUES ('user1', 10, 2);
```

**Test:**
```sql
-- First upsert: ADD 5 copies, 1 subscription
SELECT upsert_subscribers_incremental_add('[
  {
    "distinct_id": "user1",
    "total_copies": 5,
    "total_subscriptions": 1,
    "total_regular_copies": 5,
    "total_premium_copies": 0,
    ... (all required fields)
  }
]'::jsonb);

-- Check result
SELECT distinct_id, total_copies, total_subscriptions
FROM subscribers_insights
WHERE distinct_id = 'user1';

-- Should show: user1, 15 (10+5), 3 (2+1)
```

**Expected Results:**
- total_copies = 15 (10 + 5)
- total_subscriptions = 3 (2 + 1)
- Other counts also added correctly

**Pass Criteria:**
- Counts are added, not replaced
- New users inserted correctly (no existing record)
- All fields handled properly (linked_bank_account OR logic, timestamp LEAST/GREATEST)

---

### Test 2.3: First Sync (No Watermark)

**Objective:** Verify first sync uses 45-day window and sets watermark

**Steps:**
1. Delete watermark: `DELETE FROM sync_watermarks WHERE source = 'mixpanel_user_events';`
2. Trigger sync manually
3. Check logs and watermark

**Expected Log Output:**
```
FIRST SYNC MODE: No watermark found, fetching 45-day window 2025-10-02 to 2025-11-15
Sync mode: FULL WINDOW (REPLACE)
✓ Streaming complete: 95000 events processed, 5200 users upserted
✓ Updated watermark for mixpanel_user_events to 2025-11-15T23:59:45Z
```

**Expected Database State:**
```sql
SELECT
  source,
  last_event_time,
  total_events_synced
FROM sync_watermarks
WHERE source = 'mixpanel_user_events';

-- Should show: watermark set to latest event time from sync
```

**Pass Criteria:**
- Sync uses 45-day window (same as before optimization)
- Uses REPLACE strategy (upsert_subscribers_incremental)
- Watermark created with correct timestamp
- User counts match baseline (no data loss)

---

### Test 2.4: Second Sync (Incremental with Watermark)

**Objective:** Verify incremental sync fetches only new events and uses ADD strategy

**Steps:**
1. Wait 1 hour (or simulate by manually adjusting watermark)
2. Trigger sync again
3. Monitor logs

**Expected Log Output:**
```
✓ Found watermark for mixpanel_user_events: 2025-11-15T23:59:45Z
INCREMENTAL MODE: Fetching events since 2025-11-15T23:59:45Z (with 2h overlap)
  Date range: 2025-11-15 to 2025-11-16
Sync mode: INCREMENTAL (ADD)
✓ Streaming complete: 2500 events processed, 450 users upserted
✓ Updated watermark for mixpanel_user_events to 2025-11-16T14:30:22Z
```

**Expected Results:**
- Much fewer events processed (~2-5K instead of 95K)
- Faster execution time (~10-20s instead of 90-120s)
- User counts increased (not replaced)
- Watermark advanced

**Verification Query:**
```sql
-- Check that counts increased for existing users
SELECT
  distinct_id,
  total_copies,
  total_subscriptions,
  updated_at
FROM subscribers_insights
WHERE distinct_id = 'known_active_user'
ORDER BY updated_at DESC
LIMIT 5;

-- Counts should have increased from previous sync
```

**Pass Criteria:**
- Event count dramatically reduced (80-95% fewer events)
- Execution time reduced (80-85% faster)
- Existing user counts increased (ADD strategy working)
- New users inserted correctly
- Watermark advanced to latest event time

---

### Test 2.5: Overlap Window Handling

**Objective:** Verify 2-hour overlap prevents data loss from late-arriving events

**Scenario:**
- Watermark at 2025-11-15 22:00:00
- New sync should fetch events from 2025-11-15 20:00:00 (2h earlier) to 2025-11-16 00:00:00

**Steps:**
1. Check watermark timestamp
2. Trigger sync
3. Verify fromDate in logs includes 2h buffer

**Expected Log Output:**
```
INCREMENTAL MODE: Fetching events since 2025-11-15T22:00:00Z (with 2h overlap)
  Date range: 2025-11-15 to 2025-11-16
```

**Pass Criteria:**
- fromDate is 2 hours before watermark
- Events in overlap window processed correctly
- No duplicate counting issues (ADD strategy handles overlap gracefully)

---

### Test 2.6: Error Recovery

**Objective:** Verify failed syncs don't update watermark (no data loss)

**Steps:**
1. Simulate sync failure (e.g., timeout, API error)
2. Check watermark - should NOT advance
3. Retry sync - should fetch same events again

**Expected Behavior:**
- Watermark unchanged after failed sync
- Retry sync starts from same watermark
- No events lost

**Pass Criteria:**
- Watermark only updated on successful sync
- Failed syncs are logged but don't corrupt state
- Retry syncs are idempotent

---

### Test 2.7: Force Full Sync

**Objective:** Verify force_full_sync parameter bypasses incremental logic

**Steps:**
```bash
curl -X POST https://your-project.supabase.co/functions/v1/sync-mixpanel-user-events \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"force_full_sync": true}'
```

**Expected Log Output:**
```
FULL SYNC MODE (forced): Date range 2025-10-02 to 2025-11-15 (45 days)
Sync mode: FULL WINDOW (REPLACE)
```

**Pass Criteria:**
- Ignores watermark
- Fetches full 45-day window
- Uses REPLACE strategy
- Useful for data reconciliation or backfill

---

## Optimization #3: User Properties Change Detection

### Files Changed
- `/supabase/functions/sync-mixpanel-user-properties-v2/index.ts` - Added change detection logic

### Test 3.1: Change Detection Logic

**Objective:** Verify hasUserPropertiesChanged function detects changes correctly

**Unit Test Scenarios:**

```typescript
// Scenario 1: New user (no existing record)
const result1 = hasUserPropertiesChanged(null, { distinct_id: 'user1', income: '$50K-$75K' })
// Expected: true (new user, needs insert)

// Scenario 2: No changes
const existing = { distinct_id: 'user1', income: '$50K-$75K', total_deposits: 1000 }
const incoming = { distinct_id: 'user1', income: '$50K-$75K', total_deposits: 1000 }
const result2 = hasUserPropertiesChanged(existing, incoming)
// Expected: false (no changes, skip update)

// Scenario 3: Field changed
const existing3 = { distinct_id: 'user1', income: '$50K-$75K', total_deposits: 1000 }
const incoming3 = { distinct_id: 'user1', income: '$75K-$100K', total_deposits: 1000 }
const result3 = hasUserPropertiesChanged(existing3, incoming3)
// Expected: true (income changed, needs update)

// Scenario 4: Null vs undefined (should be treated as same)
const existing4 = { distinct_id: 'user1', income: null }
const incoming4 = { distinct_id: 'user1', income: undefined }
const result4 = hasUserPropertiesChanged(existing4, incoming4)
// Expected: false (null == undefined, no change)
```

**Pass Criteria:**
- All scenarios return correct boolean
- Null/undefined handled safely
- Empty strings normalized to null
- Numeric fields compared correctly

---

### Test 3.2: Real Sync with Change Detection

**Objective:** Verify change detection reduces unnecessary upserts in real sync

**Steps:**
1. Run properties sync twice in succession (properties unlikely to change in minutes)
2. Compare logs between runs

**First Sync Expected Output:**
```
Starting bulk upsert with change detection for 3000 users...
  Batch 1: 250 changed, 0 unchanged (skipped)
  Batch 2: 248 changed, 2 unchanged (skipped)
  ...
✓ Finished bulk upsert: 2985 updated/new, 15 skipped (unchanged)
  Efficiency: 0% of users had no changes
```

**Second Sync (Immediately After) Expected Output:**
```
Starting bulk upsert with change detection for 3000 users...
  Batch 1: 12 changed, 238 unchanged (skipped)
  Batch 2: 8 changed, 242 unchanged (skipped)
  ...
✓ Finished bulk upsert: 145 updated/new, 2855 skipped (unchanged)
  Efficiency: 95% of users had no changes
```

**Pass Criteria:**
- Second sync shows high skip rate (70-95%)
- Execution time reduced for second sync
- Users with actual changes still updated
- No "all skipped" edge case (some users always have activity)

---

### Test 3.3: Fallback Behavior on Error

**Objective:** Verify safe fallback when change detection fails

**Simulate Error:**
```typescript
// Temporarily break SELECT query (e.g., wrong table name)
// Trigger sync
```

**Expected Log Output:**
```
Error fetching existing records for comparison: relation "wrong_table" does not exist
Falling back to upserting all records in batch (no change detection)
✓ Upserted batch 1: 250/3000 users
```

**Pass Criteria:**
- Error logged but doesn't crash sync
- Falls back to upserting all records (no optimization, but no data loss)
- Sync completes successfully despite error

---

### Test 3.4: Performance Comparison

**Objective:** Measure improvement from skipping unchanged users

**Benchmark:**
1. Disable change detection (comment out filter logic)
2. Run sync, record time
3. Re-enable change detection
4. Run sync again (same users), record time

**Expected Results:**
- Without detection: ~60-90s for 3000 users (all upserted)
- With detection (2nd run): ~15-30s for 3000 users (~80-90% skipped)
- Speedup: 50-75% faster

**Pass Criteria:**
- Measurable time savings when most users unchanged
- DB write volume reduced significantly
- No accuracy loss

---

## Integration Tests

### Test I.1: End-to-End Sync Pipeline

**Objective:** Verify all three optimizations work together

**Steps:**
1. Deploy all migrations to test environment
2. Run full sync cycle:
   - User properties sync (with change detection)
   - User events sync (incremental with watermark)
3. Verify data integrity

**Expected Flow:**
```
1. Properties Sync:
   - Fetches 3000 users from Mixpanel
   - Compares with DB, skips 2700 unchanged
   - Upserts 300 changed users
   - Uses optimized set-based upsert (fast)
   - Completes in ~20s

2. Events Sync:
   - Checks watermark (found)
   - Fetches incremental window (2500 events vs 95000)
   - Uses ADD strategy for event counts
   - Uses optimized set-based upsert (fast)
   - Updates watermark
   - Completes in ~15s

Total: ~35s (vs ~150s before optimization = 77% faster)
```

**Pass Criteria:**
- Both syncs complete successfully
- Data integrity maintained
- Cumulative time savings match expectations
- No errors or warnings

---

### Test I.2: Multiple Sync Cycles

**Objective:** Verify optimizations work correctly over multiple sync cycles

**Steps:**
1. Run 5 consecutive sync cycles (1 hour apart)
2. Monitor each cycle for:
   - Execution time
   - Events/users processed
   - Watermark progression
   - Data accuracy

**Expected Pattern:**
- Cycle 1: First sync or full sync (slow, many events)
- Cycles 2-5: Incremental syncs (fast, few events)
- Watermark advances each time
- User counts accumulate correctly

**Pass Criteria:**
- Consistent fast performance for incremental syncs
- No degradation over time
- Watermark advances properly
- Counts accumulate correctly (no double-counting or data loss)

---

## Rollback Tests

### Test R.1: Rollback Optimization #1 (DB Upsert)

**Objective:** Verify we can revert to loop-based function if needed

**Steps:**
```sql
-- Rollback: restore old function
\i supabase/migrations/20251115_change_upsert_to_replace_strategy.sql

-- Verify old behavior restored
SELECT upsert_subscribers_incremental('[...]'::jsonb);
```

**Pass Criteria:**
- Old function works identically to before
- No data loss or corruption
- Sync functions still work (slower, but functional)

---

### Test R.2: Rollback Optimization #2 (Incremental Sync)

**Objective:** Verify we can disable incremental sync if issues arise

**Steps:**
1. Add `force_full_sync: true` to all sync requests
2. Verify syncs use full 45-day window
3. Or drop watermarks table and functions

**Pass Criteria:**
- Full sync mode works identically to original implementation
- No dependency on watermarks when forced to full sync
- Can toggle between modes without data loss

---

### Test R.3: Rollback Optimization #3 (Change Detection)

**Objective:** Verify we can disable change detection if needed

**Steps:**
1. Comment out change detection logic in TypeScript
2. Redeploy function
3. Verify all users always upserted (no skipping)

**Pass Criteria:**
- Function works without change detection
- No errors or crashes
- Data integrity maintained

---

## Monitoring & Validation

### Metrics to Track Post-Deployment

**Performance Metrics:**
- [ ] Event sync execution time: Target <20s (was 90-120s)
- [ ] Properties sync execution time: Target <30s (was 60-90s)
- [ ] Events processed per sync: Target 5-10K (was 95K)
- [ ] DB CPU usage: Target 60-80% reduction
- [ ] Timeout frequency: Target 0 (was occasional)

**Data Quality Metrics:**
- [ ] User count growth rate (should match historical rate)
- [ ] Event count totals (should accumulate correctly)
- [ ] Watermark progression (should advance with each sync)
- [ ] Skipped users percentage (should stabilize at 70-90%)

**Alerting Thresholds:**
- [ ] Sync duration >60s → Alert (potential issue)
- [ ] Events processed >50K → Alert (incremental sync may have failed)
- [ ] Watermark not advancing for 6 hours → Alert (sync failures)
- [ ] Zero skipped users for 3 consecutive properties syncs → Alert (change detection may have broken)

---

## Sign-Off Checklist

Before deploying to production:

### Pre-Deployment
- [ ] All unit tests passed
- [ ] All integration tests passed
- [ ] All rollback tests passed
- [ ] Code review completed
- [ ] Migration scripts reviewed
- [ ] Backup of production data taken

### Deployment
- [ ] Migrations applied in correct order
- [ ] Functions deployed successfully
- [ ] Initial watermark set correctly
- [ ] Test sync run manually (small test)

### Post-Deployment
- [ ] Monitor first 3 sync cycles closely
- [ ] Verify metrics match expectations
- [ ] Check for errors in logs
- [ ] Validate data integrity
- [ ] Update documentation

### 24-Hour Check
- [ ] Performance improvements sustained
- [ ] No data quality issues detected
- [ ] No user-facing errors
- [ ] Rollback plan tested and ready if needed

---

## Troubleshooting Guide

### Issue: Set-based upsert slower than expected

**Possible Causes:**
- Missing indexes on subscribers_insights(distinct_id)
- Large batch size causing statement timeout
- Network latency between Edge Function and database

**Debug Steps:**
1. Check EXPLAIN ANALYZE output for upsert query
2. Verify index exists and is being used
3. Reduce batch size temporarily
4. Check database connection pool status

---

### Issue: Incremental sync not advancing watermark

**Possible Causes:**
- No new events in Mixpanel
- Sync failing before watermark update
- Permissions issue on sync_watermarks table

**Debug Steps:**
1. Check sync_logs for errors
2. Manually query sync_watermarks table
3. Verify upsert_sync_watermark function works
4. Check Mixpanel API for recent events

---

### Issue: Change detection skipping all users

**Possible Causes:**
- Field comparison logic too strict
- Null handling issue
- Properties not actually changing in Mixpanel

**Debug Steps:**
1. Add detailed logging to hasUserPropertiesChanged
2. Sample random users - compare DB vs Mixpanel values
3. Check Mixpanel last_seen timestamps
4. Temporarily disable change detection to verify baseline

---

## Success Criteria Summary

Optimization is considered successful if:

✅ **Performance:**
- Event sync: 80-85% faster (90-120s → 10-20s)
- Properties sync: 50-75% faster (60-90s → 15-30s)
- DB CPU usage: 60-80% lower

✅ **Data Quality:**
- No data loss (user counts match or increase)
- Event counts accumulate correctly
- No duplicate counting issues

✅ **Reliability:**
- Zero timeouts during sync
- Error rate unchanged or improved
- Successful rollback capability proven

✅ **Maintainability:**
- Clear logging and monitoring
- Documented troubleshooting procedures
- Team trained on new behavior
