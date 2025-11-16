# Incremental Sync Implementation for sync-mixpanel-user-events

## Changes Required

This document outlines the modifications needed to enable true incremental event syncing with watermark tracking.

### 1. Database Setup (COMPLETED)
- ✓ Created `sync_watermarks` table
- ✓ Created `upsert_subscribers_incremental_add` function (ADD strategy)
- ✓ Existing `upsert_subscribers_incremental` kept for backward compatibility (REPLACE strategy)

### 2. Function Modifications (TO IMPLEMENT)

Add the following helper functions to `/supabase/functions/sync-mixpanel-user-events/index.ts`:

```typescript
/**
 * Get last sync watermark from database
 * Returns null if no watermark exists (first sync)
 */
async function getLastSyncWatermark(supabase: any, source: string): Promise<Date | null> {
  try {
    const { data, error } = await supabase
      .from('sync_watermarks')
      .select('last_event_time')
      .eq('source', source)
      .maybeSingle()

    if (error) {
      console.error('Error fetching watermark:', error)
      return null
    }

    if (!data || !data.last_event_time) {
      console.log(`No watermark found for ${source} - this will be a full sync`)
      return null
    }

    const watermark = new Date(data.last_event_time)
    console.log(`✓ Found watermark for ${source}: ${watermark.toISOString()}`)
    return watermark
  } catch (error) {
    console.error('Exception fetching watermark:', error)
    return null
  }
}

/**
 * Update sync watermark after successful sync
 */
async function updateSyncWatermark(
  supabase: any,
  source: string,
  lastEventTime: Date,
  eventsCount: number
): Promise<void> {
  try {
    const { error } = await supabase.rpc('upsert_sync_watermark', {
      p_source: source,
      p_last_event_time: lastEventTime.toISOString(),
      p_events_count: eventsCount,
      p_notes: `Incremental sync completed at ${new Date().toISOString()}`
    })

    if (error) {
      console.error('Error updating watermark:', error)
    } else {
      console.log(`✓ Updated watermark for ${source} to ${lastEventTime.toISOString()}`)
    }
  } catch (error) {
    console.error('Exception updating watermark:', error)
  }
}

/**
 * Find the latest event timestamp from a batch of events
 * Used to update watermark after processing
 */
function getLatestEventTime(events: any[]): Date | null {
  if (!events || events.length === 0) return null

  let maxTime = 0
  for (const event of events) {
    const eventTime = event.properties?.time || 0
    if (eventTime > maxTime) {
      maxTime = eventTime
    }
  }

  // Convert Unix timestamp (seconds) to Date
  return maxTime > 0 ? new Date(maxTime * 1000) : null
}
```

### 3. Update processAndUpsertChunk Function

Change line 194 to use the ADD-strategy function for incremental syncs:

```typescript
async function processAndUpsertChunk(
  events: any[],
  supabase: any,
  syncStartTime: Date,
  isIncrementalSync: boolean // NEW PARAMETER
): Promise<number> {
  // Process events into user profiles
  const userProfiles = processEventsToUserProfiles(events)

  // Format profiles for database
  const profileRows = formatProfilesForDB(userProfiles, syncStartTime.toISOString())

  if (profileRows.length === 0) {
    return 0
  }

  // Choose upsert strategy based on sync mode
  const rpcFunction = isIncrementalSync
    ? 'upsert_subscribers_incremental_add'  // ADD counts (incremental)
    : 'upsert_subscribers_incremental'      // REPLACE counts (full window)

  const { error } = await supabase.rpc(rpcFunction, {
    profiles: profileRows
  })

  if (error) {
    console.error('Error upserting chunk:', error)
    throw error
  }

  return profileRows.length
}
```

### 4. Update streamAndProcessEvents Function

Modify to track latest event time and pass incremental flag:

```typescript
async function streamAndProcessEvents(
  credentials: any,
  supabase: any,
  fromDate: string,
  toDate: string,
  syncStartTime: Date,
  isIncrementalSync: boolean // NEW PARAMETER
) {
  console.log('Streaming events from Mixpanel Export API...')

  // ... existing code ...

  let latestEventTime: Date | null = null // NEW: Track latest event for watermark

  while (true) {
    // ... existing streaming code ...

    for (const line of lines) {
      if (!line.trim()) continue

      try {
        const event = JSON.parse(line)
        events.push(event)
        totalEvents++

        // NEW: Track latest event time for watermark update
        if (event.properties?.time) {
          const eventTime = new Date(event.properties.time * 1000)
          if (!latestEventTime || eventTime > latestEventTime) {
            latestEventTime = eventTime
          }
        }

        // ... rest of existing code ...

        // Process chunk when we hit CHUNK_SIZE
        if (events.length >= CHUNK_SIZE) {
          const inserted = await processAndUpsertChunk(
            events,
            supabase,
            syncStartTime,
            isIncrementalSync // PASS NEW PARAMETER
          )
          // ... rest of existing code ...
        }
      } catch (error) {
        // ... existing error handling ...
      }
    }

    if (done) {
      // ... existing final chunk processing ...
      if (events.length > 0) {
        const inserted = await processAndUpsertChunk(
          events,
          supabase,
          syncStartTime,
          isIncrementalSync // PASS NEW PARAMETER
        )
        // ... existing code ...
      }
      break
    }
  }

  console.log(`✓ Streaming complete: ${totalEvents} events processed, ${totalRecordsInserted} users upserted`)

  return { totalEvents, totalRecordsInserted, latestEventTime } // NEW: Return latestEventTime
}
```

### 5. Update Main serve() Function

Modify date range calculation to use watermark for incremental sync:

```typescript
serve(async (req) => {
  // ... existing CORS and initialization code ...

  try {
    // Parse request body for optional date range (for backfill)
    const body = await req.json().catch(() => ({}))
    const { from_date, to_date, force_full_sync } = body

    // ... existing skip sync check ...

    const { syncLog, syncStartTime } = await createSyncLog(supabase, 'user', 'mixpanel_users_v2')
    const syncLogId = syncLog.id

    try {
      let fromDate: string
      let toDate: string
      let isIncrementalSync = false

      if (from_date && to_date) {
        // Backfill mode: use provided dates (always full sync)
        fromDate = from_date
        toDate = to_date
        isIncrementalSync = false
        console.log(`BACKFILL MODE: Date range ${fromDate} to ${toDate}`)
      } else if (force_full_sync) {
        // Force full 45-day window sync
        const today = new Date()
        const yesterday = new Date(today)
        yesterday.setDate(yesterday.getDate() - 1)
        toDate = yesterday.toISOString().split('T')[0]

        const fortyFiveDaysAgo = new Date(yesterday)
        fortyFiveDaysAgo.setDate(fortyFiveDaysAgo.getDate() - 45)
        fromDate = fortyFiveDaysAgo.toISOString().split('T')[0]

        isIncrementalSync = false
        console.log(`FULL SYNC MODE (forced): Date range ${fromDate} to ${toDate} (45 days)`)
      } else {
        // NEW: INCREMENTAL MODE - fetch only events since last watermark
        const watermark = await getLastSyncWatermark(supabase, 'mixpanel_user_events')

        if (watermark) {
          // Incremental sync: fetch events since watermark with 2-hour overlap for safety
          // Overlap handles late-arriving events and ensures no data loss
          const overlapHours = 2
          const fromTime = new Date(watermark.getTime() - (overlapHours * 60 * 60 * 1000))
          fromDate = fromTime.toISOString().split('T')[0]

          const today = new Date()
          const yesterday = new Date(today)
          yesterday.setDate(yesterday.getDate() - 1)
          toDate = yesterday.toISOString().split('T')[0]

          isIncrementalSync = true
          console.log(`INCREMENTAL MODE: Fetching events since ${watermark.toISOString()} (with ${overlapHours}h overlap)`)
          console.log(`  Date range: ${fromDate} to ${toDate}`)
        } else {
          // No watermark found - first sync, use 45-day window
          const today = new Date()
          const yesterday = new Date(today)
          yesterday.setDate(yesterday.getDate() - 1)
          toDate = yesterday.toISOString().split('T')[0]

          const fortyFiveDaysAgo = new Date(yesterday)
          fortyFiveDaysAgo.setDate(fortyFiveDaysAgo.getDate() - 45)
          fromDate = fortyFiveDaysAgo.toISOString().split('T')[0]

          isIncrementalSync = false
          console.log(`FIRST SYNC MODE: No watermark found, fetching 45-day window ${fromDate} to ${toDate}`)
        }
      }

      console.log(`Sync mode: ${isIncrementalSync ? 'INCREMENTAL (ADD)' : 'FULL WINDOW (REPLACE)'}`)
      console.log(`Tracking ${TRACKED_EVENTS.length} event types:`)
      console.log(`  ${TRACKED_EVENTS.join(', ')}`)

      // Stream and process events
      const { totalEvents, totalRecordsInserted, latestEventTime } = await streamAndProcessEvents(
        credentials,
        supabase,
        fromDate,
        toDate,
        syncStartTime,
        isIncrementalSync
      )

      // NEW: Update watermark if incremental sync and we found events
      if (isIncrementalSync && latestEventTime) {
        await updateSyncWatermark(
          supabase,
          'mixpanel_user_events',
          latestEventTime,
          totalEvents
        )
      }

      const elapsedMs = Date.now() - executionStartMs
      const elapsedSec = Math.round(elapsedMs / 1000)

      // Update sync log with success
      await updateSyncLogSuccess(supabase, syncLogId, {
        total_records_inserted: totalRecordsInserted,
      })

      console.log(`Sync completed successfully in ${elapsedSec}s`)
      console.log(`Sync stats: ${totalEvents} events, ${totalRecordsInserted} users, mode: ${isIncrementalSync ? 'INCREMENTAL' : 'FULL'}`)

      return createSuccessResponse('Subscriber events synced successfully via streaming (v2)', {
        totalTimeSeconds: elapsedSec,
        totalEvents,
        totalRecordsInserted,
        dateRange: { fromDate, toDate },
        syncMode: isIncrementalSync ? 'incremental' : 'full_window',
        trackedEvents: TRACKED_EVENTS.length,
      })
    } catch (error) {
      // ... existing error handling ...
    }
  } catch (error) {
    // ... existing error handling ...
  }
})
```

### 6. Safety Considerations

**Overlap Window**: 2-hour overlap ensures no events are missed due to:
- Late-arriving events in Mixpanel
- Clock skew between systems
- Events processed out of order

**Deduplication**: The overlap window may cause some events to be counted twice. However:
- The ADD strategy correctly accumulates counts
- The 2-hour window is small relative to typical sync intervals (hours)
- Duplicate event IDs don't exist in our event model, so we count by occurrence

**Fallback Behavior**:
- If watermark fetch fails → Falls back to 45-day full sync
- If watermark doesn't exist → Performs initial 45-day sync and sets watermark
- User can force full sync with `force_full_sync: true` in request body

**Backward Compatibility**:
- Existing `upsert_subscribers_incremental` function unchanged
- Can switch between modes without data loss
- Backfill mode still works identically

### 7. Testing Checklist

Before deploying to production:

- [ ] Run verification script for set-based upsert optimization
- [ ] Test watermark table creation and initial watermark
- [ ] Test first sync (no watermark) - should use 45-day window + set watermark
- [ ] Test second sync (with watermark) - should fetch only new events
- [ ] Verify counts are correct (ADD strategy working)
- [ ] Test overlap handling - events in overlap window counted correctly
- [ ] Test error handling - failed sync doesn't update watermark
- [ ] Test force_full_sync parameter
- [ ] Test backfill mode still works
- [ ] Monitor execution time (should be 80-90% faster for incremental syncs)

### 8. Monitoring

After deployment, monitor:
- Sync duration (should decrease significantly for incremental syncs)
- Events processed per sync (should be ~5-10K instead of 100K)
- Watermark progression (should advance after each successful sync)
- No data loss (compare total counts before/after migration)

### 9. Rollback Plan

If issues arise:
1. Set `force_full_sync: true` in all sync requests → reverts to original behavior
2. Or drop new functions and watermarks table → full backward compatibility
3. Original function (`upsert_subscribers_incremental`) remains unchanged
