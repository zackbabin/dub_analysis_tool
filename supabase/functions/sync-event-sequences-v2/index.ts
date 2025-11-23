// Supabase Edge Function: sync-event-sequences-v2
// Fetches 2 specific events from Mixpanel Export API (last 7 days):
//   - "Viewed Creator Profile" -> extracts creatorUsername
//   - "Viewed Portfolio Details" -> extracts portfolioTicker
// Stores raw events with extracted properties for downstream analysis

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
  duplicatesSkipped: number
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

  // Build where clause to filter by email existence
  // TEMPORARILY DISABLED: Removing where clause to test if it's causing 0 results
  // const whereClause = encodeURIComponent('(properties["$email"])')

  // Build event parameter as a JSON array
  // The API expects: event=["event1","event2","event3"]
  // Must be URL encoded as a complete JSON array
  const eventArray = JSON.stringify(eventNames)
  const eventParam = `event=${encodeURIComponent(eventArray)}`

  const url = `https://data.mixpanel.com/api/2.0/export?project_id=${projectId}&from_date=${fromDate}&to_date=${toDate}&${eventParam}`

  console.log(`Fetching from Export API: ${fromDate} to ${toDate}`)
  console.log(`Events: ${eventNames.length} event types`)
  console.log(`Event parameter: ${eventParam}`)
  console.log(`Where clause: DISABLED (testing)`)
  console.log(`Full URL (truncated): ${url.substring(0, 200)}...`)

  let response: Response
  try {
    // Add 100s timeout for Mixpanel API call (leaves 50s buffer for processing/storage)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 100000)

    response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'text/plain',
        'Authorization': `Basic ${btoa(`${username}:${secret}`)}`,
      },
      signal: controller.signal,
    })

    clearTimeout(timeoutId)
  } catch (fetchError: any) {
    if (fetchError.name === 'AbortError') {
      console.error('❌ Mixpanel API request timed out after 100s')
      throw new Error('Mixpanel Export API request timed out after 100 seconds')
    }
    console.error('❌ Mixpanel API fetch error:', fetchError.message)
    throw new Error(`Mixpanel Export API fetch failed: ${fetchError.message}`)
  }

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`❌ Mixpanel Export API error (${response.status}):`, errorText)

    if (response.status === 429) {
      throw new Error('RATE_LIMIT_EXCEEDED: Mixpanel API rate limit reached')
    }

    throw new Error(`Mixpanel Export API failed: ${response.status} - ${errorText}`)
  }

  // Parse JSONL response (newline-delimited JSON)
  const text = await response.text()
  console.log(`Response text length: ${text.length} bytes`)

  const lines = text.trim().split('\n').filter(line => line.trim())
  console.log(`Response lines: ${lines.length}`)

  const events: MixpanelExportEvent[] = []
  for (const line of lines) {
    try {
      const event = JSON.parse(line)
      events.push(event)
    } catch (parseError) {
      console.warn('Failed to parse JSONL line:', line.substring(0, 100))
    }
  }

  console.log(`✓ Fetched ${events.length} events from Export API`)

  // Log first event for debugging
  if (events.length > 0) {
    console.log('Sample event:', JSON.stringify(events[0]).substring(0, 200))
  } else {
    console.warn('⚠️ No events returned from Export API - check event names and where clause')
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
      // Calculate date range - last 7 days only
      const now = new Date()
      const lookbackDays = 7
      const startDate = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000)
      const fromDate = startDate.toISOString().split('T')[0] // YYYY-MM-DD
      const toDate = now.toISOString().split('T')[0] // YYYY-MM-DD

      // Only fetch these 2 events - we extract creatorUsername and portfolioTicker from them
      const eventNames = [
        'Viewed Creator Profile',    // Extract creatorUsername
        'Viewed Portfolio Details',  // Extract portfolioTicker
      ]

      // Map event names - keep them simple since we're only tracking 2 events
      const mapEventName = (exportEventName: string): string => {
        // Map directly - no Premium/Regular split needed for these tracking events
        return exportEventName
      }

      console.log(`Fetching events from ${fromDate} to ${toDate}...`)

      const fetchStartMs = Date.now()
      let events: MixpanelExportEvent[] = []

      try {
        events = await fetchEventsFromExportAPI(credentials, fromDate, toDate, eventNames)
      } catch (error: any) {
        // Handle Mixpanel rate limit errors gracefully
        const rateLimitResponse = await handleRateLimitError(supabase, syncLogId, error, {
          eventsFetched: 0,
          eventsInserted: 0,
          duplicatesSkipped: 0,
        })
        if (rateLimitResponse) return rateLimitResponse
        throw error
      }

      const fetchElapsedSec = Math.round((Date.now() - fetchStartMs) / 1000)
      console.log(`✓ Fetch completed in ${fetchElapsedSec}s - Total elapsed: ${timeoutGuard.getElapsedSeconds()}s / 140s`)

      const stats: SyncStats = {
        eventsFetched: events.length,
        eventsInserted: 0,
        duplicatesSkipped: 0,
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

      console.log('Processing events for storage...')

      // Transform Mixpanel events to database format
      // Extract creatorUsername from "Viewed Creator Profile" and portfolioTicker from "Viewed Portfolio Details"
      const rawEventRows = events.map((event) => {
        // Convert Unix timestamp (seconds) to ISO string
        const eventTime = new Date(event.properties.time * 1000).toISOString()

        // Get event name
        const exportEventName = event.event
        const internalEventName = mapEventName(exportEventName)

        // Use $distinct_id_before_identity as the distinct_id (the actual user ID from Export API)
        const rawDistinctId = event.properties.$distinct_id_before_identity || event.properties.distinct_id
        const distinctId = sanitizeDistinctId(rawDistinctId)

        // Extract relevant properties based on event type
        // "Viewed Creator Profile" -> extract creatorUsername
        // "Viewed Portfolio Details" -> extract portfolioTicker
        const portfolioTicker = exportEventName === 'Viewed Portfolio Details'
          ? event.properties.portfolioTicker
          : null

        const creatorUsername = exportEventName === 'Viewed Creator Profile'
          ? event.properties.creatorUsername
          : null

        return {
          distinct_id: distinctId,
          event_name: internalEventName,
          event_time: eventTime,
          event_count: 1,
          portfolio_ticker: portfolioTicker,
          creator_username: creatorUsername,
          creator_type: null, // No longer tracking creatorType
          event_data: {
            event_name: exportEventName,
            event_time: eventTime,
            event_count: 1,
            portfolioTicker: portfolioTicker,
            creatorUsername: creatorUsername,
            email: event.properties.$email,
            insert_id: event.properties.$insert_id,
          },
          synced_at: syncStartTime.toISOString()
        }
      })

      console.log(`Prepared ${rawEventRows.length} event records for insertion`)

      // Check if we're approaching timeout before starting batch inserts
      if (timeoutGuard.isApproachingTimeout()) {
        console.warn('⚠️ Approaching timeout before batch inserts - returning partial results')
        await updateSyncLogSuccess(supabase, syncLogId, {
          total_records_inserted: 0,
        })
        return createSuccessResponse(
          'Partial sync - fetched events but timed out before insert',
          { ...stats, warning: 'Timeout before insert - no events stored' },
          { note: 'Function timed out before inserting events. Run again to complete.' }
        )
      }

      // Insert events in batches (deduplication via unique index)
      const batchSize = 500
      let totalInserted = 0
      let totalDuplicatesSkipped = 0
      let skippedBatches = 0

      for (let i = 0; i < rawEventRows.length; i += batchSize) {
        // Check timeout before each batch
        if (timeoutGuard.isApproachingTimeout()) {
          console.warn(`⚠️ Approaching timeout at batch ${Math.floor(i / batchSize) + 1} - stopping early`)
          console.log(`✓ Inserted ${totalInserted} events before timeout (${rawEventRows.length - i} remaining)`)
          break
        }

        const batch = rawEventRows.slice(i, i + batchSize)
        const batchNum = Math.floor(i / batchSize) + 1
        const totalBatches = Math.ceil(rawEventRows.length / batchSize)

        try {
          // Use INSERT with ignoreDuplicates=true to leverage unique index for deduplication
          // Unique index on (distinct_id, event_name, event_time) ensures no duplicate events
          const { data, error: insertError, count } = await supabase
            .from('event_sequences_raw')
            .insert(batch, {
              ignoreDuplicates: true,
              count: 'exact'
            })

          if (insertError) {
            // Handle statement timeout gracefully
            const errorCode = insertError.code || insertError.error_code || insertError.message
            console.log(`Batch ${batchNum}/${totalBatches} error: code=${errorCode}, message=${insertError.message}`)

            if (errorCode === '57014' || errorCode?.includes('57014') || insertError.message?.includes('statement timeout')) {
              console.warn(`⚠️ Statement timeout on batch ${batchNum}/${totalBatches} - skipping and continuing...`)
              skippedBatches++
              continue // Skip this batch but don't fail the whole sync
            }

            console.error('Error inserting event sequences batch:', insertError)
            throw insertError
          }

          // count returns number of rows actually inserted (excluding duplicates)
          const insertedInBatch = count ?? batch.length
          const duplicatesInBatch = batch.length - insertedInBatch

          totalInserted += insertedInBatch
          totalDuplicatesSkipped += duplicatesInBatch

          if (batchNum % 10 === 0 || batchNum === totalBatches) {
            console.log(`  ✓ Batch ${batchNum}/${totalBatches}: ${insertedInBatch} inserted, ${duplicatesInBatch} duplicates skipped (${totalInserted} total)`)
          }
        } catch (err) {
          // Catch any timeout or connection errors
          const errorCode = err?.code || err?.error_code || err?.message
          console.log(`Caught exception in batch ${batchNum}/${totalBatches}: code=${errorCode}, message=${err?.message}`)

          if (errorCode === '57014' || errorCode?.includes('57014') || err?.message?.includes('statement timeout')) {
            console.warn(`⚠️ Caught statement timeout exception on batch ${batchNum}/${totalBatches} - continuing...`)
            skippedBatches++
            continue // Skip this batch but don't fail
          }
          throw err
        }
      }

      if (skippedBatches > 0) {
        console.warn(`⚠️ Skipped ${skippedBatches} batch(es) due to timeouts`)
      }

      console.log(`✅ Inserted ${totalInserted} new events (${totalDuplicatesSkipped} duplicates skipped)`)
      stats.eventsInserted = totalInserted
      stats.duplicatesSkipped = totalDuplicatesSkipped

      // Check if we completed all records or timed out early
      const partialSync = stats.eventsInserted < rawEventRows.length
      const message = partialSync
        ? `Partial sync completed - ${stats.eventsInserted} of ${rawEventRows.length} events inserted before timeout`
        : 'Event sequences sync completed - 2 event types tracked (last 7 days)'

      // Update sync log with success (even if partial)
      await updateSyncLogSuccess(supabase, syncLogId, {
        total_records_inserted: stats.eventsInserted,
      })

      console.log(partialSync ? '⚠️ Partial sync completed' : 'Event sequences sync completed successfully')
      console.log('Tracked events: Viewed Creator Profile (creatorUsername), Viewed Portfolio Details (portfolioTicker)')
      console.log('Call process-event-sequences to aggregate user-level sequences')

      return createSuccessResponse(
        message,
        stats,
        {
          note: 'Only tracking 2 events: "Viewed Creator Profile" and "Viewed Portfolio Details" from last 7 days',
          nextSteps: 'Call process-event-sequences to aggregate user-level sequences',
          partialSync: partialSync
        }
      )
    } catch (error) {
      // Update sync log with failure
      await updateSyncLogFailure(supabase, syncLogId, error)
      throw error
    }
  } catch (error) {
    return createErrorResponse(error, 'sync-event-sequences-v2')
  }
})
