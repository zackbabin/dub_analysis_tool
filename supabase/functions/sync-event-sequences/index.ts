// Supabase Edge Function: sync-event-sequences
// Fetches user event sequences from Mixpanel Insights API (Chart ID: 85247935)
// Stores raw UNSORTED data in event_sequences_raw table
// Events are sorted by Postgres (see get_sorted_event_sequences() function or event_sequences_sorted view)
// Processing happens in separate process-event-sequences function
// Triggered manually alongside other sync functions

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { fetchInsightsData } from '../_shared/mixpanel-api.ts'
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
} from '../_shared/sync-helpers.ts'

interface SyncStats {
  eventSequencesFetched: number
  totalRawRecordsInserted: number
  chartId: string
}

serve(async (req) => {
  // Handle CORS preflight requests
  const corsResponse = handleCorsRequest(req)
  if (corsResponse) return corsResponse

  try {
    // Initialize Mixpanel credentials and Supabase client
    const credentials = initializeMixpanelCredentials()
    const supabase = initializeSupabaseClient()

    console.log('Starting event sequences sync...')

    // Check if sync should be skipped (within 1-hour window for event sequences)
    const skipResponse = await checkAndHandleSkipSync(supabase, 'mixpanel_event_sequences', 1)
    if (skipResponse) return skipResponse

    // Create sync log entry
    const { syncLog, syncStartTime } = await createSyncLog(supabase, 'user', 'mixpanel_event_sequences')
    const syncLogId = syncLog.id

    try {

      // Fetch event sequences from Insights API (chart 85247935)
      const chartId = '85247935'
      console.log(`Fetching event sequences from Insights API (Chart ${chartId})...`)

      let eventSequencesData

      try {
        eventSequencesData = await fetchInsightsData(
          credentials,
          chartId,
          'User Event Sequences'
        )
      } catch (error: any) {
        // Handle Mixpanel rate limit errors gracefully
        const rateLimitResponse = await handleRateLimitError(supabase, syncLogId, error, {
          eventSequencesFetched: 0,
          totalRawRecordsInserted: 0,
          chartId,
        })
        if (rateLimitResponse) return rateLimitResponse
        throw error
      }

      console.log('✓ Event sequences fetched successfully')

      // Enrichment moved to separate enrich-event-sequences function to avoid timeout
      console.log('ℹ️ Event enrichment will be handled by separate enrich-event-sequences function')

      // Process event sequences data (store raw, enrichment done separately)
      const stats: SyncStats = {
        eventSequencesFetched: 0,
        totalRawRecordsInserted: 0,
        chartId,
      }

      if (!eventSequencesData?.series) {
        console.warn('No event sequence data returned from Mixpanel')
        throw new Error('No event sequence data available')
      }

      // Fetch existing user IDs from database for incremental sync
      console.log('Fetching existing users for incremental sync...')
      const { data: existingUsers, error: fetchError } = await supabase
        .from('event_sequences_raw')
        .select('distinct_id')

      if (fetchError) {
        console.error('Error fetching existing users:', fetchError)
        throw fetchError
      }

      const existingUserIds = new Set(existingUsers?.map(u => u.distinct_id) || [])
      console.log(`Found ${existingUserIds.size} existing users in database - will only process new users`)

      console.log('Processing event sequences...')

      // Parse Mixpanel Insights response structure:
      // series: { "metric_key": { "distinct_id": { "timestamp": { "all": count }, "$overall": {...} } } }

      // Build user event sequences from nested structure (optimized for CPU efficiency)
      const userEventsMap = new Map<string, Array<{event: string, time: string, count: number}>>()
      const seriesEntries = Object.entries(eventSequencesData.series)

      const totalMetrics = seriesEntries.length
      console.log(`Processing ${totalMetrics} metrics...`)

      for (let metricIdx = 0; metricIdx < totalMetrics; metricIdx++) {
        const [metricKey, metricData] = seriesEntries[metricIdx]

        if (typeof metricData !== 'object' || metricData === null) continue

        // Clean up metric name (remove prefix like "A. ", "B. ", etc.)
        const eventName = metricKey.replace(/^[A-Z]\.\s*/, '').replace(/^Total\s+/, '')
        const userEntries = Object.entries(metricData as Record<string, any>)

        for (let userIdx = 0; userIdx < userEntries.length; userIdx++) {
          const [distinctId, userData] = userEntries[userIdx]

          // Skip $overall aggregates and focus on actual distinct_ids
          if (distinctId === '$overall') continue

          // Skip users that already exist in database (incremental sync)
          if (existingUserIds.has(distinctId)) continue

          // Get or create event array for this user
          let userEvents = userEventsMap.get(distinctId)
          if (!userEvents) {
            userEvents = []
            userEventsMap.set(distinctId, userEvents)
          }

          // Extract individual event occurrences with timestamps
          const timeEntries = Object.entries(userData)
          for (let timeIdx = 0; timeIdx < timeEntries.length; timeIdx++) {
            const [timestamp, data] = timeEntries[timeIdx]

            // Skip $overall for this user
            if (timestamp === '$overall') continue

            const count = (data as any)?.all || 0
            if (count > 0) {
              userEvents.push({
                event: eventName,
                time: timestamp,
                count: count
              })
            }
          }
        }
      }

      console.log(`Found ${userEventsMap.size} NEW users with event sequences (${existingUserIds.size} existing users skipped)`)

      // If no new users, return early
      if (userEventsMap.size === 0) {
        console.log('No new users to process - sync complete')

        await updateSyncLogSuccess(supabase, syncLogId, {
          total_records_inserted: 0,
        })

        return createSuccessResponse(
          'Event sequences sync completed - no new users to process',
          {
            eventSequencesFetched: 0,
            totalRawRecordsInserted: 0,
            chartId,
          }
        )
      }

      // Convert to raw rows for database insertion (no enrichment - done separately)
      console.log('Preparing event sequences for storage...')
      const rawEventRows: any[] = []
      const userEntries = Array.from(userEventsMap.entries())
      const totalUsers = userEntries.length

      console.log(`Preparing ${totalUsers} users for storage (sorting moved to database)...`)

      // Early return after 120 seconds (leave 30s buffer for final operations)
      const TIMEOUT_MS = 120000
      const startTime = Date.now()
      let processedUsers = 0

      for (let i = 0; i < totalUsers; i++) {
        // Check timeout every 1000 users to avoid excessive Date.now() calls
        if (i > 0 && i % 1000 === 0 && (Date.now() - startTime) > TIMEOUT_MS) {
          console.warn(`⚠️ Timeout approaching after processing ${i}/${totalUsers} users. Saving progress and will resume next sync.`)
          break
        }

        const [distinctId, events] = userEntries[i]

        // Store events unsorted - Postgres will handle sorting via get_sorted_event_sequences() function
        // This eliminates CPU bottleneck from sorting thousands of events in JavaScript
        rawEventRows.push({
          distinct_id: distinctId,
          event_data: events, // Store raw events as JSONB (sorting done by Postgres)
          synced_at: syncStartTime.toISOString()
        })

        processedUsers++
      }

      console.log(`Prepared ${rawEventRows.length} raw event sequences (${processedUsers}/${totalUsers} users) - sorting will be done by database`)
      stats.eventSequencesFetched = rawEventRows.length

      // Upsert raw data in batches to event_sequences_raw table
      const batchSize = 1000 // Increased from 500 for better performance
      let totalInserted = 0

      for (let i = 0; i < rawEventRows.length; i += batchSize) {
        const batch = rawEventRows.slice(i, i + batchSize)
        const { error: insertError } = await supabase
          .from('event_sequences_raw')
          .upsert(batch, {
            onConflict: 'distinct_id',
            ignoreDuplicates: false
          })

        if (insertError) {
          console.error('Error upserting raw event sequences batch:', insertError)
          throw insertError
        }

        totalInserted += batch.length
      }

      console.log(`Upserted ${totalInserted} raw records in ${Math.ceil(totalInserted / batchSize)} batches`)
      stats.totalRawRecordsInserted = totalInserted

      // Update sync log with success
      await updateSyncLogSuccess(supabase, syncLogId, {
        total_records_inserted: stats.totalRawRecordsInserted,
      })

      console.log('Event sequences sync completed successfully (raw unsorted data stored)')
      console.log('Use event_sequences_sorted view or get_sorted_event_sequences() for sorted data')
      console.log('Call enrich-event-sequences then process-event-sequences to complete workflow')

      return createSuccessResponse(
        'Event sequences sync completed successfully - raw data stored (unsorted)',
        stats,
        {
          note: 'Events stored unsorted. Use event_sequences_sorted view or get_sorted_event_sequences() for sorted data.',
          nextSteps: 'Call enrich-event-sequences then process-event-sequences to complete workflow'
        }
      )
    } catch (error) {
      // Update sync log with failure
      await updateSyncLogFailure(supabase, syncLogId, error)
      throw error
    }
  } catch (error) {
    return createErrorResponse(error, 'sync-event-sequences')
  }
})
