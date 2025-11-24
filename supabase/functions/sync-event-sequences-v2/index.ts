// Supabase Edge Function: sync-event-sequences-v2
// OPTIMIZED: Two-step process to minimize data volume
//
// Step 1: Fetch ~435 users who copied in last 7 days (Mixpanel chart 86612901)
// Step 2: Stream "Viewed Portfolio Details" for those users, processing in 5000-event chunks
//
// Streaming approach avoids CPU timeout by processing batches incrementally.
//
// Stores:
//   - Raw view events in event_sequences_raw (no aggregation)
//   - First copy times in user_first_copies
//
// No pre-aggregation - analyze-event-sequences queries raw data directly

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
  sanitizeDistinctId,
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
  distinctIds: string[] | undefined,
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

  // Build where clause for distinct_id filtering if provided
  // API expects: where=properties["$distinct_id"] in ["id1","id2","id3"]
  // Note: Must use $distinct_id (with $ prefix) in where clause
  let whereParam = ''
  if (distinctIds && distinctIds.length > 0) {
    // Format: properties["$distinct_id"] in ["id1","id2","id3"]
    const idsArray = JSON.stringify(distinctIds)
    const whereClause = `properties["$distinct_id"] in ${idsArray}`
    whereParam = `&where=${encodeURIComponent(whereClause)}`
  }

  const url = `https://data.mixpanel.com/api/2.0/export?project_id=${projectId}&from_date=${fromDate}&to_date=${toDate}&${eventParam}${whereParam}`

  console.log(`Fetching from Export API: ${fromDate} to ${toDate}`)
  console.log(`Events: ${eventNames.length} event types (${eventNames.join(', ')})`)
  if (distinctIds && distinctIds.length > 0) {
    console.log(`User filter: ${distinctIds.length} targeted distinct_ids`)
  }
  console.log(`Full URL: ${url.substring(0, 200)}...`) // Truncate for logging

  // Add 120s timeout for entire Mixpanel API operation (fetch + streaming response)
  // Needs to be longer for backfill mode - streaming large datasets can take time
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 120000)

  let response: Response

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
    let lineCount = 0

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

    console.log('Starting event sequences sync v2 (Export API)...')

    // Check if sync should be skipped (within 1-hour window for event sequences)
    const skipResponse = await checkAndHandleSkipSync(supabase, 'mixpanel_event_sequences_v2', 1)
    if (skipResponse) return skipResponse

    // Create sync log entry
    const { syncLog, syncStartTime } = await createSyncLog(supabase, 'user', 'mixpanel_event_sequences_v2')
    const syncLogId = syncLog.id

    try {
      // Get sync status to determine if incremental or backfill sync
      const { data: syncStatus } = await supabase
        .from('sync_status')
        .select('*')
        .eq('source', 'mixpanel')
        .eq('tool_type', 'event_sequences')
        .single()

      const lastSync = syncStatus?.last_sync_timestamp
      const now = new Date()

      // Calculate date range based on sync mode
      let fromDate: string
      let toDate: string
      let syncMode: 'backfill' | 'incremental'

      // OPTIMIZED: Always fetch last 7 days (no incremental mode)
      // Combined with user filtering, this keeps data volume manageable
      console.log('📦 Date range: last 7 days')
      const backfillDays = 7
      const startDate = new Date(now.getTime() - backfillDays * 24 * 60 * 60 * 1000)
      fromDate = startDate.toISOString().split('T')[0]
      toDate = now.toISOString().split('T')[0]
      syncMode = 'backfill'
      console.log(`Date range: ${fromDate} to ${toDate}`)

      // STEP 1: Fetch first copy users from Mixpanel chart 86612901 FIRST
      // This gives us the targeted list of ~435 users who copied in last 3 days
      console.log('\n📊 Step 1: Fetching first copy users from Mixpanel chart 86612901...')
      let targetUserIds: string[] = []
      let copyEventsSynced = 0

      try {
        const projectId = MIXPANEL_CONFIG.PROJECT_ID
        const chartId = '86612901'
        const chartUrl = `https://mixpanel.com/api/query/insights?project_id=${projectId}&bookmark_id=${chartId}`

        // Use Basic Auth (same pattern as sync-business-assumptions)
        const authString = `${credentials.username}:${credentials.secret}`
        const authHeader = `Basic ${btoa(authString)}`

        const chartResponse = await fetch(chartUrl, {
          headers: {
            'Authorization': authHeader,
            'Accept': 'application/json',
          },
        })

        if (!chartResponse.ok) {
          throw new Error(`Chart API failed: ${chartResponse.status}`)
        }

        const chartData = await chartResponse.json()
        console.log(`✓ Fetched chart data (${Object.keys(chartData.series || {}).length} total keys)`)

        // Parse series object to extract first copy times AND build target user list
        const copyRows = []
        const series = chartData.series?.['Uniques of Copied Portfolio'] || {}

        for (const [rawDistinctId, data] of Object.entries(series)) {
          // Skip $overall aggregation key
          if (rawDistinctId === '$overall') continue

          // Keep ORIGINAL ID (with $device: prefix) for Mixpanel API filtering
          targetUserIds.push(rawDistinctId)

          // Sanitize ID for database storage (removes $device: prefix)
          const sanitizedId = sanitizeDistinctId(rawDistinctId)
          if (!sanitizedId) continue

          // Find first timestamp (not "$overall")
          const timestamps = Object.keys(data).filter(k => k !== '$overall')
          if (timestamps.length > 0) {
            const firstCopyTime = timestamps[0] // First key is the first copy time

            copyRows.push({
              distinct_id: sanitizedId, // Store sanitized ID in database
              first_copy_time: firstCopyTime,
              synced_at: syncStartTime.toISOString()
            })
          }
        }

        console.log(`✓ Extracted ${copyRows.length} first copy events for ${targetUserIds.length} users`)

        // Upsert to user_first_copies table
        if (copyRows.length > 0) {
          const { error: copyError } = await supabase
            .from('user_first_copies')
            .upsert(copyRows, {
              onConflict: 'distinct_id'
            })

          if (copyError) {
            console.error('⚠️ Error inserting copy events:', copyError)
          } else {
            copyEventsSynced = copyRows.length
            console.log(`✅ Inserted/updated ${copyEventsSynced} first copy events`)
          }
        }
      } catch (chartError: any) {
        console.error('⚠️ Chart fetch failed:', chartError.message)
        console.log('   Will fetch ALL portfolio view events (no user filter)')
        // Continue without user filter - fallback to fetching all events
      }

      // STEP 2: Fetch portfolio view events - FILTERED to target users if available
      const eventNames = ['Viewed Portfolio Details']

      if (targetUserIds.length > 0) {
        console.log(`\n📊 Step 2: Fetching portfolio views for ${targetUserIds.length} targeted users (who copied in last 3 days)`)
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

      const processBatch = async (events: MixpanelExportEvent[]) => {
        // Check timeout before processing batch
        if (timeoutGuard.isApproachingTimeout()) {
          console.warn(`⚠️ Approaching timeout - skipping batch of ${events.length} events`)
          return
        }

        // Transform Mixpanel events to flat database rows
        const rawEventRows = []
        for (const event of events) {
          // Convert Unix timestamp (seconds) to ISO string
          const eventTime = new Date(event.properties.time * 1000).toISOString()

          // Use $distinct_id_before_identity as the distinct_id (the actual user ID from Export API)
          const rawDistinctId = event.properties.$distinct_id_before_identity || event.properties.distinct_id
          const distinctId = sanitizeDistinctId(rawDistinctId)

          rawEventRows.push({
            distinct_id: distinctId,
            event_name: event.event,
            event_time: eventTime,
            portfolio_ticker: event.properties.portfolioTicker || null,
            synced_at: syncStartTime.toISOString()
          })
        }

        // Insert batch to database
        try {
          const { error: insertError } = await supabase
            .from('event_sequences_raw')
            .upsert(rawEventRows, {
              onConflict: 'distinct_id,event_time,portfolio_ticker',
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
          console.log(`  ✓ Inserted ${rawEventRows.length} events (${totalInserted} total)`)
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

      console.log(`✅ Inserted ${totalInserted} raw events to event_sequences_raw`)

      // Log timeout status before proceeding
      console.log(`⏱️ Elapsed time: ${timeoutGuard.getElapsedSeconds()}s / 140s limit`)

      // Check if we completed all events or timed out early
      const partialSync = totalInserted < events.length
      const message = partialSync
        ? `Partial sync completed - ${stats.eventsInserted} of ${events.length} events inserted before timeout`
        : `Event sequences ${syncMode} sync completed - ${totalInserted} events inserted to staging table`

      // Update sync status with last sync timestamp (only if not partial)
      if (!partialSync) {
        await supabase
          .from('sync_status')
          .upsert({
            source: 'mixpanel',
            tool_type: 'event_sequences',
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
      console.log(`Portfolio views: ${stats.eventsInserted}, First copies: ${stats.copyEventsSynced}`)
      console.log('Next: Call analyze-event-sequences to analyze conversion patterns with Claude AI')

      // Call analyze-event-sequences if we have meaningful data for analysis
      // Requires at least 50 converters (users who copied) to get statistically meaningful results
      // This ensures avg_unique_portfolios and median_unique_portfolios get populated in copy_engagement_summary
      let analysisResult = null
      const elapsedSeconds = timeoutGuard.getElapsedSeconds()
      const timeRemaining = 140 - elapsedSeconds

      console.log(`⏱️ Time check: ${elapsedSeconds}s elapsed, ${timeRemaining}s remaining`)

      const MIN_CONVERTERS_FOR_ANALYSIS = 50 // Minimum sample size for meaningful analysis

      // Check if we have enough data for meaningful analysis
      if (copyEventsSynced >= MIN_CONVERTERS_FOR_ANALYSIS) {
        try {
          if (timeRemaining < 30) {
            console.warn(`⚠️ Low on time (${timeRemaining}s remaining) but attempting analyze-event-sequences anyway`)
            console.warn('   Data sync is complete, analysis can timeout safely')
          }

          console.log(`\n📊 Calling analyze-event-sequences (${copyEventsSynced} converters) to update copy_engagement_summary...`)
          const analysisStartTime = Date.now()

          const analysisResponse = await supabase.functions.invoke('analyze-event-sequences', {
            body: { outcome_type: 'copies' }
          })

          const analysisDuration = Math.round((Date.now() - analysisStartTime) / 1000)
          console.log(`⏱️ analyze-event-sequences took ${analysisDuration}s`)

          if (analysisResponse.error) {
            console.warn('⚠️ analyze-event-sequences failed:', analysisResponse.error.message)
          } else if (analysisResponse.data?.success) {
            console.log('✅ analyze-event-sequences completed - copy_engagement_summary updated')
            analysisResult = {
              convertersAnalyzed: analysisResponse.data.converters_analyzed,
              meanUniquePortfolios: analysisResponse.data.analysis?.mean_unique_views_converters,
              medianUniquePortfolios: analysisResponse.data.analysis?.median_unique_views_converters,
            }
          } else {
            console.warn('⚠️ analyze-event-sequences returned unsuccessful:', analysisResponse.data)
          }
        } catch (analysisError: any) {
          console.warn('⚠️ analyze-event-sequences error (non-fatal):', analysisError.message)
          console.warn('   Data sync succeeded - you can retry analysis manually if needed')
        }
      } else if (copyEventsSynced > 0) {
        console.log(`ℹ️ Only ${copyEventsSynced} converters synced (< ${MIN_CONVERTERS_FOR_ANALYSIS} minimum), skipping analysis`)
        console.log('   Will analyze when more converters accumulate')
      } else {
        console.log('ℹ️ No converters synced, skipping analyze-event-sequences')
      }

      return createSuccessResponse(
        message,
        stats,
        {
          syncMode: syncMode,
          dateRange: `${fromDate} to ${toDate}`,
          portfolioViews: stats.eventsInserted,
          firstCopies: stats.copyEventsSynced,
          note: 'Simplified workflow - no aggregation needed',
          analysisResult: analysisResult,
          partialSync: partialSync
        }
      )
    } catch (error) {
      // Update sync status with failure
      await supabase
        .from('sync_status')
        .upsert({
          source: 'mixpanel',
          tool_type: 'event_sequences',
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
    return createErrorResponse(error, 'sync-event-sequences-v2')
  }
})
