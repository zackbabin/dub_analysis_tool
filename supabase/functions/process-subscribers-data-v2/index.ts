// Supabase Edge Function: process-subscribers-data-v2 (Event Export API)
// Part 2 of 2: Loads raw events from Storage, processes into user profiles, and upserts to subscribers_insights_v2
// Handles event counting, property extraction, and batch upserts with timeout prevention
// Triggered by sync-mixpanel-users-v2 after events are stored

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { processEventsToUserProfiles, formatProfilesForDB } from '../_shared/mixpanel-events-processor.ts'
import {
  initializeSupabaseClient,
  handleCorsRequest,
  createSyncLog,
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

    // Get filename from request body
    const body = await req.json()
    const filename = body.filename

    if (!filename) {
      throw new Error('Missing filename parameter')
    }

    console.log(`Starting subscriber data processing v2 for ${filename}...`)

    // Create sync log entry
    const { syncLog, syncStartTime } = await createSyncLog(supabase, 'user', 'subscribers_processing_v2')
    const syncLogId = syncLog.id

    try {
      // Track elapsed time with timeout prevention
      const startTime = Date.now()
      const TIMEOUT_BUFFER_MS = 130000 // Exit after 130s (20s buffer before 150s timeout)
      const logElapsed = () => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
        console.log(`⏱️  Elapsed: ${elapsed}s / 150s`)
        return elapsed
      }

      // Download raw events from Storage
      console.log('Downloading raw events from Storage...')
      const { data: fileData, error: downloadError } = await supabase.storage
        .from('mixpanel-raw-data')
        .download(filename)

      if (downloadError) {
        console.error('Error downloading from storage:', downloadError)
        throw downloadError
      }

      const rawDataText = await fileData.text()
      const rawData = JSON.parse(rawDataText)

      logElapsed()
      console.log('✓ Raw events loaded from Storage')

      const { events, stats: fetchStats } = rawData

      // Validate data
      if (!events || !Array.isArray(events)) {
        throw new Error('Invalid data format: events must be an array')
      }

      console.log(`Received ${events.length} events to process`)
      if (fetchStats) {
        console.log(`Fetch stats: ${fetchStats.totalEvents} events, date range: ${fetchStats.dateRange.fromDate} to ${fetchStats.dateRange.toDate}`)
      }

      // Process events into user profiles
      console.log('Processing events into user profiles...')
      const userProfiles = processEventsToUserProfiles(events)
      logElapsed()
      console.log(`✓ Built ${userProfiles.length} user profiles`)

      // Format profiles for database
      const profileRows = formatProfilesForDB(userProfiles, syncStartTime.toISOString())
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

      // Delete the raw data file from storage (cleanup)
      console.log('Cleaning up storage file...')
      const { error: deleteError } = await supabase.storage
        .from('mixpanel-raw-data')
        .remove([filename])

      if (deleteError) {
        console.warn('⚠️ Failed to delete storage file:', deleteError.message)
      } else {
        console.log('✓ Storage file cleaned up')
      }

      console.log('Subscriber processing v2 completed successfully')

      return createSuccessResponse('Subscriber data processed and inserted successfully (v2)', stats)
    } catch (error) {
      // Update sync log with failure
      await updateSyncLogFailure(supabase, syncLogId, error)
      throw error
    }
  } catch (error) {
    return createErrorResponse(error, 'process-subscribers-data-v2')
  }
})
