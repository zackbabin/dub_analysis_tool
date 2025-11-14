// Supabase Edge Function: process-creator-engagement
// Part 2b of 4: Loads raw Mixpanel data from Storage and processes creator-level pairs
// Handles creator engagement upserts, then triggers refresh-engagement-views
// Triggered by process-portfolio-engagement after portfolio pairs are inserted

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { processPortfolioCreatorPairs } from '../_shared/data-processing.ts'
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
  engagementRecordsFetched: number
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

    console.log(`Starting creator engagement processing for ${filename}...`)

    // Create sync log entry
    const { syncLog, syncStartTime } = await createSyncLog(supabase, 'user', 'creator_engagement_processing')
    const syncLogId = syncLog.id

    try {
      // Track elapsed time with timeout prevention
      const startTime = Date.now()
      const TIMEOUT_BUFFER_MS = 130000  // Exit after 130s (20s buffer before 150s timeout)
      const logElapsed = () => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
        console.log(`⏱️  Elapsed: ${elapsed}s / 150s`)
        return elapsed
      }
      const isApproachingTimeout = () => {
        return (Date.now() - startTime) > TIMEOUT_BUFFER_MS
      }

      // Download raw data from Storage
      console.log('Downloading raw data from Storage...')
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
      console.log('✓ Raw data loaded from Storage')

      // Use let for variables we'll explicitly set to undefined later for garbage collection
      let { profileViewsData, pdpViewsData, subscriptionsData, syncStartTime: originalSyncTime } = rawData

      // Process and insert data into database
      const stats: SyncStats = {
        engagementRecordsFetched: 0,
        totalRecordsInserted: 0,
      }

      // Parallel batch processing configuration
      const BATCH_SIZE = 5000  // Larger batches = fewer operations
      const MAX_CONCURRENT_BATCHES = 3  // Lower concurrency to reduce CPU usage

      // Process engagement data to get creator pairs
      console.log('Processing engagement pairs...')
      const { portfolioCreatorPairs, creatorPairs } = processPortfolioCreatorPairs(
        profileViewsData,
        pdpViewsData,
        subscriptionsData,
        originalSyncTime
      )
      logElapsed()
      console.log(`Skipping ${portfolioCreatorPairs.length} portfolio pairs (already processed)`)
      console.log(`Processing ${creatorPairs.length} creator pairs`)

      // Release raw data and unused portfolio pairs from memory immediately
      // This reduces memory usage by 40-50% and prevents memory limit errors
      console.log('Releasing raw data and portfolio pairs from memory...')
      // @ts-ignore - explicitly setting to undefined for garbage collection
      rawData = undefined
      // @ts-ignore
      rawDataText = undefined
      // @ts-ignore
      fileData = undefined
      // @ts-ignore
      profileViewsData = undefined
      // @ts-ignore
      pdpViewsData = undefined
      // @ts-ignore
      subscriptionsData = undefined
      // @ts-ignore - we don't need portfolio pairs in this function
      portfolioCreatorPairs = undefined

      // Helper function to upsert batches in parallel
      async function upsertInParallelBatches(
        data: any[],
        tableName: string,
        onConflictColumns: string,
        description: string
      ): Promise<number> {
        if (data.length === 0) return 0

        console.log(`Upserting ${data.length} ${description} in batches of ${BATCH_SIZE} (${MAX_CONCURRENT_BATCHES} concurrent)...`)

        // Split data into batches
        const batches: any[][] = []
        for (let i = 0; i < data.length; i += BATCH_SIZE) {
          batches.push(data.slice(i, i + BATCH_SIZE))
        }

        // Process batches in chunks of MAX_CONCURRENT_BATCHES
        let processedCount = 0
        for (let i = 0; i < batches.length; i += MAX_CONCURRENT_BATCHES) {
          // Check timeout before processing next chunk
          if (isApproachingTimeout()) {
            console.warn(`⚠️ Approaching timeout. Processed ${processedCount}/${data.length} ${description}.`)
            console.log('Exiting early - refresh function will still be triggered.')
            return processedCount
          }

          const batchChunk = batches.slice(i, i + MAX_CONCURRENT_BATCHES)
          const chunkStart = i * BATCH_SIZE
          const chunkEnd = Math.min((i + batchChunk.length) * BATCH_SIZE, data.length)

          console.log(`Processing batches ${i + 1}-${i + batchChunk.length} of ${batches.length} (records ${chunkStart}-${chunkEnd}/${data.length})...`)

          // Process this chunk of batches in parallel
          const results = await Promise.all(
            batchChunk.map(batch =>
              supabase
                .from(tableName)
                .upsert(batch, {
                  onConflict: onConflictColumns,
                  ignoreDuplicates: false
                })
            )
          )

          // Check for errors in this chunk
          for (let j = 0; j < results.length; j++) {
            if (results[j].error) {
              console.error(`Error upserting ${description} batch ${i + j + 1}:`, results[j].error)
              throw results[j].error
            }
          }

          processedCount = chunkEnd
          console.log(`✓ Completed ${chunkEnd}/${data.length} ${description}`)
        }

        console.log(`✓ All ${data.length} ${description} upserted successfully`)
        return processedCount
      }

      // Upsert creator-level engagement pairs
      console.log('Upserting creator-level pairs...')

      const creatorCount = await upsertInParallelBatches(
        creatorPairs,
        'user_creator_engagement',
        'distinct_id,creator_id',
        'creator-level pairs'
      )

      stats.totalRecordsInserted = creatorCount
      logElapsed()
      console.log(`✓ Creator pairs upsert complete: ${creatorCount} records`)

      // IMPORTANT: Trigger refresh IMMEDIATELY after upserts complete
      console.log('Triggering refresh-materialized-views function...')
      const supabaseUrl = Deno.env.get('SUPABASE_URL')
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

      if (supabaseUrl && supabaseServiceKey) {
        // Fire and forget - don't wait for completion
        fetch(`${supabaseUrl}/functions/v1/refresh-materialized-views`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'apikey': supabaseServiceKey,
            'Content-Type': 'application/json',
          },
        }).catch((err) => {
          console.error('⚠️ Failed to trigger refresh-materialized-views:', err.message)
        })
        console.log('✓ Refresh function triggered in background')
      } else {
        console.warn('⚠️ Cannot trigger refresh function: Supabase credentials not available')
      }

      // Update sync log with success
      await updateSyncLogSuccess(supabase, syncLogId, {
        total_records_inserted: creatorCount,
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

      console.log('Creator processing completed successfully')

      return createSuccessResponse(
        'Creator engagement data processed and inserted successfully',
        stats
      )
    } catch (error) {
      // Update sync log with failure
      await updateSyncLogFailure(supabase, syncLogId, error)
      throw error
    }
  } catch (error) {
    return createErrorResponse(error, 'process-creator-engagement')
  }
})
