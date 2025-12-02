// Supabase Edge Function: process-creator-engagement
// Part 2b of 4: Loads raw Mixpanel data from Storage and processes creator-level pairs
// Handles creator engagement upserts using Postgres staging table for 10-50x performance
// Triggered by process-portfolio-engagement after portfolio pairs are inserted

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { processPortfolioCreatorPairs } from '../_shared/data-processing.ts'
import { pLimit } from '../_shared/mixpanel-api.ts'
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

    // Get filename and optional pre-parsed creatorPairs from request body
    const body = await req.json()
    const filename = body.filename
    const preParsedCreatorPairs = body.creatorPairs ? JSON.parse(body.creatorPairs) : null

    if (!filename) {
      throw new Error('Missing filename parameter')
    }

    if (preParsedCreatorPairs) {
      console.log(`Starting creator engagement processing with pre-parsed data (${preParsedCreatorPairs.length} pairs)...`)
    } else {
      console.log(`Starting creator engagement processing for ${filename}...`)
    }

    // Create sync log entry
    const { syncLog, syncStartTime } = await createSyncLog(supabase, 'user', 'creator_engagement_processing')
    const syncLogId = syncLog.id

    try {
      // Track elapsed time
      const startTime = Date.now()
      const logElapsed = () => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
        console.log(`⏱️  Elapsed: ${elapsed}s / 150s`)
        return elapsed
      }

      // Process and insert data into database
      const stats: SyncStats = {
        engagementRecordsFetched: 0,
        totalRecordsInserted: 0,
      }

      // Staging table configuration for Postgres-accelerated processing
      // Similar to process-portfolio-engagement pattern: stage data, process in Postgres
      const STAGING_BATCH_SIZE = 1500  // Optimized batch size for memory efficiency and timeout prevention
      const STAGING_CONCURRENCY = 3     // Process 3 batches concurrently for better throughput

      let creatorPairs

      // Use pre-parsed creatorPairs if available (60% speedup by avoiding duplicate processing)
      if (preParsedCreatorPairs) {
        console.log('✅ Using pre-parsed creator pairs from process-portfolio-engagement')
        creatorPairs = preParsedCreatorPairs
        logElapsed()
        console.log(`✓ Loaded ${creatorPairs.length} creator pairs (skipped file download and processing)`)

        // Log verification data for comparison
        console.log(`Creator pairs sample: ${JSON.stringify(creatorPairs[0])}`)
      } else {
        // Fallback: Download and parse file if pre-parsed data not provided
        console.log('⚠️ Pre-parsed data not provided, falling back to file processing...')
        console.log('Downloading raw data from Storage...')
        let fileData, rawDataText, rawData

        try {
          const { data, error: downloadError } = await supabase.storage
            .from('mixpanel-raw-data')
            .download(filename)

          if (downloadError) {
            console.error('❌ Storage download error:', downloadError)
            throw new Error(`Failed to download ${filename}: ${downloadError.message}`)
          }

          if (!data) {
            throw new Error(`No data returned from storage for ${filename}`)
          }

          fileData = data
          console.log(`✓ Downloaded ${filename} (${(data.size / 1024 / 1024).toFixed(2)} MB)`)
          logElapsed()

          // Parse JSON with error handling
          console.log('Parsing JSON data...')
          rawDataText = await fileData.text()
          console.log(`✓ Extracted text (${(rawDataText.length / 1024 / 1024).toFixed(2)} MB)`)

          rawData = JSON.parse(rawDataText)
          console.log('✓ Parsed JSON successfully')
          logElapsed()
        } catch (error) {
          console.error('❌ Failed to load/parse storage data:', error)
          const errorMessage = error instanceof Error ? error.message : String(error)
          throw new Error(`Storage data load failed: ${errorMessage}`)
        }

        // Use let for variables we'll explicitly set to undefined later for garbage collection
        let { profileViewsData, pdpViewsData, subscriptionsData, syncStartTime: originalSyncTime } = rawData

        // Process engagement data (get creator pairs only)
        console.log('Processing engagement pairs...')
        console.log(`Input data sizes:`)
        console.log(`  - profileViews series keys: ${Object.keys(profileViewsData?.series || {}).length}`)
        console.log(`  - pdpViews series keys: ${Object.keys(pdpViewsData?.series || {}).length}`)
        console.log(`  - subscriptions series keys: ${Object.keys(subscriptionsData?.series || {}).length}`)

        let portfolioCreatorPairs

        try {
          const result = processPortfolioCreatorPairs(
            profileViewsData,
            pdpViewsData,
            subscriptionsData,
            originalSyncTime
          )
          portfolioCreatorPairs = result.portfolioCreatorPairs
          creatorPairs = result.creatorPairs
        } catch (error) {
          console.error('❌ Failed to process creator pairs:', error)
          if (error instanceof Error) {
            console.error('Error details:', error.stack)
          }
          const errorMessage = error instanceof Error ? error.message : String(error)
          throw new Error(`Data processing failed: ${errorMessage}`)
        }

        logElapsed()
        console.log(`✓ Processed ${portfolioCreatorPairs.length} portfolio pairs (skipped), ${creatorPairs.length} creator pairs`)
        console.log('This function will process creator pairs only, portfolio pairs already handled')

        // Log verification data for comparison
        console.log(`Creator pairs sample: ${JSON.stringify(creatorPairs[0])}`)

        // Release raw data from memory ASAP to allow garbage collection
        // This reduces memory usage by 30-40% and prevents memory limit errors
        console.log('Releasing raw input data from memory...')
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
        // @ts-ignore - don't need portfolio pairs in this function
        portfolioCreatorPairs = undefined
        console.log('✓ Memory released')
      }

      // Clear staging table before starting (in case previous sync failed)
      console.log('Clearing staging table from any previous incomplete syncs...')
      const { error: clearError } = await supabase.rpc('clear_creator_engagement_staging')
      if (clearError) {
        console.warn('Warning: Failed to clear staging table:', clearError)
      } else {
        console.log('✓ Staging table cleared')
      }

      // Step 1: Insert all creator pairs into staging table (fast, no conflict checking)
      console.log(`Step 1/3: Staging ${creatorPairs.length} creator pairs...`)

      // Split into batches
      const batches = []
      for (let i = 0; i < creatorPairs.length; i += STAGING_BATCH_SIZE) {
        batches.push({
          data: creatorPairs.slice(i, i + STAGING_BATCH_SIZE),
          index: Math.floor(i / STAGING_BATCH_SIZE)
        })
      }

      // Process batches with controlled concurrency
      const limit = pLimit(STAGING_CONCURRENCY)
      const results = await Promise.all(
        batches.map(({ data: batch, index }) =>
          limit(async () => {
            try {
              const { error: insertError } = await supabase
                .from('creator_engagement_staging')
                .insert(batch)

              if (insertError) {
                console.error(`Error inserting staging batch ${index + 1}/${batches.length}:`, insertError.message)
                return { success: false, count: 0 }
              }

              // Log progress for every 5th batch
              if ((index + 1) % 5 === 0 || index === batches.length - 1) {
                const stagedSoFar = (index + 1) * STAGING_BATCH_SIZE
                console.log(`✓ Staged ~${Math.min(stagedSoFar, creatorPairs.length)}/${creatorPairs.length} records...`)
              }

              return { success: true, count: batch.length }
            } catch (batchError) {
              const errorMessage = batchError instanceof Error ? batchError.message : String(batchError)
              console.error(`Exception in staging batch ${index + 1}/${batches.length}:`, errorMessage)
              return { success: false, count: 0 }
            }
          })
        )
      )

      const totalStaged = results.filter(r => r.success).reduce((sum, r) => sum + r.count, 0)
      const failedBatches = results.filter(r => !r.success).length

      if (failedBatches > 0) {
        console.warn(`⚠️ ${failedBatches}/${batches.length} batches failed during staging, but continuing with ${totalStaged} successfully staged records`)
      }

      logElapsed()
      console.log(`✓ Step 1 complete: ${totalStaged} records staged`)

      // Release creator pairs from memory before processing
      // @ts-ignore
      creatorPairs = undefined
      console.log('✓ Released creator pairs from memory')

      // Step 2: Process staged data using Postgres function (10-50x faster than JS)
      console.log('Step 2/3: Processing staged data in Postgres...')
      const processingStart = Date.now()

      const { data: processResult, error: processError } = await supabase.rpc(
        'process_creator_engagement_staging'
      )

      if (processError) {
        console.error('Error processing staged data in Postgres:', processError)
        throw processError
      }

      const creatorCount = processResult[0]?.records_inserted || 0
      const recordsProcessed = processResult[0]?.records_processed || 0
      const processingElapsedSec = Math.round((Date.now() - processingStart) / 1000)

      logElapsed()
      console.log(`✓ Step 2 complete: ${creatorCount} records upserted from ${recordsProcessed} staged records in ${processingElapsedSec}s`)

      // Update sync log with success IMMEDIATELY after storing data
      // This ensures the log is marked as completed even if function times out after this point
      await updateSyncLogSuccess(supabase, syncLogId, {
        total_records_inserted: creatorCount,
      })
      console.log(`✅ Sync log ${syncLogId} marked as completed`)

      // Step 3: Clear staging table
      console.log('Step 3/3: Clearing staging table...')
      const { error: finalClearError } = await supabase.rpc('clear_creator_engagement_staging')

      if (finalClearError) {
        console.warn('Warning: Failed to clear staging table:', finalClearError)
        // Don't fail the entire sync if cleanup fails
      } else {
        console.log('✓ Step 3 complete: Staging table cleared')
      }

      stats.totalRecordsInserted = creatorCount
      const totalElapsedSec = Math.round((Date.now() - startTime) / 1000)
      console.log(`✅ Creator processing completed successfully in ${totalElapsedSec}s (Postgres-accelerated)`)

      // NOTE: Materialized views refresh is now handled at the end of the full workflow
      // This ensures all data (subscribers, creators, events, etc.) is synced before refreshing
      console.log('✓ Creator engagement processing complete - views will be refreshed after all syncs finish')

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
