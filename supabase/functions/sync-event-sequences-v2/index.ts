// Supabase Edge Function: sync-event-sequences-v2
// SIMPLIFIED: Fetches only "Viewed Portfolio Details" from Mixpanel Export API (last 14 days)
// Also fetches first copy times from Mixpanel chart 86612901
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
 * Fetch events from Mixpanel Export API
 * https://developer.mixpanel.com/reference/raw-event-export
 */
async function fetchEventsFromExportAPI(
  credentials: { username: string; secret: string },
  fromDate: string,
  toDate: string,
  eventNames: string[]
): Promise<MixpanelExportEvent[]> {
  const { username, secret } = credentials

  // Get project ID from shared config (reads from MIXPANEL_PROJECT_ID env var)
  const projectId = MIXPANEL_CONFIG.PROJECT_ID

  // Build event parameter as a JSON array
  // The API expects: event=["event1","event2","event3"]
  // Must be URL encoded as a complete JSON array
  const eventArray = JSON.stringify(eventNames)
  const eventParam = `event=${encodeURIComponent(eventArray)}`

  const url = `https://data.mixpanel.com/api/2.0/export?project_id=${projectId}&from_date=${fromDate}&to_date=${toDate}&${eventParam}`

  console.log(`Fetching from Export API: ${fromDate} to ${toDate}`)
  console.log(`Events: ${eventNames.length} event types (${eventNames.join(', ')})`)
  console.log(`Full URL: ${url}`)

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

    // Stream and parse JSONL response in chunks to avoid memory/timeout issues
    console.log('Streaming response body...')
    const streamStartTime = Date.now()

    const events: MixpanelExportEvent[] = []
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
            events.push(event)
            lineCount++

            // Log progress every 10000 events
            if (lineCount % 10000 === 0) {
              const elapsed = Math.round((Date.now() - streamStartTime) / 1000)
              console.log(`  📊 Streamed ${lineCount} events (${Math.round(totalBytes / 1024 / 1024)}MB) in ${elapsed}s`)
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
          events.push(event)
          lineCount++
        } catch (parseError) {
          console.warn('Failed to parse final JSONL line:', buffer.substring(0, 100))
        }
      }

      const streamDuration = Math.round((Date.now() - streamStartTime) / 1000)
      console.log(`✓ Streamed and parsed ${lineCount} events (${Math.round(totalBytes / 1024 / 1024)}MB) in ${streamDuration}s`)

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

  console.log(`✓ Fetched ${events.length} events from Export API`)

  // Log first event for debugging
  if (events.length > 0) {
    console.log('Sample event:', JSON.stringify(events[0]).substring(0, 200))
  } else {
    console.warn('⚠️ No events returned from Export API - check event names')
  }

  return events
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

      // SIMPLIFIED: Always fetch last 7 days (no incremental mode)
      // This keeps the dataset consistent for Claude analysis while staying under CPU limits
      console.log('📦 Fetching last 7 days of portfolio view events')
      const backfillDays = 7
      const startDate = new Date(now.getTime() - backfillDays * 24 * 60 * 60 * 1000)
      fromDate = startDate.toISOString().split('T')[0]
      toDate = now.toISOString().split('T')[0]
      syncMode = 'backfill'
      console.log(`Date range: ${fromDate} to ${toDate}`)

      // SIMPLIFIED: Only fetch "Viewed Portfolio Details" (single event type)
      const eventNames = ['Viewed Portfolio Details']

      console.log(`Fetching events from ${fromDate} to ${toDate}...`)

      const fetchStartMs = Date.now()
      let events: MixpanelExportEvent[] = []

      try {
        console.log('Calling fetchEventsFromExportAPI...')
        events = await fetchEventsFromExportAPI(credentials, fromDate, toDate, eventNames)
        console.log(`✓ fetchEventsFromExportAPI returned ${events.length} events`)
      } catch (error: any) {
        console.error('❌ fetchEventsFromExportAPI failed:', error.message)
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
      console.log(`✓ Fetch completed in ${fetchElapsedSec}s - Total elapsed: ${timeoutGuard.getElapsedSeconds()}s / 140s`)

      const stats: SyncStats = {
        eventsFetched: events.length,
        eventsInserted: 0,
      }

      // Check if we're approaching timeout after Mixpanel fetch
      // If so, we won't have time to insert data, so return with warning
      if (timeoutGuard.isApproachingTimeout()) {
        console.warn(`⚠️ Approaching timeout after fetching ${events.length} events - no time for inserts`)
        console.log(`   Time remaining: ${140 - timeoutGuard.getElapsedSeconds()}s`)
        await updateSyncLogSuccess(supabase, syncLogId, {
          total_records_inserted: 0,
        })
        return createSuccessResponse(
          `Fetched ${events.length} events but timed out before insert - run again to store data`,
          { ...stats, warning: 'Timeout after fetch - events not stored' },
          { note: 'Function timed out after fetching events. Run again to complete.' }
        )
      }

      if (events.length === 0) {
        console.log('No events to process - sync complete')

        await updateSyncLogSuccess(supabase, syncLogId, {
          total_records_inserted: 0,
        })

        return createSuccessResponse(
          'Event sequences sync v2 completed - no events to process',
          stats
        )
      }

      console.log('Converting events to flat rows for batch insert...')

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

      console.log(`✓ Prepared ${rawEventRows.length} event rows for batch insert`)

      // Batch upsert to event_sequences_raw (ON CONFLICT DO NOTHING via unique constraint)
      // This prevents duplicates while allowing re-sync without data loss
      const batchSize = 1000
      let totalInserted = 0

      for (let i = 0; i < rawEventRows.length; i += batchSize) {
        // Check timeout before each batch
        if (timeoutGuard.isApproachingTimeout()) {
          console.warn(`⚠️ Approaching timeout - stopping after ${totalInserted} events inserted`)
          break
        }

        const batch = rawEventRows.slice(i, i + batchSize)
        const batchNum = Math.floor(i / batchSize) + 1
        const totalBatches = Math.ceil(rawEventRows.length / batchSize)

        console.log(`Inserting batch ${batchNum}/${totalBatches} (${batch.length} events)...`)

        try {
          const { error: insertError } = await supabase
            .from('event_sequences_raw')
            .upsert(batch, {
              onConflict: 'distinct_id,event_time,portfolio_ticker',
              ignoreDuplicates: true
            })

          if (insertError) {
            const errorCode = insertError.code || insertError.error_code || ''

            // Handle statement timeout gracefully
            if (errorCode === '57014' || insertError.message?.includes('statement timeout')) {
              console.warn(`  ⚠️ Batch ${batchNum} timed out - continuing`)
              continue
            }

            // For other errors, log details and throw
            console.error(`❌ Error inserting batch ${batchNum}:`, insertError)
            console.error('   Sample record:', JSON.stringify(batch[0]))
            throw insertError
          }

          totalInserted += batch.length
          console.log(`  ✓ Batch ${batchNum}/${totalBatches} complete (${totalInserted} total events)`)
        } catch (err: any) {
          const errorCode = err?.code || err?.message

          // Handle timeouts in catch block
          if (errorCode === '57014' || errorCode?.includes('statement timeout')) {
            console.warn(`  ⚠️ Batch ${batchNum} timed out (caught) - continuing`)
            continue
          }

          throw err
        }
      }

      console.log(`✅ Inserted ${totalInserted} raw events to event_sequences_raw`)
      stats.eventsInserted = totalInserted

      // Fetch first copy times from Mixpanel chart 86612901
      let copyEventsSynced = 0
      if (!timeoutGuard.isApproachingTimeout()) {
        console.log('\nFetching first copy events from Mixpanel chart 86612901...')
        try {
          const projectId = MIXPANEL_CONFIG.projectId
          const chartId = '86612901'
          const chartUrl = `https://mixpanel.com/api/query/insights?project_id=${projectId}&bookmark_id=${chartId}`

          const chartResponse = await fetch(chartUrl, {
            headers: {
              'Authorization': `Bearer ${credentials.secret}`,
            },
          })

          if (!chartResponse.ok) {
            throw new Error(`Chart API failed: ${chartResponse.status}`)
          }

          const chartData = await chartResponse.json()
          console.log(`✓ Fetched chart data (${Object.keys(chartData.series || {}).length} total keys)`)

          // Parse series object to extract first copy times
          const copyRows = []
          const series = chartData.series?.['Uniques of Copied Portfolio'] || {}

          for (const [distinctId, data] of Object.entries(series)) {
            // Skip $overall aggregation key
            if (distinctId === '$overall') continue

            // Find first timestamp (not "$overall")
            const timestamps = Object.keys(data).filter(k => k !== '$overall')
            if (timestamps.length > 0) {
              const firstCopyTime = timestamps[0] // First key is the first copy time
              const sanitizedId = sanitizeDistinctId(distinctId)

              copyRows.push({
                distinct_id: sanitizedId,
                first_copy_time: firstCopyTime,
                synced_at: syncStartTime.toISOString()
              })
            }
          }

          console.log(`✓ Extracted ${copyRows.length} first copy events`)

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
        } catch (chartError) {
          console.error('⚠️ Chart fetch failed (non-fatal):', chartError.message)
          console.log('   Continuing with view events only')
        }
      } else {
        console.warn('⚠️ Skipping chart fetch - approaching timeout')
      }

      stats.copyEventsSynced = copyEventsSynced

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

      return createSuccessResponse(
        message,
        stats,
        {
          syncMode: syncMode,
          dateRange: `${fromDate} to ${toDate}`,
          portfolioViews: stats.eventsInserted,
          firstCopies: stats.copyEventsSynced,
          note: 'Simplified workflow - no aggregation needed',
          nextSteps: 'Call analyze-event-sequences to analyze raw data with Claude AI',
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
