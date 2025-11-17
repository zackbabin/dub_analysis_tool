// Supabase Edge Function: sync-mixpanel-user-events (Event Export API - Streaming)
// Streams events from Mixpanel Export API, stores raw events in staging table
// Processing moved to Postgres for 10-50x performance improvement
// Postgres function aggregates events into user profiles via set-based SQL
// Default behavior: Fetches last 3 days through yesterday (rolling 3-day window)

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import {
  initializeMixpanelCredentials,
  initializeSupabaseClient,
  handleCorsRequest,
  checkAndHandleSkipSync,
  createSyncLog,
  updateSyncLogSuccess,
  updateSyncLogFailure,
  createSuccessResponse,
  createErrorResponse,
} from '../_shared/sync-helpers.ts'

// 11 events that we can track from Export API
const TRACKED_EVENTS = [
  'BankAccountLinked',
  'Tapped Portfolio Card',
  'Tapped Creator Card',
  'Viewed Stripe Modal',
  '$ae_session',
  'SubscriptionCreated',
  'Viewed Creator Profile',        // Check creatorType for premium/regular split
  'Viewed Creator Paywall',
  'Viewed Portfolio Details',       // Check creatorType for premium/regular split
  'DubAutoCopyInitiated',           // Check creatorType for premium/regular split → total_copies
  'AchTransferInitiated',           // → total_ach_transfers
]

const MIXPANEL_CONFIG = {
  PROJECT_ID: '2599235',
  EXPORT_API_BASE: 'https://data.mixpanel.com/api/2.0',
}

/**
 * Stream events from Mixpanel Export API and insert raw into staging table
 * Processing moved to Postgres for 10-50x performance improvement
 */
async function streamAndStageEvents(
  credentials: any,
  supabase: any,
  fromDate: string,
  toDate: string
) {
  console.log('Streaming events from Mixpanel Export API...')

  // Build query parameters
  const params = new URLSearchParams({
    project_id: MIXPANEL_CONFIG.PROJECT_ID,
    from_date: fromDate,
    to_date: toDate,
    event: JSON.stringify(TRACKED_EVENTS),
  })

  const authString = `${credentials.username}:${credentials.secret}`
  const authHeader = `Basic ${btoa(authString)}`
  const url = `${MIXPANEL_CONFIG.EXPORT_API_BASE}/export?${params}`

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: authHeader,
      Accept: 'text/plain',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Mixpanel Export API error (${response.status}): ${errorText}`)
  }

  if (!response.body) {
    throw new Error('No response body from Mixpanel Export API')
  }

  // Process stream line by line - insert raw events into staging table
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let events: any[] = []
  let totalEvents = 0
  let totalEventsInserted = 0
  const BATCH_SIZE = 5000 // Insert 5000 raw events at a time (reduce DB round trips)
  const startTime = Date.now()
  const MAX_EXECUTION_TIME = 120000 // 120 seconds (leave 30s buffer for final batch)

  console.log('Inserting raw events into staging table...')

  while (true) {
    const { done, value } = await reader.read()

    if (value) {
      buffer += decoder.decode(value, { stream: true })

      // Process complete lines
      const lines = buffer.split('\n')
      buffer = lines.pop() || '' // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue

        try {
          const event = JSON.parse(line)

          // Extract fields for staging table
          const distinctId = event.properties.$distinct_id
            || event.properties.distinct_id
            || event.properties.user_id
            || event.properties.$user_id
            || event.properties.identified_id
            || event.properties.$identified_id

          if (!distinctId) continue // Skip events without user ID

          events.push({
            event_name: event.event,
            distinct_id: distinctId,
            properties: event.properties,
            event_time: new Date(event.properties.time * 1000).toISOString() // Unix timestamp to ISO
          })
          totalEvents++

          // Check timeout every 500 events (less frequent checks = better performance)
          if (totalEvents % 500 === 0) {
            const elapsed = Date.now() - startTime
            if (elapsed > MAX_EXECUTION_TIME) {
              console.warn(`⚠️ Approaching timeout after ${Math.round(elapsed / 1000)}s. Staged ${totalEvents} events.`)

              // Save accumulated events before timeout
              if (events.length > 0) {
                const inserted = await insertRawEventsChunk(events, supabase)
                totalEventsInserted += inserted
                console.log(`✓ Saved final ${inserted} events before timeout`)
              }

              console.log(`⚠️ EARLY EXIT: ${totalEventsInserted} events staged. Call process-mixpanel-user-events to complete processing.`)
              return { totalEvents, totalEventsInserted, timedOut: true }
            }
          }

          // Insert batch when we hit BATCH_SIZE
          if (events.length >= BATCH_SIZE) {
            const inserted = await insertRawEventsChunk(events, supabase)
            totalEventsInserted += inserted
            const elapsedSec = Math.round((Date.now() - startTime) / 1000)
            console.log(`✓ Staged ${totalEvents} events, ${totalEventsInserted} inserted (${elapsedSec}s elapsed)`)
            events = [] // Clear for next batch
          }
        } catch (error) {
          console.warn(`Failed to parse event line: ${line.substring(0, 100)}`)
        }
      }
    }

    if (done) {
      // Process any remaining events in buffer
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer)
          const distinctId = event.properties.$distinct_id
            || event.properties.distinct_id
            || event.properties.user_id
            || event.properties.$user_id
            || event.properties.identified_id
            || event.properties.$identified_id

          if (distinctId) {
            events.push({
              event_name: event.event,
              distinct_id: distinctId,
              properties: event.properties,
              event_time: new Date(event.properties.time * 1000).toISOString()
            })
            totalEvents++
          }
        } catch (error) {
          console.warn(`Failed to parse final event`)
        }
      }

      // Insert final batch
      if (events.length > 0) {
        const inserted = await insertRawEventsChunk(events, supabase)
        totalEventsInserted += inserted
      }

      break
    }
  }

  console.log(`✓ Streaming complete: ${totalEvents} events staged, ${totalEventsInserted} inserted`)

  return { totalEvents, totalEventsInserted }
}

/**
 * Insert a batch of raw events into staging table
 */
async function insertRawEventsChunk(
  events: any[],
  supabase: any
): Promise<number> {
  if (events.length === 0) return 0

  const { error } = await supabase
    .from('raw_mixpanel_events_staging')
    .insert(events)

  if (error) {
    console.error('Error inserting raw events chunk:', error)
    throw error
  }

  return events.length
}

serve(async (req) => {
  // Handle CORS preflight requests
  const corsResponse = handleCorsRequest(req)
  if (corsResponse) return corsResponse

  try {
    // Initialize Mixpanel credentials and Supabase client
    const credentials = initializeMixpanelCredentials()
    const supabase = initializeSupabaseClient()

    console.log('Starting Mixpanel user sync v2 (Event Export API - Streaming)...')

    // Parse request body for optional date range (for backfill)
    const body = await req.json().catch(() => ({}))
    const { from_date, to_date } = body

    // Check if sync should be skipped (within 1-hour window) - only for regular daily sync
    if (!from_date && !to_date) {
      const skipResponse = await checkAndHandleSkipSync(supabase, 'mixpanel_users_v2', 1)
      if (skipResponse) return skipResponse
    }

    // Create sync log entry and track execution time
    const executionStartMs = Date.now()
    const { syncLog, syncStartTime } = await createSyncLog(supabase, 'user', 'mixpanel_users_v2')
    const syncLogId = syncLog.id

    try {
      // Calculate date range
      let fromDate: string
      let toDate: string

      if (from_date && to_date) {
        // Backfill mode: use provided dates
        fromDate = from_date
        toDate = to_date
        console.log(`BACKFILL MODE: Date range ${fromDate} to ${toDate}`)
      } else {
        // Regular mode: last 3 days through yesterday (reduced from 7 to avoid staging timeout)
        const today = new Date()
        const yesterday = new Date(today)
        yesterday.setDate(yesterday.getDate() - 1)
        toDate = yesterday.toISOString().split('T')[0] // YYYY-MM-DD (yesterday)

        const threeDaysAgo = new Date(yesterday)
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)
        fromDate = threeDaysAgo.toISOString().split('T')[0] // YYYY-MM-DD

        console.log(`REGULAR MODE: Date range ${fromDate} to ${toDate} (3 days)`)
      }

      console.log(`Tracking ${TRACKED_EVENTS.length} event types:`)
      console.log(`  ${TRACKED_EVENTS.join(', ')}`)

      // Clear staging table before starting (in case previous sync failed)
      console.log('Clearing staging table from any previous incomplete syncs...')
      const { error: clearError } = await supabase.rpc('clear_events_staging')
      if (clearError) {
        console.warn('Warning: Failed to clear staging table:', clearError)
      } else {
        console.log('✓ Staging table cleared')
      }

      // Step 1: Stream events and insert raw into staging table
      console.log('Step 1/3: Streaming events into staging table...')
      const stagingResult = await streamAndStageEvents(
        credentials,
        supabase,
        fromDate,
        toDate
      )

      const stagingElapsedSec = Math.round((Date.now() - executionStartMs) / 1000)

      // Check if staging timed out
      if (stagingResult.timedOut) {
        console.log(`⚠️ Step 1 timed out after staging ${stagingResult.totalEventsInserted} events in ${stagingElapsedSec}s`)
        console.log(`✓ Data saved to staging table. Triggering separate processing function...`)

        // Update sync log to show partial completion
        await updateSyncLogSuccess(supabase, syncLogId, {
          total_records_inserted: 0,
        })

        // Trigger separate processing function using Supabase client
        // This is more reliable than raw fetch
        console.log('Triggering process-mixpanel-user-events via Supabase client...')

        try {
          const { data: triggerData, error: triggerError } = await supabase.functions.invoke(
            'process-mixpanel-user-events',
            { body: { synced_at: syncStartTime.toISOString() } }
          )

          if (triggerError) {
            console.error('⚠️ Failed to trigger processing function:', triggerError)
            console.error('Error details:', JSON.stringify(triggerError, null, 2))
            console.log('💡 Run manual_trigger_processing.sql to process staged events')
          } else {
            console.log('✓ Processing function triggered successfully')
            if (triggerData) {
              console.log('Processing result:', JSON.stringify(triggerData, null, 2))
            }
          }
        } catch (err) {
          console.error('⚠️ Exception triggering processing function:', err.message)
          console.log('💡 Run manual_trigger_processing.sql to process staged events')
        }

        return createSuccessResponse('Staging completed (timed out) - processing triggered separately', {
          totalTimeSeconds: stagingElapsedSec,
          totalEventsStaged: stagingResult.totalEventsInserted,
          timedOut: true,
          note: 'Processing function triggered separately to complete the sync'
        })
      }

      console.log(`✓ Step 1 complete: ${stagingResult.totalEventsInserted} events staged in ${stagingElapsedSec}s`)

      // Step 2: Process staged events using Postgres function (10-50x faster than JS)
      console.log('Step 2/3: Processing events in Postgres...')
      const processingStart = Date.now()

      const { data: processResult, error: processError } = await supabase.rpc(
        'process_raw_events_to_profiles',
        { synced_at: syncStartTime.toISOString() }
      )

      if (processError) {
        console.error('Error processing events in Postgres:', processError)
        throw processError
      }

      const profilesProcessed = processResult[0]?.profiles_processed || 0
      const eventsProcessed = processResult[0]?.events_processed || 0
      const processingElapsedSec = Math.round((Date.now() - processingStart) / 1000)

      console.log(`✓ Step 2 complete: ${profilesProcessed} profiles from ${eventsProcessed} events in ${processingElapsedSec}s`)

      // Step 3: Clear staging table
      console.log('Step 3/3: Clearing staging table...')
      const { error: finalClearError } = await supabase.rpc('clear_events_staging')

      if (finalClearError) {
        console.warn('Warning: Failed to clear staging table:', finalClearError)
        // Don't fail the entire sync if cleanup fails
      } else {
        console.log('✓ Step 3 complete: Staging table cleared')
      }

      const totalElapsedMs = Date.now() - executionStartMs
      const totalElapsedSec = Math.round(totalElapsedMs / 1000)

      // Update sync log with success
      await updateSyncLogSuccess(supabase, syncLogId, {
        total_records_inserted: profilesProcessed,
      })

      console.log(`✅ Sync completed successfully in ${totalElapsedSec}s (${stagingElapsedSec}s staging + ${processingElapsedSec}s processing)`)

      return createSuccessResponse('Subscriber events synced successfully (Postgres-accelerated)', {
        totalTimeSeconds: totalElapsedSec,
        stagingTimeSeconds: stagingElapsedSec,
        processingTimeSeconds: processingElapsedSec,
        totalEvents: stagingResult.totalEventsInserted,
        profilesProcessed,
        dateRange: { fromDate, toDate },
        trackedEvents: TRACKED_EVENTS.length,
      })
    } catch (error) {
      // Update sync log with failure
      await updateSyncLogFailure(supabase, syncLogId, error)
      throw error
    }
  } catch (error) {
    return createErrorResponse(error, 'sync-mixpanel-user-events')
  }
})
