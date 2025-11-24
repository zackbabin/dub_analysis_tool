// Supabase Edge Function: process-event-sequences
// Aggregates raw events from event_sequences_raw into user_event_sequences
// Uses Postgres function for efficient set-based aggregation (10-50x faster than JavaScript)

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
    console.log('Starting event sequences processing...')

    const supabase = initializeSupabaseClient()

    // Create sync log entry
    const { syncLog, syncStartTime } = await createSyncLog(supabase, 'user', 'event_sequences_processing')
    const syncLogId = syncLog.id

    try {
      // Call Postgres function to aggregate events
      console.log('Calling process_event_sequences_raw() Postgres function...')

      const { data: processResult, error: processError } = await supabase
        .rpc('process_event_sequences_raw')

      if (processError) {
        console.error('❌ Postgres function error:', processError)
        throw processError
      }

      const { records_processed, records_inserted } = processResult

      console.log(`✅ Processing complete:`)
      console.log(`   - Raw events processed: ${records_processed}`)
      console.log(`   - User sequences upserted: ${records_inserted}`)

      // Update sync log with success
      await updateSyncLogSuccess(supabase, syncLogId, {
        total_records_inserted: records_inserted,
      })

      return createSuccessResponse('Event sequences processed successfully', {
        raw_events_processed: records_processed,
        user_sequences_upserted: records_inserted,
        note: 'Raw events aggregated into user_event_sequences using SQL',
        nextSteps: 'Call analyze-event-sequences to run Claude AI analysis'
      })
    } catch (error) {
      // Update sync log with failure
      await updateSyncLogFailure(supabase, syncLogId, error)
      throw error
    }
  } catch (error) {
    return createErrorResponse(error, 'process-event-sequences')
  }
})
