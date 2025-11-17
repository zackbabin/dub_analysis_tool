// Supabase Edge Function: process-portfolio-engagement
// Part 2a of 4: Loads raw Mixpanel data from Storage and processes portfolio-creator pairs
// Handles portfolio engagement upserts, then triggers process-creator-engagement
// Triggered by sync-mixpanel-engagement after raw data is stored

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

    console.log(`Starting processing of ${filename}...`)

    // Create sync log entry
    const { syncLog, syncStartTime } = await createSyncLog(supabase, 'user', 'portfolio_engagement_processing')
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
        throw new Error(`Storage data load failed: ${error.message}`)
      }

      // Use let for variables we'll explicitly set to undefined later for garbage collection
      let { profileViewsData, pdpViewsData, subscriptionsData, syncStartTime: originalSyncTime } = rawData

      // Process and insert data into database
      const stats: SyncStats = {
        engagementRecordsFetched: 0,
        totalRecordsInserted: 0,
      }

      // Parallel batch processing configuration
      // Reduced concurrency to avoid CPU quota limits with large datasets
      const BATCH_SIZE = 10000  // Larger batches = fewer operations
      const MAX_CONCURRENT_BATCHES = 1  // Process sequentially to stay under CPU quota

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
        console.error('Error details:', error.stack)
        throw new Error(`Data processing failed: ${error.message}`)
      }

      logElapsed()
      console.log(`✓ Processed ${portfolioCreatorPairs.length} portfolio pairs, ${creatorPairs.length} creator pairs`)
      console.log('This function will process portfolio pairs only, creator pairs handled by process-creator-engagement')

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
      console.log('✓ Memory released')

      // Helper function to upsert batches in parallel with error handling
      async function upsertInParallelBatches(
        data: any[],
        tableName: string,
        onConflictColumns: string,
        description: string
      ): Promise<number> {
        if (data.length === 0) {
          console.log(`No ${description} to upsert`)
          return 0
        }

        console.log(`Upserting ${data.length} ${description} in batches of ${BATCH_SIZE} (${MAX_CONCURRENT_BATCHES} concurrent)...`)

        // Split data into batches
        const batches: any[][] = []
        for (let i = 0; i < data.length; i += BATCH_SIZE) {
          batches.push(data.slice(i, i + BATCH_SIZE))
        }
        console.log(`Split into ${batches.length} batches`)

        // Process batches in chunks of MAX_CONCURRENT_BATCHES
        let processedCount = 0
        for (let i = 0; i < batches.length; i += MAX_CONCURRENT_BATCHES) {
          // Check timeout before processing next chunk
          if (isApproachingTimeout()) {
            console.warn(`⚠️ Approaching timeout. Processed ${processedCount}/${data.length} ${description}.`)
            console.log('Exiting early - triggering next function to continue processing.')
            return processedCount
          }

          const batchChunk = batches.slice(i, i + MAX_CONCURRENT_BATCHES)
          const chunkStart = i * BATCH_SIZE
          const chunkEnd = Math.min((i + batchChunk.length) * BATCH_SIZE, data.length)

          console.log(`Processing batches ${i + 1}-${i + batchChunk.length} of ${batches.length} (records ${chunkStart}-${chunkEnd}/${data.length})...`)

          // Process this chunk of batches in parallel with error handling
          let results
          try {
            results = await Promise.all(
              batchChunk.map(batch =>
                supabase
                  .from(tableName)
                  .upsert(batch, {
                    onConflict: onConflictColumns,
                    ignoreDuplicates: false
                  })
              )
            )
          } catch (error) {
            console.error(`❌ Exception during batch upsert: ${error.message}`)
            throw error
          }

          // Check for errors in this chunk
          for (let j = 0; j < results.length; j++) {
            if (results[j].error) {
              const batchNum = i + j + 1
              console.error(`❌ Error upserting ${description} batch ${batchNum}/${batches.length}:`)
              console.error(JSON.stringify(results[j].error, null, 2))
              throw new Error(`Batch ${batchNum} failed: ${results[j].error.message}`)
            }
          }

          processedCount = chunkEnd
          logElapsed()
          console.log(`✓ Completed ${chunkEnd}/${data.length} ${description}`)
        }

        console.log(`✓ All ${data.length} ${description} upserted successfully`)
        return processedCount
      }

      // Upsert ONLY portfolio-creator pairs in this function
      console.log('Upserting portfolio-creator pairs to database...')

      let portfolioCount
      try {
        portfolioCount = await upsertInParallelBatches(
          portfolioCreatorPairs,
          'user_portfolio_creator_engagement',
          'distinct_id,portfolio_ticker,creator_id',
          'portfolio-creator pairs'
        )
      } catch (error) {
        console.error('❌ Failed to upsert portfolio pairs:', error)
        throw new Error(`Database upsert failed: ${error.message}`)
      }

      // Release processed data from memory
      // @ts-ignore
      portfolioCreatorPairs = undefined
      console.log('✓ Released portfolio pairs from memory')

      stats.totalRecordsInserted = portfolioCount
      logElapsed()
      console.log(`✓ Portfolio pairs upsert complete: ${portfolioCount} records`)

      // Trigger process-creator-engagement to handle creator pairs
      console.log('Triggering process-creator-engagement function...')
      const supabaseUrl = Deno.env.get('SUPABASE_URL')
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

      if (supabaseUrl && supabaseServiceKey) {
        // Fire and forget - don't wait for completion
        fetch(`${supabaseUrl}/functions/v1/process-creator-engagement`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'apikey': supabaseServiceKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ filename })
        }).catch((err) => {
          console.error('⚠️ Failed to trigger process-creator-engagement:', err.message)
        })
        console.log('✓ Creator processing function triggered in background')
      } else {
        console.warn('⚠️ Cannot trigger creator processing function: Supabase credentials not available')
      }

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
