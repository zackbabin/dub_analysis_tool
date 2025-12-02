// Supabase Edge Function: sync-support-conversations
// Fetches support tickets from Zendesk and bug reports from Instabug
// Normalizes data, redacts PII, and stores in Supabase
// Maps users via distinct_id (Zendesk external_id / Instabug user_id)

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import {
  initializeSupabaseClient,
  handleCorsRequest,
  createSyncLog,
  updateSyncLogSuccess,
  updateSyncLogFailure,
  createSuccessResponse,
  createErrorResponse,
  TimeoutGuard,
} from '../_shared/sync-helpers.ts'
import { ZendeskClient, InstabugClient } from '../_shared/support-api-clients.ts'
import { ConversationNormalizer } from '../_shared/support-normalizers.ts'

/**
 * Initialize Support API credentials from environment variables
 */
function initializeSupportCredentials() {
  const zendeskSubdomain = Deno.env.get('ZENDESK_SUBDOMAIN')
  const zendeskEmail = Deno.env.get('ZENDESK_EMAIL')
  const zendeskToken = Deno.env.get('ZENDESK_TOKEN')
  // COMMENTED OUT: Instabug integration (not ready yet)
  // const instabugToken = Deno.env.get('INSTABUG_TOKEN')

  if (!zendeskSubdomain || !zendeskEmail || !zendeskToken) {
    throw new Error('Zendesk credentials not configured (ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, ZENDESK_TOKEN)')
  }

  // COMMENTED OUT: Instabug integration (not ready yet)
  /*
  if (!instabugToken) {
    throw new Error('Instabug credentials not configured (INSTABUG_TOKEN)')
  }
  */

  console.log('Support API credentials loaded from secrets')

  return {
    zendesk: { subdomain: zendeskSubdomain, email: zendeskEmail, token: zendeskToken },
    // instabug: { token: instabugToken },
  }
}

serve(async (req) => {
  // Handle CORS preflight requests
  const corsResponse = handleCorsRequest(req)
  if (corsResponse) return corsResponse

  try {
    console.log('Starting support conversations sync...')

    // Initialize clients
    const supabase = initializeSupabaseClient()
    const credentials = initializeSupportCredentials()

    // Create sync log entry
    const executionStartMs = Date.now()
    const timeoutGuard = new TimeoutGuard(executionStartMs)
    const { syncLog, syncStartTime } = await createSyncLog(supabase, 'support', 'support_conversations')
    const syncLogId = syncLog.id

    // Declare counters outside try block so they're accessible in catch block
    let totalTicketsStored = 0
    let totalMessagesStored = 0

    try {
      // Get last successful sync from sync_logs for incremental sync
      const { data: lastSyncLog } = await supabase
        .from('sync_logs')
        .select('sync_completed_at, created_at')
        .eq('source', 'support_conversations')
        .eq('sync_status', 'completed')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      // Default to 7 days lookback if no previous sync
      const lookbackDays = parseInt(Deno.env.get('ANALYSIS_LOOKBACK_DAYS') || '7')
      const defaultStartDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000)

      const zendeskStartTime = lastSyncLog?.sync_completed_at
        ? Math.floor(new Date(lastSyncLog.sync_completed_at).getTime() / 1000)
        : Math.floor(defaultStartDate.getTime() / 1000)

      // COMMENTED OUT: Instabug integration (not ready yet)
      /*
      const instabugStartTime = instabugLastSync
        ? new Date(instabugLastSync).toISOString()
        : defaultStartDate.toISOString()
      */

      console.log(`Syncing Zendesk from ${new Date(zendeskStartTime * 1000).toISOString()}`)
      // console.log(`Syncing Instabug from ${instabugStartTime}`)

      // Initialize API clients
      const zendeskClient = new ZendeskClient(
        credentials.zendesk.subdomain,
        credentials.zendesk.email,
        credentials.zendesk.token
      )

      // COMMENTED OUT: Instabug integration (not ready yet)
      // const instabugClient = new InstabugClient(credentials.instabug.token)

      // Fetch and store Zendesk tickets using streaming (stores each batch immediately)
      console.log('Fetching and storing Zendesk tickets (streaming mode)...')

      await zendeskClient.fetchTicketsSince(zendeskStartTime, async (ticketBatch) => {
        // Check timeout before processing batch
        if (timeoutGuard.isApproachingTimeout()) {
          console.warn('⏱️ Approaching 140s timeout during Zendesk fetch - stopping early')
          timeoutGuard.logStatus('During-Zendesk-Fetch')
          throw new Error('TIMEOUT_PREEMPTIVE: Stopped early to avoid 150s timeout')
        }

        // Normalize and redact PII for this batch
        const normalizedBatch = ticketBatch.map((t) =>
          ConversationNormalizer.normalizeZendeskTicket(t)
        )

        // Store batch immediately with timeout handling
        try {
          const { error: batchError } = await supabase
            .from('raw_support_conversations')
            .upsert(normalizedBatch, {
              onConflict: 'source,id',
              ignoreDuplicates: false,
            })

          if (batchError) {
            // Handle statement timeout gracefully for all syncs (full or incremental)
            // This typically means we're trying to upsert duplicates or the DB is busy
            const errorCode = batchError.code || batchError.error_code || batchError.message
            console.log(`Batch error details: code=${errorCode}, message=${batchError.message}`)

            if (errorCode === '57014' || errorCode?.includes('57014') || batchError.message?.includes('statement timeout')) {
              console.warn(`⚠️ Statement timeout detected - skipping batch and continuing...`)
              return // Skip this batch but don't fail the whole sync
            }

            console.error('Error storing batch:', batchError)
            throw batchError
          }

          totalTicketsStored += normalizedBatch.length
          console.log(`  ✓ Stored batch of ${normalizedBatch.length} tickets (total: ${totalTicketsStored})`)

          // Update sync log after each successful batch to ensure progress is tracked
          // even if function times out or rate limits later
          await updateSyncLogSuccess(supabase, syncLogId, {
            total_records_inserted: totalTicketsStored,
          })
        } catch (err) {
          // Catch any timeout or connection errors
          const errorCode = err?.code || err?.error_code || err?.message
          console.log(`Caught error in batch processing: code=${errorCode}, message=${err?.message}`)

          // Handle preemptive timeout (our 140s check)
          if (err?.message?.includes('TIMEOUT_PREEMPTIVE')) {
            console.warn(`⏱️ Preemptive timeout triggered - stopping batch processing`)
            throw err // Propagate to outer catch for graceful handling
          }

          if (errorCode === '57014' || errorCode?.includes('57014') || err?.message?.includes('statement timeout')) {
            console.warn(`⚠️ Caught statement timeout exception - continuing with next batch...`)
            return // Skip this batch but don't fail
          }
          throw err
        }
      })

      console.log(`✓ Successfully stored ${totalTicketsStored} tickets`)

      // NOTE: Comments are synced separately via sync-support-messages function
      totalMessagesStored = 0

      // Update sync log with success IMMEDIATELY after storing data
      // This ensures the log is marked as completed even if function times out after this point
      await updateSyncLogSuccess(supabase, syncLogId, {
        total_records_inserted: totalTicketsStored + totalMessagesStored,
      })
      console.log(`✅ Sync log ${syncLogId} marked as completed`)

      // NOTE: Workflow chain trigger has been moved to frontend (supabase_integration.js)
      // Frontend will trigger sync-linear-issues after this function completes OR times out
      // This ensures the workflow runs on the complete dataset, not just first batch
      console.log('Sync-support-conversations complete - frontend will trigger workflow chain')

      const elapsedMs = Date.now() - executionStartMs
      const elapsedSec = Math.round(elapsedMs / 1000)

      console.log(`Sync completed successfully in ${elapsedSec}s`)
      // Note: Workflow chain will be triggered by frontend after this returns

      return createSuccessResponse('Support conversations synced successfully', {
        totalTimeSeconds: elapsedSec,
        zendesk: {
          tickets: totalTicketsStored,
          comments: totalMessagesStored,
        },
        instabug: {
          bugs: 0,
          comments: 0,
        },
        total_conversations: totalTicketsStored,
        total_messages: totalMessagesStored,
        pii_redacted: true,
        streaming_mode: true,
      })
    } catch (error) {
      // Handle preemptive timeout gracefully (partial success)
      if (error?.message?.includes('TIMEOUT_PREEMPTIVE')) {
        console.warn('⏱️ Function stopped due to approaching timeout - returning partial results')

        await updateSyncLogSuccess(supabase, syncLogId, {
          total_records_inserted: totalTicketsStored + (totalMessagesStored || 0),
        })

        return createSuccessResponse(
          'Support sync completed with partial results (timeout prevented)',
          {
            timeout_triggered: true,
            elapsed_seconds: timeoutGuard.getElapsedSeconds(),
            conversationsSynced: {
              tickets: totalTicketsStored,
              bugs: 0,
              comments: totalMessagesStored || 0,
            },
            total_conversations: totalTicketsStored,
            total_messages: totalMessagesStored || 0,
            pii_redacted: true,
            streaming_mode: true,
            partial_sync: true,
          }
        )
      }

      // Update sync log with failure
      await updateSyncLogFailure(supabase, syncLogId, error)
      throw error
    }
  } catch (error) {
    return createErrorResponse(error, 'sync-support-conversations')
  }
})
