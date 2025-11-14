// Supabase Edge Function: sync-mixpanel-engagement
// Part 1 of 4: Fetches raw data from Mixpanel and stores in Storage bucket
// Triggers process-portfolio-engagement → process-creator-engagement → refresh-materialized-views
// This separation prevents timeout by splitting work across multiple functions with separate CPU quotas

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import {
  MIXPANEL_CONFIG,
  type MixpanelCredentials,
  pLimit,
  fetchInsightsData,
} from '../_shared/mixpanel-api.ts'
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

serve(async (req) => {
  // Handle CORS preflight requests
  const corsResponse = handleCorsRequest(req)
  if (corsResponse) return corsResponse

  try {
    // Initialize Mixpanel credentials and Supabase client
    const credentials = initializeMixpanelCredentials()
    const supabase = initializeSupabaseClient()

    console.log('Starting Mixpanel engagement data fetch...')

    // Check if sync should be skipped (within 1-hour window)
    const skipResponse = await checkAndHandleSkipSync(supabase, 'mixpanel_engagement', 1)
    if (skipResponse) return skipResponse

    // Create sync log entry
    const { syncLog, syncStartTime } = await createSyncLog(supabase, 'user', 'mixpanel_engagement')
    const syncLogId = syncLog.id

    try {
      // Track elapsed time
      const startTime = Date.now()
      const logElapsed = () => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
        console.log(`⏱️  Elapsed: ${elapsed}s / 150s`)
        return elapsed
      }

      // Fetch engagement data with controlled concurrency to respect Mixpanel rate limits
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
        logElapsed()
        console.log('✓ Engagement data fetched successfully from Mixpanel')
      } catch (error: any) {
        // Handle Mixpanel rate limit errors gracefully
        const rateLimitResponse = await handleRateLimitError(supabase, syncLogId, error, {
          engagementRecordsFetched: 0,
          totalRecordsInserted: 0,
        })
        if (rateLimitResponse) return rateLimitResponse
        throw error
      }

      // Store raw data in Storage bucket for processing function
      console.log('Storing raw data in Storage bucket...')
      const filename = `engagement-${syncStartTime.toISOString()}.json`
      const rawData = {
        profileViewsData,
        pdpViewsData,
        subscriptionsData,
        syncStartTime: syncStartTime.toISOString(),
        fetchedAt: new Date().toISOString()
      }

      const { error: uploadError } = await supabase.storage
        .from('mixpanel-raw-data')
        .upload(filename, JSON.stringify(rawData), {
          contentType: 'application/json',
          upsert: false
        })

      if (uploadError) {
        console.error('Error uploading to storage:', uploadError)
        throw uploadError
      }

      logElapsed()
      console.log(`✓ Raw data stored: ${filename}`)

      // Update sync log with fetch success
      await updateSyncLogSuccess(supabase, syncLogId, {
        total_records_inserted: 0,  // No records inserted yet - happens in processing function
      })

      // Trigger portfolio processing function (which will chain to creator processing)
      console.log('Triggering process-portfolio-engagement function...')

      const supabaseUrl = Deno.env.get('SUPABASE_URL')
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

      if (supabaseUrl && supabaseServiceKey) {
        // Fire and forget - don't wait for completion
        fetch(`${supabaseUrl}/functions/v1/process-portfolio-engagement`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'apikey': supabaseServiceKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ filename })
        }).catch((err) => {
          console.error('⚠️ Failed to trigger process-portfolio-engagement:', err.message)
        })
        console.log('✓ Portfolio processing function triggered in background')
      } else {
        console.warn('⚠️ Cannot trigger processing function: Supabase credentials not available')
      }

      console.log('Fetch completed successfully')

      return createSuccessResponse(
        'Mixpanel engagement data fetched and stored successfully',
        {
          filename,
          fetchTimeSeconds: parseFloat(logElapsed())
        }
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
