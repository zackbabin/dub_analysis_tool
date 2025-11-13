// Supabase Edge Function: sync-mixpanel-users-v2 (Event Export API)
// Part 1 of 2: Fetches raw events from Mixpanel Export API and stores in Storage bucket
// Triggers process-subscribers-data-v2 → event processing and batch upsert
// Parallel implementation to test Export API vs Insights API

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { fetchEventsExport } from '../_shared/mixpanel-api.ts'
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

// 12 events that we can track from Export API
const TRACKED_EVENTS = [
  'Viewed Portfolio Details',
  'Viewed Creator Profile',
  'BankAccountLinked',
  'AchTransferInitiated',
  'DubAutoCopyInitiated',
  'Viewed Creator Paywall',
  'SubscriptionCreated',
  '$ae_session',
  'Viewed Discover Tab',
  'Viewed Stripe Modal',
  'Tapped Creator Card',
  'Tapped Portfolio Card',
]

serve(async (req) => {
  // Handle CORS preflight requests
  const corsResponse = handleCorsRequest(req)
  if (corsResponse) return corsResponse

  try {
    // Initialize Mixpanel credentials and Supabase client
    const credentials = initializeMixpanelCredentials()
    const supabase = initializeSupabaseClient()

    console.log('Starting Mixpanel user sync v2 (Event Export API)...')

    // Check if sync should be skipped (within 1-hour window)
    const skipResponse = await checkAndHandleSkipSync(supabase, 'mixpanel_users_v2', 1)
    if (skipResponse) return skipResponse

    // Create sync log entry and track execution time
    const executionStartMs = Date.now()
    const { syncLog, syncStartTime } = await createSyncLog(supabase, 'user', 'mixpanel_users_v2')
    const syncLogId = syncLog.id

    try {
      // Calculate date range: just yesterday (1 day for initial testing)
      // TODO: Expand to full date range once we confirm this works
      // Mixpanel Export API uses UTC and rejects dates in the future
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      const toDate = yesterday.toISOString().split('T')[0] // YYYY-MM-DD
      const fromDate = toDate // Same date = 1 day only for testing

      console.log(`Date range: ${fromDate} to ${toDate}`)
      console.log(`Tracking ${TRACKED_EVENTS.length} event types:`)
      console.log(`  ${TRACKED_EVENTS.join(', ')}`)

      // Fetch events from Export API (should be much faster than Insights API)
      console.log('Fetching events from Export API...')
      const fetchStartMs = Date.now()

      const events = await fetchEventsExport(
        credentials,
        fromDate,
        toDate,
        TRACKED_EVENTS
      )

      const fetchElapsedMs = Date.now() - fetchStartMs
      const fetchElapsedSec = Math.round(fetchElapsedMs / 1000)
      console.log(`✓ Fetched ${events.length} events in ${fetchElapsedSec}s`)

      // Store raw events in Storage bucket for processing function
      console.log('Storing raw events in Storage bucket...')
      const filename = `subscribers-v2-${syncStartTime.toISOString()}.json`
      const dataToStore = {
        events,
        syncStartTime: syncStartTime.toISOString(),
        fetchedAt: new Date().toISOString(),
        stats: {
          totalEvents: events.length,
          dateRange: { fromDate, toDate },
          fetchTimeSeconds: fetchElapsedSec,
        },
      }

      const { error: uploadError } = await supabase.storage
        .from('mixpanel-raw-data')
        .upload(filename, JSON.stringify(dataToStore), {
          contentType: 'application/json',
          upsert: false,
        })

      if (uploadError) {
        console.error('Error uploading to storage:', uploadError)
        throw uploadError
      }

      const elapsedMs = Date.now() - executionStartMs
      console.log(`✓ Raw events stored: ${filename} (${Math.round(elapsedMs / 1000)}s total)`)

      // Update sync log with fetch success
      await updateSyncLogSuccess(supabase, syncLogId, {
        total_records_inserted: 0, // Records inserted in processing function
      })

      // Trigger processing function (which will process events and upsert to subscribers_insights_v2)
      console.log('Triggering process-subscribers-data-v2 function...')

      const supabaseUrl = Deno.env.get('SUPABASE_URL')
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

      if (supabaseUrl && supabaseServiceKey) {
        // Fire and forget - don't wait for completion
        fetch(`${supabaseUrl}/functions/v1/process-subscribers-data-v2`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${supabaseServiceKey}`,
            apikey: supabaseServiceKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ filename }),
        }).catch((err) => {
          console.error('⚠️ Failed to trigger process-subscribers-data-v2:', err.message)
        })
        console.log('✓ Processing function triggered in background')
      } else {
        console.warn('⚠️ Cannot trigger processing function: Supabase credentials not available')
      }

      console.log('Fetch completed successfully')

      return createSuccessResponse('Subscriber events fetched and stored successfully (v2)', {
        filename,
        totalTimeSeconds: Math.round(elapsedMs / 1000),
        fetchTimeSeconds: fetchElapsedSec,
        totalEvents: events.length,
        dateRange: { fromDate, toDate },
        trackedEvents: TRACKED_EVENTS.length,
      })
    } catch (error) {
      // Update sync log with failure
      await updateSyncLogFailure(supabase, syncLogId, error)
      throw error
    }
  } catch (error) {
    return createErrorResponse(error, 'sync-mixpanel-users-v2')
  }
})
