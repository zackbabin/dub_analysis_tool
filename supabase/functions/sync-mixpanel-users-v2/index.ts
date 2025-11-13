// Supabase Edge Function: sync-mixpanel-users-v2 (Event Export API - Streaming)
// Streams events from Mixpanel Export API, processes incrementally to avoid memory issues
// Processes events in chunks and upserts to subscribers_insights_v2

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { processEventsToUserProfiles, formatProfilesForDB } from '../_shared/mixpanel-events-processor.ts'
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

// 12 events that we can track from Export API
const TRACKED_EVENTS = [
  'Viewed Portfolio Details',
  'Viewed Creator Profile',
  'BankAccountLinked',
  'AchTransferInitiated',
  'DubAutoCopyInitiated',
  'Viewed Creator Paywall',
  'SubscriptionCreated',
  '$ae_session',
  'Viewed Discover Tab',
  'Viewed Stripe Modal',
  'Tapped Creator Card',
  'Tapped Portfolio Card',
]

const MIXPANEL_CONFIG = {
  PROJECT_ID: '2599235',
  EXPORT_API_BASE: 'https://data.mixpanel.com/api/2.0',
}

/**
 * Stream and process events from Mixpanel Export API line by line
 * Processes in chunks to avoid memory overload
 */
async function streamAndProcessEvents(
  credentials: any,
  supabase: any,
  fromDate: string,
  toDate: string,
  syncStartTime: Date
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

  // Process stream line by line
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let events: any[] = []
  let totalEvents = 0
  let totalRecordsInserted = 0
  const CHUNK_SIZE = 5000 // Process 5k events at a time

  console.log('Processing events in chunks...')

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
          events.push(event)
          totalEvents++

          // Process chunk when we hit CHUNK_SIZE
          if (events.length >= CHUNK_SIZE) {
            const inserted = await processAndUpsertChunk(events, supabase, syncStartTime)
            totalRecordsInserted += inserted
            console.log(`✓ Processed ${totalEvents} events, ${totalRecordsInserted} users upserted`)
            events = [] // Clear for next chunk
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
          events.push(event)
          totalEvents++
        } catch (error) {
          console.warn(`Failed to parse final event`)
        }
      }

      // Process final chunk
      if (events.length > 0) {
        const inserted = await processAndUpsertChunk(events, supabase, syncStartTime)
        totalRecordsInserted += inserted
      }

      break
    }
  }

  console.log(`✓ Streaming complete: ${totalEvents} events processed, ${totalRecordsInserted} users upserted`)

  return { totalEvents, totalRecordsInserted }
}

/**
 * Process a chunk of events and upsert to database
 */
async function processAndUpsertChunk(
  events: any[],
  supabase: any,
  syncStartTime: Date
): Promise<number> {
  // Process events into user profiles
  const userProfiles = processEventsToUserProfiles(events)

  // Format profiles for database
  const profileRows = formatProfilesForDB(userProfiles, syncStartTime.toISOString())

  if (profileRows.length === 0) {
    return 0
  }

  // Upsert to database
  const { error } = await supabase
    .from('subscribers_insights_v2')
    .upsert(profileRows, {
      onConflict: 'distinct_id',
      ignoreDuplicates: false,
    })

  if (error) {
    console.error('Error upserting chunk:', error)
    throw error
  }

  return profileRows.length
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

    // Check if sync should be skipped (within 1-hour window)
    const skipResponse = await checkAndHandleSkipSync(supabase, 'mixpanel_users_v2', 1)
    if (skipResponse) return skipResponse

    // Create sync log entry and track execution time
    const executionStartMs = Date.now()
    const { syncLog, syncStartTime } = await createSyncLog(supabase, 'user', 'mixpanel_users_v2')
    const syncLogId = syncLog.id

    try {
      // Calculate date range: just yesterday (1 day)
      // Mixpanel Export API uses UTC and rejects dates in the future
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      const toDate = yesterday.toISOString().split('T')[0] // YYYY-MM-DD
      const fromDate = toDate // Same date = 1 day only

      console.log(`Date range: ${fromDate} to ${toDate}`)
      console.log(`Tracking ${TRACKED_EVENTS.length} event types:`)
      console.log(`  ${TRACKED_EVENTS.join(', ')}`)

      // Stream and process events
      const { totalEvents, totalRecordsInserted } = await streamAndProcessEvents(
        credentials,
        supabase,
        fromDate,
        toDate,
        syncStartTime
      )

      const elapsedMs = Date.now() - executionStartMs
      const elapsedSec = Math.round(elapsedMs / 1000)

      // Update sync log with success
      await updateSyncLogSuccess(supabase, syncLogId, {
        total_records_inserted: totalRecordsInserted,
      })

      console.log(`Sync completed successfully in ${elapsedSec}s`)

      return createSuccessResponse('Subscriber events synced successfully via streaming (v2)', {
        totalTimeSeconds: elapsedSec,
        totalEvents,
        totalRecordsInserted,
        dateRange: { fromDate, toDate },
        trackedEvents: TRACKED_EVENTS.length,
      })
    } catch (error) {
      // Update sync log with failure
      await updateSyncLogFailure(supabase, syncLogId, error)
      throw error
    }
  } catch (error) {
    return createErrorResponse(error, 'sync-mixpanel-users-v2')
  }
})
