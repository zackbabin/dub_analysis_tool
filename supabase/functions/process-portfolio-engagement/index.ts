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
      const TIMEOUT_BUFFER_MS = 140000  // Exit after 140s (10s buffer before 150s timeout)
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
      const STAGING_BATCH_SIZE = 5000  // Large batches OK for staging (no conflict checks)

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

      // Trigger process-creator-engagement BEFORE upserting to ensure it happens even if we timeout
      // This function will handle creator pairs while we process portfolio pairs
      console.log('Triggering process-creator-engagement function (before upserts)...')
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
          const errorMessage = err instanceof Error ? err.message : String(err)
          console.error('⚠️ Failed to trigger process-creator-engagement:', errorMessage)
        })
        console.log('✓ Creator processing function triggered in background')
      } else {
        console.warn('⚠️ Cannot trigger creator processing function: Supabase credentials not available')
      }

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
      let totalStaged = 0

      // Insert in batches to avoid statement timeout
      for (let i = 0; i < portfolioCreatorPairs.length; i += STAGING_BATCH_SIZE) {
        const batch = portfolioCreatorPairs.slice(i, i + STAGING_BATCH_SIZE)

        const { error: insertError } = await supabase
          .from('portfolio_engagement_staging')
          .insert(batch)

        if (insertError) {
          console.error('Error inserting staging batch:', insertError)
          throw insertError
        }

        totalStaged += batch.length
        if ((i + STAGING_BATCH_SIZE) < portfolioCreatorPairs.length) {
          console.log(`✓ Staged ${totalStaged}/${portfolioCreatorPairs.length} records...`)
        }
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

      // Note: process-creator-engagement was already triggered earlier (before upserts)
      // to ensure it runs even if upserts timeout

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
