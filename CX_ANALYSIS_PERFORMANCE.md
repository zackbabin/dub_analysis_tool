# CX Analysis Workflow Performance Analysis

## Current Architecture

The CX Analysis uses a 4-step fire-and-forget chain:

```
Step 1: sync-support-conversations (~30s)
  ↓ fire-and-forget
Step 2: sync-linear-issues (~10s)
  ↓ fire-and-forget
Step 3: analyze-support-feedback (~45-60s)
  ↓ fire-and-forget
Step 4: map-linear-to-feedback (~30-45s)

Total: ~2-3 minutes
```

## Performance Bottlenecks Analysis

### ✅ ALREADY OPTIMIZED

1. **Batch AI Matching** (Step 4: map-linear-to-feedback)
   - **Current**: Single Claude API call for all 10 issues (batch mode)
   - **Previous**: 10 separate API calls (sequential, one per issue)
   - **Improvement**: 10x faster, 90% cost reduction
   - **Status**: ✅ Already implemented (lines 165-261 in map-linear-to-feedback/index.ts)

2. **Regular Views Instead of Materialized** (Step 3)
   - **Current**: `enriched_support_conversations` is a regular view (auto-updates)
   - **Previous**: Materialized view requiring manual refresh
   - **Benefit**: No refresh overhead, always current data
   - **Status**: ✅ Already implemented (line 264 in analyze-support-feedback/index.ts)

3. **Limited Linear Issues** (Step 4)
   - **Current**: Loads 200 most recent Linear issues
   - **Benefit**: Reduces token count for Claude API calls
   - **Status**: ✅ Already implemented (line 300 in map-linear-to-feedback/index.ts)

4. **Direct Link Detection First** (Step 4)
   - **Current**: Checks for Zendesk-Linear integration links before AI matching
   - **Benefit**: Skips expensive AI calls when direct links exist
   - **Status**: ✅ Already implemented (Phase 1, lines 315-324 in map-linear-to-feedback/index.ts)

5. **Conversation Limit** (Step 3)
   - **Current**: Analyzes 250 most recent conversations
   - **Benefit**: Keeps Claude API input tokens manageable (~120K tokens)
   - **Status**: ✅ Already implemented (line 268 in analyze-support-feedback/index.ts)

### 🟡 MINOR OPTIMIZATION OPPORTUNITIES

#### 1. Parallel Steps 2 & 3 (Potential 10s savings)

**Current Flow:**
```
Step 1: sync-support-conversations (~30s)
  ↓ triggers Step 2
Step 2: sync-linear-issues (~10s)
  ↓ triggers Step 3
Step 3: analyze-support-feedback (~45-60s)
  ↓ triggers Step 4
Step 4: map-linear-to-feedback (~30-45s)
```

**Proposed Flow:**
```
Step 1: sync-support-conversations (~30s)
  ↓ triggers Steps 2 & 3 in parallel
Step 2: sync-linear-issues (~10s) ──┐
Step 3: analyze-support-feedback (~45-60s) ──┤
  ↓ both complete, then trigger Step 4
Step 4: map-linear-to-feedback (~30-45s)
```

**Analysis:**
- Step 3 doesn't depend on Step 2 (analyzes support data, not Linear data)
- Step 2 is short (10s), so parallel execution saves ~10s max
- Step 4 needs both Steps 2 & 3 to complete (needs Linear issues + analyzed feedback)
- **Complexity**: Would require updating fire-and-forget trigger logic to wait for both
- **Savings**: ~10 seconds (7% faster)
- **Recommendation**: ⚠️ Not worth the complexity for 10s savings

#### 2. Incremental Sync Optimization (Already Implemented)

**Current:**
- Uses `last_sync_timestamp` from `sync_status` table
- Only fetches new tickets since last sync
- Default 7-day lookback on first run

**Status**: ✅ Already optimal (lines 72-92 in sync-support-conversations/index.ts)

#### 3. Conversation Query Optimization

**Current Query** (analyze-support-feedback):
```typescript
await supabase
  .from('enriched_support_conversations')
  .select('*')
  .gte('created_at', startDate.toISOString())
  .lt('created_at', now.toISOString())
  .order('created_at', { ascending: false })
  .limit(250)
```

**Potential Improvement:**
- Only select needed columns instead of `*`
- Current columns used: id, external_id, source, title, description, created_at, status, priority, tags, custom_fields, message_count, all_messages

**Analysis:**
- View is indexed on created_at (fast filtering)
- Selecting fewer columns would reduce network transfer
- **Benefit**: Marginal (~1-2s on 250 rows)
- **Recommendation**: ⚠️ Low priority

### 🔴 NO MAJOR BOTTLENECKS FOUND

The CX Analysis workflow is **already well-optimized**:

1. ✅ Batch AI processing (10x faster than sequential)
2. ✅ Regular views (no refresh overhead)
3. ✅ Direct link detection (avoids unnecessary AI calls)
4. ✅ Incremental sync (only new data)
5. ✅ Limited data sets (250 conversations, 200 Linear issues)
6. ✅ Fire-and-forget architecture (no blocking)

## Performance Breakdown

| Step | Duration | Can Optimize? | Notes |
|------|----------|---------------|-------|
| 1. sync-support-conversations | ~30s | ❌ No | External API calls (Zendesk), already incremental |
| 2. sync-linear-issues | ~10s | ❌ No | GraphQL API, fetches all recent issues |
| 3. analyze-support-feedback | ~45-60s | ❌ No | Claude API, 250 conversations = ~120K tokens |
| 4. map-linear-to-feedback | ~30-45s | ✅ Already optimized | Batch AI matching (was 10x slower) |

**Total: ~2-3 minutes**

## Cost Analysis

**Per Run:**
- analyze-support-feedback: ~$0.18 (120K input + 10K output)
- map-linear-to-feedback: ~$0.10 (batch mode, single API call)
- **Total**: ~$0.28 per analysis

**Monthly (daily runs):** ~$8.40

**Status**: ✅ Cost is minimal, batch optimization already implemented

## Recommendations

### Priority 1: ✅ Already Implemented
- Batch AI matching for Linear issue mapping
- Regular views instead of materialized views
- Direct link detection before AI matching
- Incremental sync for support tickets

### Priority 2: 🟡 Low Impact (Not Recommended)
- Parallel Steps 2 & 3 execution (saves ~10s, adds complexity)
- Column selection in queries (saves ~1-2s, reduces maintainability)

### Priority 3: ✅ No Action Needed
- Workflow is already well-optimized
- No major bottlenecks detected
- Cost is minimal ($8.40/month)
- Performance is acceptable (2-3 min total, background execution)

## Conclusion

The CX Analysis workflow has **no significant performance bottlenecks**. All major optimizations have already been implemented:

1. **Batch AI processing** - 10x faster than sequential API calls
2. **Fire-and-forget chain** - No blocking, runs in background
3. **Incremental sync** - Only fetches new data
4. **Smart AI usage** - Direct link detection first, batch processing, limited data sets

The workflow completes in 2-3 minutes running entirely in the background, which is acceptable for a daily automation task. Further optimization would provide minimal benefit (5-10% improvement) at the cost of increased complexity.

**Status**: ✅ No performance work needed
