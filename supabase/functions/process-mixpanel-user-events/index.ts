// Supabase Edge Function: process-mixpanel-user-events
// Part 2 of 2: Processes raw events from staging table using Postgres function
// Called automatically after sync-mixpanel-user-events if staging times out
// Can also be called manually to reprocess staging table data

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import {
  initializeSupabaseClient,
  handleCorsRequest,
  createSyncLog,
  updateSyncLogSuccess,
  updateSyncLogFailure,
  createSuccessResponse,
  createErrorResponse,
} from '../_shared/sync-helpers.ts'

serve(async (req) => {
  // Handle CORS preflight requests
  const corsResponse = handleCorsRequest(req)
  if (corsResponse) return corsResponse

  try {
    const supabase = initializeSupabaseClient()

    console.log('Starting event processing from staging table...')

    // Get synced_at timestamp from request body (optional)
    const body = await req.json().catch(() => ({}))
    const syncedAt = body.synced_at || new Date().toISOString()

    // Create sync log entry
    const { syncLog, syncStartTime } = await createSyncLog(supabase, 'user', 'mixpanel_users_processing')
    const syncLogId = syncLog.id

    try {
      const startTime = Date.now()

      // Step 1: Process staged events using Postgres function (10-50x faster than JS)
      console.log('Step 1/2: Processing events in Postgres...')

      const { data: processResult, error: processError } = await supabase.rpc(
        'process_raw_events_to_profiles',
        { synced_at: syncedAt }
      )

      if (processError) {
        console.error('Error processing events in Postgres:', processError)
        throw processError
      }

      const profilesProcessed = processResult[0]?.profiles_processed || 0
      const eventsProcessed = processResult[0]?.events_processed || 0
      const processingElapsedSec = Math.round((Date.now() - startTime) / 1000)

      console.log(`✓ Step 1 complete: ${profilesProcessed} profiles from ${eventsProcessed} events in ${processingElapsedSec}s`)

      // Step 2: Refresh dependent materialized views
      console.log('Step 2/4: Refreshing main_analysis view...')
      const mainAnalysisStart = Date.now()
      const { error: mainAnalysisError } = await supabase.rpc('refresh_main_analysis')

      if (mainAnalysisError) {
        console.error('Error refreshing main_analysis:', mainAnalysisError)
        throw mainAnalysisError
      }

      const mainAnalysisElapsedSec = Math.round((Date.now() - mainAnalysisStart) / 1000)
      console.log(`✓ Step 2 complete: main_analysis refreshed in ${mainAnalysisElapsedSec}s`)

      // Step 3: Refresh copy_engagement_summary
      console.log('Step 3/4: Refreshing copy_engagement_summary view...')
      const copyEngagementStart = Date.now()
      const { error: copyEngagementError } = await supabase.rpc('refresh_copy_engagement_summary')

      if (copyEngagementError) {
        console.error('Error refreshing copy_engagement_summary:', copyEngagementError)
        throw copyEngagementError
      }

      const copyEngagementElapsedSec = Math.round((Date.now() - copyEngagementStart) / 1000)
      console.log(`✓ Step 3 complete: copy_engagement_summary refreshed in ${copyEngagementElapsedSec}s`)

      // Step 4: Clear staging table
      console.log('Step 4/4: Clearing staging table...')
      const { error: clearError } = await supabase.rpc('clear_events_staging')

      if (clearError) {
        console.warn('Warning: Failed to clear staging table:', clearError)
        // Don't fail the entire sync if cleanup fails
      } else {
        console.log('✓ Step 4 complete: Staging table cleared')
      }

      const totalElapsedSec = Math.round((Date.now() - startTime) / 1000)

      // Update sync log with success
      await updateSyncLogSuccess(supabase, syncLogId, {
        total_records_inserted: profilesProcessed,
      })

      console.log(`✅ Processing completed successfully in ${totalElapsedSec}s (${processingElapsedSec}s processing + ${mainAnalysisElapsedSec}s main_analysis + ${copyEngagementElapsedSec}s copy_engagement)`)

      return createSuccessResponse('Events processed successfully from staging', {
        totalTimeSeconds: totalElapsedSec,
        profilesProcessed,
        eventsProcessed,
      })
    } catch (error) {
      // Update sync log with failure
      await updateSyncLogFailure(supabase, syncLogId, error)
      throw error
    }
  } catch (error) {
    return createErrorResponse(error, 'process-mixpanel-user-events')
  }
})
