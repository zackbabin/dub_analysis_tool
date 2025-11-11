// Supabase Edge Function: sync-mixpanel-engagement
// Fetches engagement data (views, subscriptions, copies) from Mixpanel
// Part 3 of 4: Handles user_portfolio_creator_views, user_portfolio_creator_copies
// Triggers pattern analysis and refreshes materialized views
// Triggered manually by user clicking "Sync Live Data" button after sync-mixpanel-funnels completes

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import {
  MIXPANEL_CONFIG,
  type MixpanelCredentials,
  pLimit,
  fetchInsightsData,
} from '../_shared/mixpanel-api.ts'
import { processPortfolioCreatorPairs } from '../_shared/data-processing.ts'
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

const CHART_IDS = {
  // User engagement analysis for subscriptions/copies
  profileViewsByCreator: '85165851',  // Total Profile Views
  pdpViewsByPortfolio: '85165580',     // Total PDP Views, Total Copies, Total Liquidations by creatorId, portfolioTicker, distinctId
  subscriptionsByCreator: '85165590',  // Total Subscriptions
}

interface SyncStats {
  engagementRecordsFetched: number
  totalRecordsInserted: number
}

serve(async (req) => {
  // Handle CORS preflight requests
  const corsResponse = handleCorsRequest(req)
  if (corsResponse) return corsResponse

  try {
    // Initialize Mixpanel credentials and Supabase client
    const credentials = initializeMixpanelCredentials()
    const supabase = initializeSupabaseClient()

    console.log('Starting Mixpanel sync...')

    // Check if sync should be skipped (within 1-hour window)
    const skipResponse = await checkAndHandleSkipSync(supabase, 'mixpanel_engagement', 1)
    if (skipResponse) return skipResponse

    // Create sync log entry
    const { syncLog, syncStartTime } = await createSyncLog(supabase, 'user', 'mixpanel_engagement')
    const syncLogId = syncLog.id

    try {
      // Date range configured in Mixpanel chart settings
      console.log(`Fetching data from Mixpanel charts (date range configured in charts)`)

      // Fetch engagement data with controlled concurrency to respect Mixpanel rate limits
      // Max 5 concurrent queries allowed by Mixpanel - we use 3 for safety
      console.log('Fetching engagement charts with max 3 concurrent requests...')
      const CONCURRENCY_LIMIT = 3
      const limit = pLimit(CONCURRENCY_LIMIT)

      let profileViewsData, pdpViewsData, subscriptionsData

      try {
        [profileViewsData, pdpViewsData, subscriptionsData] = await Promise.all([
          limit(() =>
            fetchInsightsData(
              credentials,
              CHART_IDS.profileViewsByCreator,
              'Profile Views by Creator'
            )
          ),
          limit(() =>
            fetchInsightsData(credentials, CHART_IDS.pdpViewsByPortfolio, 'PDP Views by Portfolio (with Copies & Liquidations)')
          ),
          limit(() =>
            fetchInsightsData(
              credentials,
              CHART_IDS.subscriptionsByCreator,
              'Subscriptions by Creator'
            )
          ),
        ])
        console.log('✓ Engagement data fetched successfully with controlled concurrency')
      } catch (error: any) {
        // Handle Mixpanel rate limit errors gracefully
        const rateLimitResponse = await handleRateLimitError(supabase, syncLogId, error, {
          engagementRecordsFetched: 0,
          totalRecordsInserted: 0,
        })
        if (rateLimitResponse) return rateLimitResponse
        throw error
      }

      // Process and insert data into database
      const stats: SyncStats = {
        engagementRecordsFetched: 0,
        totalRecordsInserted: 0,
      }

      // Parallel batch processing configuration
      // Larger batches + concurrent processing to prevent timeout
      const BATCH_SIZE = 1000  // Increased from 500
      const MAX_CONCURRENT_BATCHES = 5  // Process 5 batches in parallel

      // Process and store engagement data (two tables: portfolio-creator and creator-level)
      console.log('Processing engagement pairs...')
      const { portfolioCreatorPairs, creatorPairs } = processPortfolioCreatorPairs(
        profileViewsData,
        pdpViewsData,
        subscriptionsData,
        syncStartTime.toISOString()
      )

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
        for (let i = 0; i < batches.length; i += MAX_CONCURRENT_BATCHES) {
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

          console.log(`✓ Completed ${chunkEnd}/${data.length} ${description}`)
        }

        console.log(`✓ All ${data.length} ${description} upserted successfully`)
        return data.length
      }

      // Upsert portfolio-creator engagement pairs (parallel batches)
      const portfolioCount = await upsertInParallelBatches(
        portfolioCreatorPairs,
        'user_portfolio_creator_engagement',
        'distinct_id,portfolio_ticker,creator_id',
        'portfolio-creator pairs'
      )
      stats.engagementRecordsFetched += portfolioCount
      stats.totalRecordsInserted += portfolioCount

      // Upsert creator-level engagement pairs (parallel batches)
      const creatorCount = await upsertInParallelBatches(
        creatorPairs,
        'user_creator_engagement',
        'distinct_id,creator_id',
        'creator-level pairs'
      )
      stats.engagementRecordsFetched += creatorCount
      stats.totalRecordsInserted += creatorCount

      // Trigger refresh-engagement-views function to handle aggregation work
      // This prevents timeout by splitting the work into two functions
      console.log('Triggering refresh-engagement-views function for aggregation...')

      const supabaseUrl = Deno.env.get('SUPABASE_URL')
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

      if (supabaseUrl && supabaseServiceKey) {
        // Fire and forget - don't wait for completion
        fetch(`${supabaseUrl}/functions/v1/refresh-engagement-views`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'apikey': supabaseServiceKey,
            'Content-Type': 'application/json',
          },
        }).catch((err) => {
          console.error('⚠️ Failed to trigger refresh-engagement-views:', err.message)
        })
        console.log('✓ Refresh function triggered in background')
      } else {
        console.warn('⚠️ Cannot trigger refresh function: Supabase credentials not available')
      }

      // Update sync log with success
      await updateSyncLogSuccess(supabase, syncLogId, {
        total_records_inserted: stats.totalRecordsInserted,
      })

      console.log('Engagement sync completed successfully')
      console.log('Note: Materialized views and pattern analysis will be refreshed by refresh-engagement-views function')

      return createSuccessResponse(
        'Mixpanel engagement sync completed successfully',
        stats
      )
    } catch (error) {
      // Update sync log with failure
      await updateSyncLogFailure(supabase, syncLogId, error)
      throw error
    }
  } catch (error) {
    return createErrorResponse(error, 'sync-mixpanel-engagement')
  }
})
