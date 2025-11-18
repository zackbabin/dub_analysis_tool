// Supabase Edge Function: process-portfolio-engagement
// Part 2a of 4: Loads raw Mixpanel data from Storage and processes portfolio-creator pairs
// Handles portfolio engagement upserts, then triggers process-creator-engagement
// Triggered by sync-mixpanel-engagement after raw data is stored

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

    // Get filename from request body
    const body = await req.json()
    const filename = body.filename

    if (!filename) {
      throw new Error('Missing filename parameter')
    }

    console.log(`Starting processing of ${filename}...`)

    // Create sync log entry
    const { syncLog, syncStartTime } = await createSyncLog(supabase, 'user', 'portfolio_engagement_processing')
    const syncLogId = syncLog.id

    try {
      // Track elapsed time
      const startTime = Date.now()
      const logElapsed = () => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
        console.log(`⏱️  Elapsed: ${elapsed}s / 150s`)
        return elapsed
      }

      // Download raw data from Storage with error handling
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

      // Process and insert data into database
      const stats: SyncStats = {
        engagementRecordsFetched: 0,
        totalRecordsInserted: 0,
      }

      // Staging table configuration for Postgres-accelerated processing
      // Similar to sync-mixpanel-user-events pattern: stage data, process in Postgres
      const STAGING_BATCH_SIZE = 1500  // Optimized batch size for memory efficiency and timeout prevention
      const STAGING_CONCURRENCY = 3     // Process 3 batches concurrently for better throughput

      // Process engagement data (both portfolio and creator pairs)
      console.log('Processing engagement pairs...')
      console.log(`Input data sizes:`)
      console.log(`  - profileViews series keys: ${Object.keys(profileViewsData?.series || {}).length}`)
      console.log(`  - pdpViews series keys: ${Object.keys(pdpViewsData?.series || {}).length}`)
      console.log(`  - subscriptions series keys: ${Object.keys(subscriptionsData?.series || {}).length}`)

      let portfolioCreatorPairs, creatorPairs

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
        console.error('❌ Failed to process portfolio-creator pairs:', error)
        if (error instanceof Error) {
          console.error('Error details:', error.stack)
        }
        const errorMessage = error instanceof Error ? error.message : String(error)
        throw new Error(`Data processing failed: ${errorMessage}`)
      }

      logElapsed()
      console.log(`✓ Processed ${portfolioCreatorPairs.length} portfolio pairs, ${creatorPairs.length} creator pairs`)
      console.log('This function will process portfolio pairs only, creator pairs handled by process-creator-engagement')

      // Log verification data for comparison
      console.log(`Portfolio pairs sample: ${JSON.stringify(portfolioCreatorPairs[0])}`)
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
      // @ts-ignore - creator pairs not needed in this function (processed by separate frontend call)
      creatorPairs = undefined
      console.log('✓ Memory released')

      // NOTE: process-creator-engagement is now called by the frontend after this completes
      // to avoid WORKER_LIMIT errors from running multiple Edge Functions concurrently

      // Clear staging table before starting (in case previous sync failed)
      console.log('Clearing staging table from any previous incomplete syncs...')
      const { error: clearError } = await supabase.rpc('clear_portfolio_engagement_staging')
      if (clearError) {
        console.warn('Warning: Failed to clear staging table:', clearError)
      } else {
        console.log('✓ Staging table cleared')
      }

      // Step 1: Insert all portfolio pairs into staging table (fast, no conflict checking)
      console.log(`Step 1/3: Staging ${portfolioCreatorPairs.length} portfolio-creator pairs...`)

      // Split into batches
      const batches = []
      for (let i = 0; i < portfolioCreatorPairs.length; i += STAGING_BATCH_SIZE) {
        batches.push({
          data: portfolioCreatorPairs.slice(i, i + STAGING_BATCH_SIZE),
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
                .from('portfolio_engagement_staging')
                .insert(batch)

              if (insertError) {
                console.error(`Error inserting staging batch ${index + 1}/${batches.length}:`, insertError.message)
                return { success: false, count: 0 }
              }

              // Log progress for every 5th batch
              if ((index + 1) % 5 === 0 || index === batches.length - 1) {
                const stagedSoFar = (index + 1) * STAGING_BATCH_SIZE
                console.log(`✓ Staged ~${Math.min(stagedSoFar, portfolioCreatorPairs.length)}/${portfolioCreatorPairs.length} records...`)
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

      // Release portfolio pairs from memory before processing
      // @ts-ignore
      portfolioCreatorPairs = undefined
      console.log('✓ Released portfolio pairs from memory')

      // Step 2: Process staged data using Postgres function (10-50x faster than JS)
      console.log('Step 2/3: Processing staged data in Postgres...')
      const processingStart = Date.now()

      const { data: processResult, error: processError } = await supabase.rpc(
        'process_portfolio_engagement_staging'
      )

      if (processError) {
        console.error('Error processing staged data in Postgres:', processError)
        throw processError
      }

      const portfolioCount = processResult[0]?.records_inserted || 0
      const recordsProcessed = processResult[0]?.records_processed || 0
      const processingElapsedSec = Math.round((Date.now() - processingStart) / 1000)

      logElapsed()
      console.log(`✓ Step 2 complete: ${portfolioCount} records upserted from ${recordsProcessed} staged records in ${processingElapsedSec}s`)

      // Step 3: Clear staging table
      console.log('Step 3/3: Clearing staging table...')
      const { error: finalClearError } = await supabase.rpc('clear_portfolio_engagement_staging')

      if (finalClearError) {
        console.warn('Warning: Failed to clear staging table:', finalClearError)
        // Don't fail the entire sync if cleanup fails
      } else {
        console.log('✓ Step 3 complete: Staging table cleared')
      }

      stats.totalRecordsInserted = portfolioCount
      const totalElapsedSec = Math.round((Date.now() - startTime) / 1000)
      console.log(`✅ Portfolio processing completed successfully in ${totalElapsedSec}s (Postgres-accelerated)`)

      // Note: process-creator-engagement should be called next by the frontend

      // Update sync log with success
      await updateSyncLogSuccess(supabase, syncLogId, {
        total_records_inserted: portfolioCount,
      })

      console.log('Portfolio processing completed successfully')

      return createSuccessResponse(
        'Portfolio engagement data processed and inserted successfully',
        stats
      )
    } catch (error) {
      // Update sync log with failure
      await updateSyncLogFailure(supabase, syncLogId, error)
      throw error
    }
  } catch (error) {
    return createErrorResponse(error, 'process-portfolio-engagement')
  }
})
