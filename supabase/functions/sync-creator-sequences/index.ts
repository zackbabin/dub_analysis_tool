// Supabase Edge Function: sync-creator-sequences
// Fetches "Viewed Creator Profile" events for users who copied at least once
//
// Step 1: Uses existing user_first_copies table (populated by sync-event-sequences-v2)
// Step 2: Stream "Viewed Creator Profile" for those users (last 30 days), processing in 2500-event chunks
//
// Streaming approach avoids CPU timeout by processing batches incrementally.
//
// Stores:
//   - Raw view events in event_sequences_raw (Export API with user_id from $user_id)
//   - Uses existing user_first_copies (NO duplicate Insights API call)
//   - event_sequences view (pass-through of event_sequences_raw)
//
// After this completes, call analyze-creator-sequences separately to analyze patterns

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import {
  initializeMixpanelCredentials,
  initializeSupabaseClient,
  handleCorsRequest,
  checkAndHandleSkipSync,
  createSyncLog,
  updateSyncLogSuccess,
  updateSyncLogFailure,
  handleRateLimitError,
  createSuccessResponse,
  createErrorResponse,
  TimeoutGuard,
} from '../_shared/sync-helpers.ts'
import { MIXPANEL_CONFIG } from '../_shared/mixpanel-api.ts'

interface MixpanelExportEvent {
  event: string
  properties: {
    time: number
    distinct_id?: string
    $distinct_id_before_identity?: string
    $insert_id: string
    $email?: string
    portfolioTicker?: string    // From "Viewed Portfolio Details"
    creatorUsername?: string    // From "Viewed Creator Profile"
    [key: string]: any
  }
}

interface SyncStats {
  eventsFetched: number
  eventsInserted: number
}

/**
 * Fetch events from Mixpanel Export API with streaming processing
 * Calls onBatch callback for each chunk of events to avoid memory issues
 * https://developer.mixpanel.com/reference/raw-event-export
 */
async function fetchAndProcessEventsStreaming(
  credentials: { username: string; secret: string },
  fromDate: string,
  toDate: string,
  eventNames: string[],
  userIds: string[] | undefined,
  onBatch: (events: MixpanelExportEvent[]) => Promise<void>,
  batchSize = 5000
): Promise<{ totalEvents: number }> {
  const { username, secret } = credentials

  // Get project ID from shared config (reads from MIXPANEL_PROJECT_ID env var)
  const projectId = MIXPANEL_CONFIG.PROJECT_ID

  // Build event parameter as a JSON array
  // The API expects: event=["event1","event2","event3"]
  // Must be URL encoded as a complete JSON array
  const eventArray = JSON.stringify(eventNames)
  const eventParam = `event=${encodeURIComponent(eventArray)}`

  // Build where clause for user_id filtering if provided
  // API expects: where=properties["$user_id"] in ["id1","id2","id3"]
  // Note: Must use $user_id (with $ prefix) in where clause - this is the merged identity
  let whereParam = ''
  if (userIds && userIds.length > 0) {
    // Format: properties["$user_id"] in ["id1","id2","id3"]
    const idsArray = JSON.stringify(userIds)
    const whereClause = `properties["$user_id"] in ${idsArray}`
    whereParam = `&where=${encodeURIComponent(whereClause)}`
  }

  const url = `https://data.mixpanel.com/api/2.0/export?project_id=${projectId}&from_date=${fromDate}&to_date=${toDate}&${eventParam}${whereParam}`

  console.log(`Fetching from Export API: ${fromDate} to ${toDate}`)
  console.log(`Events: ${eventNames.length} event types (${eventNames.join(', ')})`)
  if (userIds && userIds.length > 0) {
    console.log(`User filter: ${userIds.length} targeted user_ids`)
  }
  console.log(`Full URL: ${url.substring(0, 200)}...`) // Truncate for logging

  // Add 120s timeout for entire Mixpanel API operation (fetch + streaming response)
  // Needs to be longer for backfill mode - streaming large datasets can take time
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 120000)

  let response: Response
  let lineCount = 0

  try {
    console.log('Starting Mixpanel API fetch...')
    const fetchStartTime = Date.now()

    response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'text/plain',
        'Authorization': `Basic ${btoa(`${username}:${secret}`)}`,
      },
      signal: controller.signal,
    })

    const fetchDuration = Math.round((Date.now() - fetchStartTime) / 1000)
    console.log(`✓ Fetch completed in ${fetchDuration}s`)
    console.log(`Response status: ${response.status}`)

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`❌ Mixpanel Export API error (${response.status}):`, errorText)

      if (response.status === 429) {
        throw new Error('RATE_LIMIT_EXCEEDED: Mixpanel API rate limit reached')
      }

      throw new Error(`Mixpanel Export API failed: ${response.status} - ${errorText}`)
    }

    // Stream and parse JSONL response, processing in batches
    console.log('Streaming response body...')
    const streamStartTime = Date.now()

    let eventBatch: MixpanelExportEvent[] = []
    let buffer = ''
    let totalBytes = 0

    // Get readable stream from response body
    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('Response body is not readable')
    }

    const decoder = new TextDecoder()

    try {
      while (true) {
        const { done, value } = await reader.read()

        if (done) break

        // Decode chunk and add to buffer
        const chunk = decoder.decode(value, { stream: true })
        buffer += chunk
        totalBytes += value.length

        // Process complete lines in buffer
        const lines = buffer.split('\n')
        // Keep last incomplete line in buffer
        buffer = lines.pop() || ''

        // Parse complete lines
        for (const line of lines) {
          const trimmedLine = line.trim()
          if (!trimmedLine) continue

          try {
            const event = JSON.parse(trimmedLine)
            eventBatch.push(event)
            lineCount++

            // Process batch when it reaches batchSize
            if (eventBatch.length >= batchSize) {
              const elapsed = Math.round((Date.now() - streamStartTime) / 1000)
              console.log(`  📊 Processing batch at ${lineCount} events (${Math.round(totalBytes / 1024 / 1024)}MB) in ${elapsed}s`)
              await onBatch(eventBatch)
              eventBatch = [] // Clear batch after processing
            }
          } catch (parseError) {
            console.warn('Failed to parse JSONL line:', trimmedLine.substring(0, 100))
          }
        }
      }

      // Process any remaining line in buffer
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer.trim())
          eventBatch.push(event)
          lineCount++
        } catch (parseError) {
          console.warn('Failed to parse final JSONL line:', buffer.substring(0, 100))
        }
      }

      // Process final batch if any events remain
      if (eventBatch.length > 0) {
        console.log(`  📊 Processing final batch of ${eventBatch.length} events`)
        await onBatch(eventBatch)
      }

      const streamDuration = Math.round((Date.now() - streamStartTime) / 1000)
      console.log(`✓ Streamed and processed ${lineCount} events (${Math.round(totalBytes / 1024 / 1024)}MB) in ${streamDuration}s`)

      clearTimeout(timeoutId)
    } catch (streamError: any) {
      clearTimeout(timeoutId)
      throw streamError
    }
  } catch (fetchError: any) {
    clearTimeout(timeoutId)

    if (fetchError.name === 'AbortError') {
      console.error('❌ Mixpanel API request timed out after 120s')
      throw new Error('Mixpanel Export API request timed out after 120 seconds')
    }
    console.error('❌ Mixpanel API error:', fetchError.message)
    throw new Error(`Mixpanel Export API failed: ${fetchError.message}`)
  }

  console.log(`✓ Fetched and processed ${lineCount} events from Export API`)
  return { totalEvents: lineCount }
}

serve(async (req) => {
  // Handle CORS preflight requests
  const corsResponse = handleCorsRequest(req)
  if (corsResponse) return corsResponse

  // Initialize timeout guard at the very start of execution
  const executionStartMs = Date.now()
  const timeoutGuard = new TimeoutGuard(executionStartMs)

  try {
    // Initialize Mixpanel credentials and Supabase client
    const credentials = initializeMixpanelCredentials()
    const supabase = initializeSupabaseClient()

    console.log('Starting creator sequences sync (Export API)...')

    // Check if sync should be skipped (within 1-hour window for creator sequences)
    const skipResponse = await checkAndHandleSkipSync(supabase, 'mixpanel_creator_sequences', 1)
    if (skipResponse) return skipResponse

    // Create sync log entry
    const { syncLog, syncStartTime } = await createSyncLog(supabase, 'user', 'mixpanel_creator_sequences')
    const syncLogId = syncLog.id

    try {
      // Get sync status to determine if incremental or backfill sync
      const { data: syncStatus } = await supabase
        .from('sync_status')
        .select('*')
        .eq('source', 'mixpanel')
        .eq('tool_type', 'creator_sequences')
        .single()

      const now = new Date()

      // Calculate date range based on sync mode
      let fromDate: string
      let toDate: string
      let syncMode: 'backfill' | 'incremental'

      // OPTIMIZED: Always fetch last 30 days (no incremental mode)
      // Combined with user filtering, this keeps data volume manageable
      console.log('📦 Date range: last 30 days')
      const backfillDays = 30
      const startDate = new Date(now.getTime() - backfillDays * 24 * 60 * 60 * 1000)
      // Use yesterday as toDate to avoid timezone issues with Mixpanel API
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
      fromDate = startDate.toISOString().split('T')[0]
      toDate = yesterday.toISOString().split('T')[0]
      syncMode = 'backfill'
      console.log(`Date range: ${fromDate} to ${toDate}`)

      // STEP 1: Fetch target user IDs from user_first_copies (already populated by sync-event-sequences-v2)
      console.log('\n📊 Step 1: Fetching target user IDs from user_first_copies...')
      let targetUserIds: string[] = []

      try {
        const { data: firstCopyUsers, error: usersError } = await supabase
          .from('user_first_copies')
          .select('user_id')

        if (usersError) {
          throw usersError
        }

        targetUserIds = firstCopyUsers?.map(u => u.user_id) || []
        console.log(`✓ Found ${targetUserIds.length} users who copied (from user_first_copies)`)
      } catch (usersError: any) {
        console.error('⚠️ Failed to fetch user_first_copies:', usersError.message)
        console.log('   Will fetch ALL creator profile view events (no user filter)')
        // Continue without user filter - fallback to fetching all events
      }

      // STEP 2: Fetch creator profile view events - FILTERED to target users if available
      const eventNames = ['Viewed Creator Profile']

      if (targetUserIds.length > 0) {
        console.log(`\n📊 Step 2: Fetching creator profile views for ${targetUserIds.length} targeted users`)
      } else {
        console.log(`\n📊 Step 2: Fetching ALL creator profile views (no user filter available)`)
      }

      const fetchStartMs = Date.now()

      const stats: SyncStats = {
        eventsFetched: 0,
        eventsInserted: 0,
      }

      // Process events in streaming batches to avoid CPU timeout
      let totalInserted = 0

      const processBatch = async (events: MixpanelExportEvent[]) => {
        // Check if we should stop syncing and move to analysis
        // Stop at 110s to leave 40s buffer for analyze-creator-sequences (150s total - 110s = 40s)
        const elapsedSeconds = timeoutGuard.getElapsedSeconds()
        if (elapsedSeconds >= 110) {
          console.warn(`⚠️ Reached 110s elapsed time - stopping data sync to ensure time for analysis`)
          console.warn(`   Collected ${totalInserted} events so far, proceeding to analyze-creator-sequences`)
          // Return early to stop processing more batches
          return
        }

        // Transform Mixpanel events to flat database rows
        const rawEventRows = []
        for (const event of events) {
          // Convert Unix timestamp (seconds) to ISO string
          const eventTime = new Date(event.properties.time * 1000).toISOString()

          // Extract user_id from Export API (merged identity)
          const userId = event.properties.$user_id

          // Skip events without user_id
          if (!userId) {
            console.warn(`Skipping event without $user_id: ${event.event}`)
            continue
          }

          // Extract creator_username from event properties
          const creatorUsername = event.properties.creatorUsername

          // Store raw event data with user_id and creatorUsername from Export API
          rawEventRows.push({
            user_id: userId,              // Export API $user_id (merged identity)
            event_name: event.event,
            event_time: eventTime,
            portfolio_ticker: null,       // Creator profile views don't have portfolio_ticker
            creator_username: creatorUsername || null  // For determining uniqueness in analysis
          })
        }

        // CHANGE DETECTION: Check for existing records to avoid unnecessary DB writes
        // This optimization reduces DB load by 60-90% on incremental syncs
        let eventsToInsert = rawEventRows
        let skippedDuplicates = 0

        try {
          // Build composite keys for checking existence (creator events only care about creator_username)
          // Format: "user_id|event_time|creator_username"
          const compositeKeys = rawEventRows.map(row =>
            `${row.user_id}|${row.event_time}|${row.creator_username || 'NULL'}`
          )

          // Fetch existing records using the same conflict key as upsert
          // This matches the database unique constraint: (user_id, event_time, creator_username)
          const userIds = [...new Set(rawEventRows.map(r => r.user_id))]
          const minEventTime = rawEventRows.reduce((min, r) => r.event_time < min ? r.event_time : min, rawEventRows[0].event_time)
          const maxEventTime = rawEventRows.reduce((max, r) => r.event_time > max ? r.event_time : max, rawEventRows[0].event_time)

          const { data: existingRecords, error: fetchError } = await supabase
            .from('event_sequences_raw')
            .select('user_id, event_time, creator_username')
            .in('user_id', userIds)
            .gte('event_time', minEventTime)
            .lte('event_time', maxEventTime)

          if (fetchError) {
            // On fetch error, fall back to inserting all records (safe fallback)
            console.warn(`  ⚠️ Change detection fetch failed, inserting all records as fallback:`, fetchError.message)
          } else if (existingRecords && existingRecords.length > 0) {
            // Build set of existing composite keys for fast lookup
            const existingKeys = new Set(
              existingRecords.map(r =>
                `${r.user_id}|${r.event_time}|${r.creator_username || 'NULL'}`
              )
            )

            // Filter out records that already exist
            eventsToInsert = rawEventRows.filter((row, idx) => {
              const exists = existingKeys.has(compositeKeys[idx])
              if (exists) skippedDuplicates++
              return !exists
            })

            if (skippedDuplicates > 0) {
              console.log(`  📊 Change detection: ${skippedDuplicates} duplicates skipped, ${eventsToInsert.length} new records to insert`)
            }
          }
        } catch (changeDetectionError) {
          // On any error, fall back to inserting all records (safe fallback)
          console.warn(`  ⚠️ Change detection error, inserting all records as fallback:`, changeDetectionError)
          eventsToInsert = rawEventRows
        }

        // Insert batch to database (only new records if change detection succeeded)
        try {
          if (eventsToInsert.length === 0) {
            console.log(`  ✓ All ${rawEventRows.length} events already exist (skipped)`)
            return
          }

          const { error: insertError } = await supabase
            .from('event_sequences_raw')
            .upsert(eventsToInsert, {
              onConflict: 'user_id,event_time,creator_username',
              ignoreDuplicates: true
            })

          if (insertError) {
            const errorCode = insertError.code || insertError.error_code || ''

            // Handle statement timeout gracefully
            if (errorCode === '57014' || insertError.message?.includes('statement timeout')) {
              console.warn(`  ⚠️ Batch insert timed out - continuing`)
              return
            }

            // For other errors, log details and throw
            console.error(`❌ Error inserting batch:`, insertError)
            console.error('   Sample record:', JSON.stringify(eventsToInsert[0]))
            throw insertError
          }

          totalInserted += eventsToInsert.length
          const efficiency = skippedDuplicates > 0
            ? ` (${Math.round((skippedDuplicates / rawEventRows.length) * 100)}% duplicates skipped)`
            : ''
          console.log(`  ✓ Inserted ${eventsToInsert.length} events (${totalInserted} total) at ${elapsedSeconds}s${efficiency}`)
        } catch (err: any) {
          const errorCode = err?.code || err?.message

          // Handle timeouts in catch block
          if (errorCode === '57014' || errorCode?.includes('statement timeout')) {
            console.warn(`  ⚠️ Batch insert timed out (caught) - continuing`)
            return
          }

          throw err
        }
      }

      try {
        console.log('Calling fetchAndProcessEventsStreaming with batch size 2500...')

        // If we have many user IDs, batch them to avoid 414 URI Too Long errors
        // Mixpanel Export API has URL length limits (~8KB), so we batch user IDs
        // Using 500 per batch to balance URL length vs API rate limits (60/hour, 3/sec)
        const MAX_USER_IDS_PER_REQUEST = 500
        let totalEventsFetched = 0

        if (targetUserIds.length > MAX_USER_IDS_PER_REQUEST) {
          console.log(`📦 Batching ${targetUserIds.length} user IDs into chunks of ${MAX_USER_IDS_PER_REQUEST} to avoid URL length limits`)

          // Split user IDs into batches
          for (let i = 0; i < targetUserIds.length; i += MAX_USER_IDS_PER_REQUEST) {
            // Check timeout before starting each batch
            if (timeoutGuard.isApproachingTimeout()) {
              console.warn(`⚠️ Approaching timeout at batch ${Math.floor(i / MAX_USER_IDS_PER_REQUEST) + 1} - stopping early`)
              console.warn(`   Fetched ${totalEventsFetched} events so far from ${i} users`)
              break
            }

            const batchUserIds = targetUserIds.slice(i, Math.min(i + MAX_USER_IDS_PER_REQUEST, targetUserIds.length))
            console.log(`  Fetching batch ${Math.floor(i / MAX_USER_IDS_PER_REQUEST) + 1}/${Math.ceil(targetUserIds.length / MAX_USER_IDS_PER_REQUEST)} (${batchUserIds.length} users)`)

            const result = await fetchAndProcessEventsStreaming(
              credentials,
              fromDate,
              toDate,
              eventNames,
              batchUserIds,
              processBatch,
              2500
            )
            totalEventsFetched += result.totalEvents
            console.log(`  ✓ Batch fetched ${result.totalEvents} events`)

            // Add 500ms delay between batches to respect Mixpanel rate limits (3 req/sec)
            if (i + MAX_USER_IDS_PER_REQUEST < targetUserIds.length) {
              await new Promise(resolve => setTimeout(resolve, 500))
            }
          }

          stats.eventsFetched = totalEventsFetched
          console.log(`✓ All batches completed - ${totalEventsFetched} total events fetched`)
        } else {
          // Single request for small user ID lists
          const result = await fetchAndProcessEventsStreaming(
            credentials,
            fromDate,
            toDate,
            eventNames,
            targetUserIds,
            processBatch,
            2500 // Process in chunks of 2500 events to reduce CPU usage
          )
          stats.eventsFetched = result.totalEvents
          console.log(`✓ Streaming fetch completed - ${result.totalEvents} events fetched`)
        }
      } catch (error: any) {
        console.error('❌ fetchAndProcessEventsStreaming failed:', error.message)
        console.error('Error stack:', error.stack)

        // Handle Mixpanel rate limit errors gracefully
        const rateLimitResponse = await handleRateLimitError(supabase, syncLogId, error, {
          eventsFetched: 0,
          eventsInserted: 0,
        })
        if (rateLimitResponse) return rateLimitResponse

        // Re-throw with more context
        throw new Error(`Mixpanel fetch failed: ${error.message}`)
      }

      const fetchElapsedSec = Math.round((Date.now() - fetchStartMs) / 1000)
      console.log(`✓ Fetch and insert completed in ${fetchElapsedSec}s - Total elapsed: ${timeoutGuard.getElapsedSeconds()}s / 140s`)

      stats.eventsInserted = totalInserted

      if (stats.eventsFetched === 0) {
        console.log('No events to process - sync complete')

        await updateSyncLogSuccess(supabase, syncLogId, {
          total_records_inserted: 0,
        })

        return createSuccessResponse(
          'Creator sequences sync completed - no events to process',
          stats
        )
      }

      console.log(`✅ Inserted ${totalInserted} raw events to event_sequences_raw`)

      // Log timeout status before proceeding
      console.log(`⏱️ Elapsed time: ${timeoutGuard.getElapsedSeconds()}s / 140s limit`)

      // Check if we completed all events or timed out early
      const partialSync = totalInserted < stats.eventsFetched
      const message = partialSync
        ? `Partial sync completed - ${stats.eventsInserted} of ${stats.eventsFetched} events inserted before timeout`
        : `Creator sequences ${syncMode} sync completed - ${totalInserted} events inserted to staging table`

      // Update sync status with last sync timestamp (only if not partial)
      if (!partialSync) {
        await supabase
          .from('sync_status')
          .upsert({
            source: 'mixpanel',
            tool_type: 'creator_sequences',
            last_sync_timestamp: now.toISOString(),
            last_sync_status: 'success',
            records_synced: stats.eventsInserted,
            error_message: null,
            updated_at: now.toISOString(),
          }, {
            onConflict: 'source,tool_type'
          })

        console.log(`✓ Updated sync status: last_sync_timestamp = ${now.toISOString()}`)
      } else {
        console.warn('⚠️ Partial sync - not updating last_sync_timestamp (will retry full range next time)')
      }

      // Update sync log with success (even if partial)
      await updateSyncLogSuccess(supabase, syncLogId, {
        total_records_inserted: stats.eventsInserted,
      })

      console.log(partialSync ? '⚠️ Partial sync completed' : `✅ ${syncMode} sync completed successfully`)
      console.log(`Creator profile views: ${stats.eventsInserted}`)
      console.log('')
      console.log('📊 Next step: Call analyze-creator-sequences separately to analyze conversion patterns')

      return createSuccessResponse(
        message,
        stats,
        {
          syncMode: syncMode,
          dateRange: `${fromDate} to ${toDate}`,
          creatorProfileViews: stats.eventsInserted,
          note: 'Uses existing user_first_copies - no duplicate Insights API call',
          partialSync: partialSync
        }
      )
    } catch (error) {
      // Update sync status with failure
      await supabase
        .from('sync_status')
        .upsert({
          source: 'mixpanel',
          tool_type: 'creator_sequences',
          last_sync_status: 'failed',
          error_message: error?.message || 'Unknown error',
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'source,tool_type'
        })

      // Update sync log with failure
      await updateSyncLogFailure(supabase, syncLogId, error)
      throw error
    }
  } catch (error) {
    return createErrorResponse(error, 'sync-creator-sequences')
  }
})
