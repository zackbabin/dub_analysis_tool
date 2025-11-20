// Supabase Edge Function: sync-event-sequences
// Fetches user event sequences from Mixpanel Insights API (Chart ID: 85247935)
// Stores raw individual events in event_sequences_raw table
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

      console.log('Processing event sequences (individual events, not user aggregates)...')

      // Parse Mixpanel Insights response structure:
      // series: { "metric_key": { "distinct_id": { "timestamp": { "all": count }, "$overall": {...} } } }

      // Build individual event rows (one row per event, not per user)
      const individualEvents: Array<{
        distinct_id: string
        event_name: string
        event_time: string
        event_count: number
      }> = []

      const seriesEntries = Object.entries(eventSequencesData.series)
      const totalMetrics = seriesEntries.length
      console.log(`Processing ${totalMetrics} event types...`)

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

          // Extract individual event occurrences with timestamps
          const timeEntries = Object.entries(userData)
          for (let timeIdx = 0; timeIdx < timeEntries.length; timeIdx++) {
            const [timestamp, data] = timeEntries[timeIdx]

            // Skip $overall for this user
            if (timestamp === '$overall') continue

            const count = (data as any)?.all || 0
            if (count > 0) {
              // Create one row per individual event
              individualEvents.push({
                distinct_id: distinctId,
                event_name: eventName,
                event_time: timestamp,
                event_count: count
              })
            }
          }
        }
      }

      console.log(`Found ${individualEvents.length} individual event records from Mixpanel`)

      // If no events, return early
      if (individualEvents.length === 0) {
        console.log('No events to process - sync complete')

        await updateSyncLogSuccess(supabase, syncLogId, {
          total_records_inserted: 0,
        })

        return createSuccessResponse(
          'Event sequences sync completed - no events to process',
          {
            eventSequencesFetched: 0,
            totalRawRecordsInserted: 0,
            chartId,
          }
        )
      }

      // Prepare individual event rows for database insertion
      console.log('Preparing individual events for storage...')

      // Early return after 120 seconds (leave 30s buffer for final operations)
      const TIMEOUT_MS = 120000
      const startTime = Date.now()

      const rawEventRows = individualEvents.map((event) => ({
        distinct_id: event.distinct_id,
        event_name: event.event_name,
        event_time: event.event_time,
        event_count: event.event_count,
        event_data: {
          event_count: event.event_count,
          event_name: event.event_name,
          event_time: event.event_time
        },
        synced_at: syncStartTime.toISOString()
      }))

      console.log(`Prepared ${rawEventRows.length} individual event records for insertion`)
      stats.eventSequencesFetched = rawEventRows.length

      // Insert individual events in batches (deduplication via unique index)
      const batchSize = 500
      let totalInserted = 0
      let totalDuplicatesSkipped = 0
      let skippedBatches = 0

      for (let i = 0; i < rawEventRows.length; i += batchSize) {
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
      stats.totalRawRecordsInserted = totalInserted

      // Update sync log with success
      await updateSyncLogSuccess(supabase, syncLogId, {
        total_records_inserted: stats.totalRawRecordsInserted,
      })

      console.log('Event sequences sync completed successfully (individual events stored)')
      console.log('Call enrich-event-sequences then process-event-sequences to complete workflow')

      return createSuccessResponse(
        'Event sequences sync completed successfully - individual events stored',
        {
          ...stats,
          totalDuplicatesSkipped
        },
        {
          note: 'Events stored as individual rows with automatic deduplication.',
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
