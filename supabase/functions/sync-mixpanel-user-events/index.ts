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
  const MAX_EXECUTION_TIME = 110000 // 110 seconds (leave 40s buffer to trigger processing and return)

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

          // Check timeout every 100 events for earlier detection
          if (totalEvents % 100 === 0) {
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

      // Check if there's leftover staging data from a previous timeout and process it first
      console.log('Checking for leftover staging data from previous sync...')
      const { count: stagedCount, error: countError } = await supabase
        .from('raw_mixpanel_events_staging')
        .select('*', { count: 'exact', head: true })

      if (countError) {
        console.warn('Warning: Failed to check staging table:', countError)
      } else if (stagedCount && stagedCount > 0) {
        console.log(`⚠️ Found ${stagedCount} leftover events in staging. Processing them first...`)

        try {
          const { data: triggerData, error: triggerError } = await supabase.functions.invoke(
            'process-mixpanel-user-events',
            { body: { synced_at: new Date().toISOString() } }
          )

          if (triggerError) {
            console.error('⚠️ Failed to process leftover staging data:', triggerError)
            console.log('💡 Clearing staging table to allow new sync to proceed')
            await supabase.rpc('clear_events_staging')
          } else {
            console.log('✓ Leftover staging data processed successfully')
          }
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err)
          console.error('⚠️ Exception processing leftover staging data:', errorMessage)
          console.log('💡 Clearing staging table to allow new sync to proceed')
          await supabase.rpc('clear_events_staging')
        }
      } else {
        console.log('✓ No leftover staging data found')
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

        // Trigger separate processing function with 5-second timeout
        // Wait briefly for initial response, then return (processing continues in background)
        console.log('Triggering process-mixpanel-user-events (5s timeout)...')

        try {
          // Race between invoke and 5-second timeout
          const triggerPromise = supabase.functions.invoke(
            'process-mixpanel-user-events',
            { body: { synced_at: syncStartTime.toISOString() } }
          )

          const timeoutPromise = new Promise<{ data: null; error: { message: string } }>((resolve) =>
            setTimeout(() => resolve({
              data: null,
              error: { message: 'Trigger timeout (5s) - processing continues in background' }
            }), 5000)
          )

          const { data: triggerData, error: triggerError } = await Promise.race([
            triggerPromise,
            timeoutPromise
          ])

          if (triggerError) {
            if (triggerError.message.includes('Trigger timeout')) {
              console.log('⏱️ Trigger initiated (5s wait exceeded) - processing continues in background')
              console.log('💡 Next sync will verify processing completed. If not, leftover data will be processed.')
            } else {
              console.error('⚠️ Failed to trigger processing function:', triggerError)
              console.error('Error details:', JSON.stringify(triggerError, null, 2))
              console.log('💡 Leftover data check on next sync will process staged events')
            }
          } else {
            console.log('✓ Processing function triggered successfully')
            if (triggerData) {
              console.log('Processing result:', JSON.stringify(triggerData, null, 2))
            }
          }
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err)
          console.error('⚠️ Exception triggering processing function:', errorMessage)
          console.log('💡 Leftover data check on next sync will process staged events')
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

      // Step 3: Refresh dependent materialized views
      console.log('Step 3/5: Refreshing main_analysis view...')
      const mainAnalysisStart = Date.now()
      const { error: mainAnalysisError } = await supabase.rpc('refresh_main_analysis')

      if (mainAnalysisError) {
        console.error('Error refreshing main_analysis:', mainAnalysisError)
        throw mainAnalysisError
      }

      const mainAnalysisElapsedSec = Math.round((Date.now() - mainAnalysisStart) / 1000)
      console.log(`✓ Step 3 complete: main_analysis refreshed in ${mainAnalysisElapsedSec}s`)

      // Step 4: Refresh copy_engagement_summary
      console.log('Step 4/5: Refreshing copy_engagement_summary view...')
      const copyEngagementStart = Date.now()
      const { error: copyEngagementError } = await supabase.rpc('refresh_copy_engagement_summary')

      if (copyEngagementError) {
        console.error('Error refreshing copy_engagement_summary:', copyEngagementError)
        throw copyEngagementError
      }

      const copyEngagementElapsedSec = Math.round((Date.now() - copyEngagementStart) / 1000)
      console.log(`✓ Step 4 complete: copy_engagement_summary refreshed in ${copyEngagementElapsedSec}s`)

      // Step 5: Clear staging table
      console.log('Step 5/5: Clearing staging table...')
      const { error: finalClearError } = await supabase.rpc('clear_events_staging')

      if (finalClearError) {
        console.warn('Warning: Failed to clear staging table:', finalClearError)
        // Don't fail the entire sync if cleanup fails
      } else {
        console.log('✓ Step 5 complete: Staging table cleared')
      }

      const totalElapsedMs = Date.now() - executionStartMs
      const totalElapsedSec = Math.round(totalElapsedMs / 1000)

      // Update sync log with success
      await updateSyncLogSuccess(supabase, syncLogId, {
        total_records_inserted: profilesProcessed,
      })

      console.log(`✅ Sync completed successfully in ${totalElapsedSec}s (${stagingElapsedSec}s staging + ${processingElapsedSec}s processing + ${mainAnalysisElapsedSec}s main_analysis + ${copyEngagementElapsedSec}s copy_engagement)`)

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
