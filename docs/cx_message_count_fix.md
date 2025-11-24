# CX Message Count Fix - Architecture Change

## Problem

The `message_count` column in `raw_support_conversations` was not being populated after syncing support messages. Investigation revealed that `sync-support-messages` was hitting "CPU Time exceeded" timeouts before reaching the message count update code.

### Root Cause

The `sync-support-messages` function was processing 20k+ messages in batches and timing out before it could update the `message_count` column. Even with incremental updates after each batch, the additional CPU overhead was still causing timeouts.

## Solution

**Decoupled message counting into a separate edge function** that runs independently after message sync completes.

### New Architecture

```
1. sync-support-conversations  → Stores tickets
2. sync-support-messages       → Stores messages (no counting)
3. update-support-message-counts → Updates message_count column
4. analyze-support-feedback    → Runs Claude AI analysis
```

### Benefits

✅ **Reduces timeout risk**: `sync-support-messages` focuses solely on syncing messages
✅ **Independent execution**: Count updates run separately with no time pressure
✅ **Retryable**: Can retry count updates without re-syncing thousands of messages
✅ **Repair function**: Can run standalone anytime to fix message counts
✅ **Better separation of concerns**: Sync vs calculation logic decoupled
✅ **Maintainability**: Easier to debug and optimize each function independently

## Implementation Details

### New Edge Function: `update-support-message-counts`

**Location**: `/supabase/functions/update-support-message-counts/index.ts`

**Purpose**: Updates `message_count` in `raw_support_conversations` based on `support_conversation_messages`

**How it works**:
1. Fetches all unique `(conversation_source, conversation_id)` pairs from `support_conversation_messages`
2. Calls `update_support_message_counts()` RPC function for each source
3. Verifies counts were updated by checking sample conversations
4. No timeout risk since it only runs SQL aggregation (no external API calls)

**Can be invoked**:
- Automatically as part of CX Analysis workflow
- Manually via Supabase dashboard for repairs
- As a scheduled job if needed

### Updated Workflow

**File**: `/Users/zack/dub_analysis_tool/supabase_integration.js`

**Function**: `triggerSupportAnalysis()`

**Changes**:
- Added step 4: Call `update-support-message-counts` after messages are synced
- Runs sequentially after `sync-support-messages` completes
- Errors logged but don't block workflow (graceful degradation)
- Results included in sync_summary response

### Updated sync-support-messages

**File**: `/supabase/functions/sync-support-messages/index.ts`

**Changes**:
- Removed `updateMessageCounts()` helper function
- Removed incremental count updates after each batch
- Simplified to focus only on fetching and storing messages
- Added log message: "Run update-support-message-counts to populate message_count column"

## Testing

To verify the fix works:

1. **Trigger CX Analysis workflow** (click Sync button in CX Analysis tab)
2. **Check console logs**:
   ```
   → 1/4: Support conversations (Zendesk)
     ✓ 1/4: Conversations synced
   → 2-3/4: Support messages + Linear issues (parallel)
     ✓ 2-3/4: Both synced
   → 4/4: Updating message counts
     ✓ 4/4: Message counts updated
   ```
3. **Verify in database**:
   ```sql
   SELECT id, subject, message_count
   FROM raw_support_conversations
   WHERE source = 'zendesk'
   ORDER BY updated_at DESC
   LIMIT 10;
   ```
   Should see non-null `message_count` values

## Rollback Plan

If this approach causes issues:

1. Revert commit `3b7f617`
2. Re-apply the incremental update approach from previous attempt
3. Or accept that message counts may be incomplete for timeout cases

## Future Enhancements

- Schedule `update-support-message-counts` to run hourly as repair job
- Add Supabase webhook to auto-run after message inserts
- Create monitoring alert if message_count is NULL for recent conversations
- Consider materializing counts in a view instead of denormalizing

## Related Files

- `/supabase/functions/update-support-message-counts/index.ts` (new)
- `/supabase/functions/sync-support-messages/index.ts` (modified)
- `/supabase_integration.js` (modified - triggerSupportAnalysis)
- `/supabase/migrations/20251123_add_update_message_counts_function.sql` (RPC function)

## Commit

```
commit 3b7f617
Author: Zack
Date:   2025-11-24

Decouple message count updates into separate edge function
```
