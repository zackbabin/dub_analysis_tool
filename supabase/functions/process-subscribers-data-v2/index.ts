// Supabase Edge Function: process-subscribers-data-v2 (Event Export API - Streaming)
// Streams events directly from Mixpanel Export API, processes into user profiles, and upserts to subscribers_insights_v2
// Handles event counting, property extraction, and batch upserts with memory efficiency
// Triggered by sync-mixpanel-users-v2 with date range parameters

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { fetchEventsExport } from '../_shared/mixpanel-api.ts'
import { processEventsToUserProfiles, formatProfilesForDB } from '../_shared/mixpanel-events-processor.ts'
import {
  initializeMixpanelCredentials,
  initializeSupabaseClient,
  handleCorsRequest,
  updateSyncLogSuccess,
  updateSyncLogFailure,
  createSuccessResponse,
  createErrorResponse,
} from '../_shared/sync-helpers.ts'

interface SyncStats {
  eventsProcessed: number
  uniqueUsers: number
  totalRecordsInserted: number
}

serve(async (req) => {
  // Handle CORS preflight requests
  const corsResponse = handleCorsRequest(req)
  if (corsResponse) return corsResponse

  try {
    const supabase = initializeSupabaseClient()
    const credentials = initializeMixpanelCredentials()

    // Get parameters from request body
    const body = await req.json()
    const { fromDate, toDate, trackedEvents, syncLogId } = body

    if (!fromDate || !toDate || !trackedEvents || !syncLogId) {
      throw new Error('Missing required parameters: fromDate, toDate, trackedEvents, syncLogId')
    }

    console.log(`Starting subscriber data processing v2 (streaming)...`)
    console.log(`Date range: ${fromDate} to ${toDate}`)
    console.log(`Tracking ${trackedEvents.length} event types`)

    try {
      // Track elapsed time with timeout prevention
      const startTime = Date.now()
      const TIMEOUT_BUFFER_MS = 130000 // Exit after 130s (20s buffer before 150s timeout)
      const logElapsed = () => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
        console.log(`⏱️  Elapsed: ${elapsed}s / 150s`)
        return elapsed
      }

      // Fetch events directly from Mixpanel Export API (streaming)
      console.log('Fetching events from Export API...')
      const events = await fetchEventsExport(
        credentials,
        fromDate,
        toDate,
        trackedEvents
      )

      logElapsed()
      console.log(`✓ Fetched ${events.length} events`)

      // Process events into user profiles
      console.log('Processing events into user profiles...')
      const userProfiles = processEventsToUserProfiles(events)
      logElapsed()
      console.log(`✓ Built ${userProfiles.length} user profiles`)

      // Format profiles for database
      const syncStartTime = new Date().toISOString()
      const profileRows = formatProfilesForDB(userProfiles, syncStartTime)
      console.log(`✓ Formatted ${profileRows.length} rows for database`)

      const stats: SyncStats = {
        eventsProcessed: events.length,
        uniqueUsers: profileRows.length,
        totalRecordsInserted: 0,
      }

      // Upsert user profiles in batches to avoid memory/timeout issues
      const batchSize = 2000
      const maxConcurrentBatches = 5
      let totalProcessed = 0

      const batches: any[][] = []
      for (let i = 0; i < profileRows.length; i += batchSize) {
        batches.push(profileRows.slice(i, i + batchSize))
      }

      console.log(`Split into ${batches.length} batches, processing ${maxConcurrentBatches} at a time...`)

      for (let i = 0; i < batches.length; i += maxConcurrentBatches) {
        // Check if we're approaching timeout
        const elapsedMs = Date.now() - startTime
        if (elapsedMs > TIMEOUT_BUFFER_MS) {
          console.warn(`⚠️ Approaching timeout. Processed ${totalProcessed}/${profileRows.length} users.`)
          break
        }

        const batchChunk = batches.slice(i, i + maxConcurrentBatches)
        console.log(`Processing batch group ${Math.floor(i / maxConcurrentBatches) + 1}/${Math.ceil(batches.length / maxConcurrentBatches)}...`)

        // Process batches in parallel
        const results = await Promise.all(
          batchChunk.map((batch) =>
            supabase
              .from('subscribers_insights_v2')
              .upsert(batch, {
                onConflict: 'distinct_id',
                ignoreDuplicates: false,
              })
          )
        )

        // Check for errors
        for (const result of results) {
          if (result.error) {
            console.error('Error upserting batch:', result.error)
            throw result.error
          }
        }

        totalProcessed += batchChunk.reduce((sum, batch) => sum + batch.length, 0)
        logElapsed()
        console.log(`✓ Processed ${totalProcessed}/${profileRows.length} users`)
      }

      stats.totalRecordsInserted = totalProcessed

      // Update sync log with success
      await updateSyncLogSuccess(supabase, syncLogId, {
        subscribers_fetched: stats.uniqueUsers,
        total_records_inserted: stats.totalRecordsInserted,
      })

      console.log('Subscriber processing v2 completed successfully')

      return createSuccessResponse('Subscriber data processed and inserted successfully (v2)', {
        totalEvents: stats.eventsProcessed,
        totalRecordsInserted: stats.totalRecordsInserted,
      })
    } catch (error) {
      // Update sync log with failure
      await updateSyncLogFailure(supabase, syncLogId, error)
      throw error
    }
  } catch (error) {
    return createErrorResponse(error, 'process-subscribers-data-v2')
  }
})
