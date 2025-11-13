// Supabase Edge Function: sync-mixpanel-users
// Part 1 of 2: Fetches raw subscriber data from Mixpanel and stores in Storage bucket
// Triggers process-subscribers-data → batch processing and upsert
// This separation prevents timeout by splitting work across multiple functions with separate CPU quotas

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { fetchInsightsData, type MixpanelCredentials } from '../_shared/mixpanel-api.ts'
import {
  initializeMixpanelCredentials,
  initializeSupabaseClient,
  handleCorsRequest,
  checkAndHandleSkipSync,
  createSyncLog,
  updateSyncLogSuccess,
  updateSyncLogFailure,
  createSuccessResponse,
  createErrorResponse,
} from '../_shared/sync-helpers.ts'

const CHART_IDS = {
  subscribersInsights: '85713544',
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
    const skipResponse = await checkAndHandleSkipSync(supabase, 'mixpanel_users', 1)
    if (skipResponse) return skipResponse

    // Create sync log entry and track execution time
    const executionStartMs = Date.now()
    const { syncLog, syncStartTime } = await createSyncLog(supabase, 'user', 'mixpanel_users')
    const syncLogId = syncLog.id

    try{
      // Date range configured in Mixpanel chart settings
      console.log(`Fetching data from Mixpanel chart (date range configured in chart)`)

      // Fetch subscribers data only with 140s timeout
      console.log('Fetching Subscribers Insights data (140s timeout)...')

      // Wrap fetch in timeout to prevent function from hanging
      // Edge function has 150s total limit - use 140s for fetch, 10s for storage upload
      const FETCH_TIMEOUT_MS = 140000 // 140s timeout for Mixpanel fetch
      const fetchPromise = fetchInsightsData(
        credentials,
        CHART_IDS.subscribersInsights,
        'Subscribers Insights'
      )

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Mixpanel fetch timeout after 140s')), FETCH_TIMEOUT_MS)
      })

      let subscribersData
      try {
        subscribersData = await Promise.race([fetchPromise, timeoutPromise])
        console.log('✓ Subscribers data fetched successfully')
      } catch (error: any) {
        if (error.message?.includes('timeout')) {
          console.warn('⚠️ Mixpanel fetch timed out after 140s - skipping user sync for this run')
          console.warn('Note: Other syncs (engagement, creator data) will continue normally')

          // Update sync log with warning
          await updateSyncLogSuccess(supabase, syncLogId, {
            total_records_inserted: 0,
          })

          return createSuccessResponse(
            'Sync partially completed (user data fetch timed out, other syncs will continue)',
            {
              warning: 'Mixpanel user data fetch timed out',
              timeout_seconds: FETCH_TIMEOUT_MS / 1000,
            }
          )
        }
        throw error // Re-throw non-timeout errors
      }

      // Store raw data in Storage bucket for processing function
      console.log('Storing raw data in Storage bucket...')
      const filename = `subscribers-${syncStartTime.toISOString()}.json`
      const rawData = {
        subscribersData,
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

      const elapsedMs = Date.now() - executionStartMs
      console.log(`✓ Raw data stored: ${filename} (${Math.round(elapsedMs / 1000)}s elapsed)`)

      // Update sync log with fetch success
      await updateSyncLogSuccess(supabase, syncLogId, {
        total_records_inserted: 0,  // No records inserted yet - happens in processing function
      })

      // Trigger processing function (which will chain to batch upsert)
      console.log('Triggering process-subscribers-data function...')

      const supabaseUrl = Deno.env.get('SUPABASE_URL')
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

      if (supabaseUrl && supabaseServiceKey) {
        // Fire and forget - don't wait for completion
        fetch(`${supabaseUrl}/functions/v1/process-subscribers-data`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'apikey': supabaseServiceKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ filename })
        }).catch((err) => {
          console.error('⚠️ Failed to trigger process-subscribers-data:', err.message)
        })
        console.log('✓ Subscriber processing function triggered in background')
      } else {
        console.warn('⚠️ Cannot trigger processing function: Supabase credentials not available')
      }

      console.log('Fetch completed successfully')

      return createSuccessResponse(
        'Subscriber data fetched and stored successfully',
        {
          filename,
          fetchTimeSeconds: Math.round(elapsedMs / 1000)
        }
      )
    } catch (error) {
      // Update sync log with failure
      await updateSyncLogFailure(supabase, syncLogId, error)
      throw error
    }
  } catch (error) {
    return createErrorResponse(error, 'sync-mixpanel-users')
  }
})
