// Supabase Edge Function: sync-portfolio-sequences
// OPTIMIZED: Two-step data sync process (analysis is a separate function)
//
// Step 1: Fetch ~200 users who copied at least once (Mixpanel Insights API chart 86612901)
// Step 2: Stream "Viewed Portfolio Details" for those users (last 30 days), processing in 2500-event chunks
//
// Streaming approach avoids CPU timeout by processing batches incrementally.
//
// Stores:
//   - Raw view events in event_sequences_raw (Export API with user_id from $user_id)
//   - First copy times in user_first_copies (Insights API with user_id from $user_id)
//   - event_sequences view (pass-through of event_sequences_raw)
//
// After this completes, call analyze-portfolio-sequences separately to analyze patterns

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import {
  initializeMixpanelCredentials,
  initializeSupabaseClient,
  handleCorsRequest,
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
  copyEventsSynced?: number
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

  // Add 240s timeout for entire Mixpanel API operation (fetch + streaming response)
  // Needs to be longer for backfill mode - streaming large datasets can take time
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 240000)

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
            // Silently skip unparseable lines (expected for incomplete chunks at stream boundaries)
            // The buffer logic keeps incomplete lines for the next iteration
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
          // Silently skip - final buffer should be empty or complete, parse errors are rare here
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
      console.error('❌ Mixpanel API request timed out after 240s')
      throw new Error('Mixpanel Export API request timed out after 240 seconds')
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

    console.log('Starting portfolio sequences sync (Export API)...')

    // Create sync log entry
    const { syncLog, syncStartTime } = await createSyncLog(supabase, 'user', 'mixpanel_portfolio_sequences')
    const syncLogId = syncLog.id

    try {
      // Get last successful sync from sync_logs to determine if incremental or backfill sync
      const { data: lastSyncLog } = await supabase
        .from('sync_logs')
        .select('sync_completed_at, created_at')
        .eq('source', 'mixpanel_portfolio_sequences')
        .eq('sync_status', 'completed')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      const now = new Date()

      // Calculate date range based on sync mode
      // Note: Date range is for Mixpanel Export API. Analysis will filter events
      // per-user based on their first_app_open_time to first_copy_time range
      let fromDate: string
      let toDate: string
      let syncMode: 'backfill' | 'incremental'

      // Use today as toDate to capture all recent data
      toDate = now.toISOString().split('T')[0]

      if (lastSyncLog?.sync_completed_at) {
        // Incremental: fetch from 1 day before last sync to ensure at least 1 day lookback
        // Database unique constraints handle deduplication of any overlapping events
        console.log('📦 Mode: Incremental sync')
        const lastSync = new Date(lastSyncLog.sync_completed_at)
        const oneDayBeforeLastSync = new Date(lastSync.getTime() - 24 * 60 * 60 * 1000)
        fromDate = oneDayBeforeLastSync.toISOString().split('T')[0]
        syncMode = 'incremental'
        console.log(`Date range: ${fromDate} to ${toDate} (1 day before last sync for overlap)`)
      } else {
        // Backfill: fetch last 7 days on first run (reduced from 30 to avoid timeout)
        console.log('📦 Mode: Backfill (first sync)')
        const backfillDays = 7
        const startDate = new Date(now.getTime() - backfillDays * 24 * 60 * 60 * 1000)
        fromDate = startDate.toISOString().split('T')[0]
        syncMode = 'backfill'
        console.log(`Date range: ${fromDate} to ${toDate}`)
      }

      // STEP 1: Fetch target user IDs from user_first_copies (populated by sync-first-copy-users)
      // Only include users with both first_app_open_time and first_copy_time
      console.log('\n📊 Step 1: Fetching target user IDs from user_first_copies...')
      let targetUserIds: string[] = []
      let copyEventsSynced = 0

      try {
        // Fetch all users with pagination to avoid 1000 row limit
        let firstCopyUsers: any[] = []
        let page = 0
        const PAGE_SIZE = 1000

        while (true) {
          const { data: pageData, error: usersError } = await supabase
            .from('user_first_copies')
            .select('user_id, first_app_open_time, first_copy_time')
            .not('first_app_open_time', 'is', null)
            .not('first_copy_time', 'is', null)
            .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

          if (usersError) {
            throw usersError
          }

          if (!pageData || pageData.length === 0) {
            break
          }

          firstCopyUsers = firstCopyUsers.concat(pageData)

          if (pageData.length < PAGE_SIZE) {
            break  // Last page
          }

          page++
        }

        targetUserIds = firstCopyUsers.map(u => u.user_id)
        copyEventsSynced = targetUserIds.length
        console.log(`✓ Found ${targetUserIds.length} users with both first_app_open_time and first_copy_time (fetched in ${page + 1} page(s))`)
      } catch (userError: any) {
        console.error('⚠️ Failed to fetch user_first_copies:', userError.message)
        console.log('   Will fetch ALL portfolio view events (no user filter)')
        // Continue without user filter - fallback to fetching all events
      }

      // STEP 2: Fetch portfolio view events - FILTERED to target users if available
      const eventNames = ['Viewed Portfolio Details']

      if (targetUserIds.length > 0) {
        console.log(`\n📊 Step 2: Fetching portfolio views for ${targetUserIds.length} targeted users (with both timestamps)`)
      } else {
        console.log(`\n📊 Step 2: Fetching ALL portfolio views (no user filter available)`)
      }

      const fetchStartMs = Date.now()

      const stats: SyncStats = {
        eventsFetched: 0,
        eventsInserted: 0,
      }

      // Process events in streaming batches to avoid CPU timeout
      let totalInserted = 0
      let skippedNoUserId = 0
      let skippedNoTicker = 0

      const processBatch = async (events: MixpanelExportEvent[]) => {
        // Check if we should stop syncing and move to analysis
        // Stop at 110s to leave 40s buffer for analyze-event-sequences (150s total - 110s = 40s)
        const elapsedSeconds = timeoutGuard.getElapsedSeconds()
        if (elapsedSeconds >= 110) {
          console.warn(`⚠️ Reached 110s elapsed time - stopping data sync to ensure time for analysis`)
          console.warn(`   Collected ${totalInserted} events so far, proceeding to analyze-event-sequences`)
          // Return early to stop processing more batches
          // The fetchAndProcessEventsStreaming function will continue streaming but we won't process more
          return
        }

        // Transform Mixpanel events to flat database rows
        const rawEventRows = []
        for (const event of events) {
          // Convert Unix timestamp (seconds) to ISO string
          const eventTime = new Date(event.properties.time * 1000).toISOString()

          // Extract user_id from Export API (merged identity)
          const userId = event.properties.$user_id

          // Skip events without user_id (silently track count)
          if (!userId) {
            skippedNoUserId++
            continue
          }

          // Extract portfolio_ticker from event properties
          const portfolioTicker = event.properties.portfolioTicker

          // Skip events without portfolioTicker - not useful for analysis
          if (!portfolioTicker) {
            skippedNoTicker++
            continue
          }

          // Store raw event data with user_id from Export API
          rawEventRows.push({
            user_id: userId,          // Export API $user_id (merged identity)
            event_name: event.event,
            event_time: eventTime,
            portfolio_ticker: portfolioTicker
          })
        }

        // Insert batch to database - PostgreSQL handles deduplication via unique constraint
        // Unique index: idx_portfolio_sequences_raw_unique (user_id, event_time, portfolio_ticker)
        try {
          if (rawEventRows.length === 0) {
            console.log(`  ✓ No events in batch`)
            return
          }

          const { error: insertError } = await supabase
            .from('portfolio_sequences_raw')
            .upsert(rawEventRows, {
              onConflict: 'user_id,event_time,portfolio_ticker',
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
            console.error('   Sample record:', JSON.stringify(rawEventRows[0]))
            throw insertError
          }

          totalInserted += rawEventRows.length
          console.log(`  ✓ Processed ${rawEventRows.length} events (${totalInserted} total processed) at ${elapsedSeconds}s`)
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
        // Reduced from 500 to 200 - with 18-char user IDs, 500 was exceeding ~8KB URL limit
        const MAX_USER_IDS_PER_REQUEST = 200
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

            // Add 2s delay between batches to respect Mixpanel rate limits (5 concurrent, 60/hour)
            // Increased from 500ms to prevent rate limit when sync-creator-sequences runs concurrently
            if (i + MAX_USER_IDS_PER_REQUEST < targetUserIds.length) {
              await new Promise(resolve => setTimeout(resolve, 2000))
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
      stats.copyEventsSynced = copyEventsSynced

      if (stats.eventsFetched === 0) {
        console.log('No events to process - sync complete')

        await updateSyncLogSuccess(supabase, syncLogId, {
          total_records_inserted: 0,
        })

        return createSuccessResponse(
          'Event sequences sync v2 completed - no events to process',
          stats
        )
      }

      console.log(`✅ Inserted ${totalInserted} raw events to portfolio_sequences_raw`)

      // Log skipped events summary
      if (skippedNoUserId > 0 || skippedNoTicker > 0) {
        console.log(`ℹ️ Skipped events: ${skippedNoUserId} without user_id, ${skippedNoTicker} without portfolio_ticker`)
      }

      // Update sync log with success IMMEDIATELY after storing data (even if partial)
      // This ensures the log is marked as completed even if function times out after this point
      await updateSyncLogSuccess(supabase, syncLogId, {
        total_records_inserted: stats.eventsInserted,
      })
      console.log(`✅ Sync log ${syncLogId} marked as completed`)

      // Note: user_id is available via portfolio_sequences view (joins with user_first_copies)

      // Log timeout status before proceeding
      console.log(`⏱️ Elapsed time: ${timeoutGuard.getElapsedSeconds()}s / 140s limit`)

      // Check if we completed all events or timed out early
      const partialSync = totalInserted < stats.eventsFetched
      const message = partialSync
        ? `Partial sync completed - ${stats.eventsInserted} of ${stats.eventsFetched} events inserted before timeout`
        : `Event sequences ${syncMode} sync completed - ${totalInserted} events inserted to staging table`

      console.log(partialSync ? '⚠️ Partial sync completed' : `✅ ${syncMode} sync completed successfully`)
      console.log(`Portfolio views: ${stats.eventsInserted}, First copies: ${stats.copyEventsSynced}`)
      console.log('')
      console.log('📊 Next step: Call analyze-event-sequences separately to analyze conversion patterns')
      console.log(`   Synced ${stats.copyEventsSynced} converters - ${stats.copyEventsSynced >= 50 ? 'ready for analysis' : 'need 50+ for meaningful analysis'}`)

      // Note: analyze-event-sequences is now a separate workflow step
      // This prevents CPU timeout by keeping sync and analysis functions independent
      const analysisResult = null

      return createSuccessResponse(
        message,
        stats,
        {
          syncMode: syncMode,
          dateRange: `${fromDate} to ${toDate}`,
          portfolioViews: stats.eventsInserted,
          firstCopies: stats.copyEventsSynced,
          note: 'Uses 1-day lookback with deduplication - ensures no data missed',
          analysisResult: analysisResult,
          partialSync: partialSync
        }
      )
    } catch (error) {
      // Update sync log with failure
      await updateSyncLogFailure(supabase, syncLogId, error)
      throw error
    }
  } catch (error) {
    return createErrorResponse(error, 'sync-portfolio-sequences')
  }
})
