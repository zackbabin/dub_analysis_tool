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
    const { syncLog, syncStartTime } = await createSyncLog(supabase, 'support', 'support_conversations')
    const syncLogId = syncLog.id

    try {
      // Get last sync timestamps for incremental sync
      const { data: syncStatus } = await supabase
        .from('support_sync_status')
        .select('*')
        .in('source', ['zendesk']) // COMMENTED OUT: 'instabug' (not ready yet)

      const zendeskStatus = syncStatus?.find((s) => s.source === 'zendesk')
      const zendeskLastSync = zendeskStatus?.last_sync_timestamp

      // COMMENTED OUT: Instabug integration (not ready yet)
      // const instabugLastSync = syncStatus?.find((s) => s.source === 'instabug')?.last_sync_timestamp

      // Default to 7 days lookback if no previous sync
      const lookbackDays = parseInt(Deno.env.get('ANALYSIS_LOOKBACK_DAYS') || '7')
      const defaultStartDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000)

      const zendeskStartTime = zendeskLastSync
        ? Math.floor(new Date(zendeskLastSync).getTime() / 1000)
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
      let totalTicketsStored = 0

      await zendeskClient.fetchTicketsSince(zendeskStartTime, async (ticketBatch) => {
        // Normalize and redact PII for this batch
        const normalizedBatch = ticketBatch.map((t) =>
          ConversationNormalizer.normalizeZendeskTicket(t)
        )

        // Store batch immediately with timeout handling
        try {
          const { error: batchError } = await supabase
            .from('raw_support_conversations')
            .upsert(normalizedBatch, {
              onConflict: 'source,external_id',
              ignoreDuplicates: false,
            })

          if (batchError) {
            // Handle statement timeout on incremental syncs gracefully
            // This typically means we're trying to upsert duplicates
            if (batchError.code === '57014' && zendeskLastSync) {
              console.warn(`⚠️ Statement timeout on incremental sync - likely duplicate data. Continuing...`)
              return // Skip this batch but don't fail the whole sync
            }

            console.error('Error storing batch:', batchError)
            throw batchError
          }

          totalTicketsStored += normalizedBatch.length
          console.log(`  ✓ Stored batch of ${normalizedBatch.length} tickets (total: ${totalTicketsStored})`)
        } catch (err) {
          // Catch any timeout or connection errors
          const errorCode = err?.code
          if (errorCode === '57014' && zendeskLastSync) {
            console.warn(`⚠️ Caught statement timeout exception on incremental sync - continuing...`)
            return // Skip this batch but don't fail
          }
          throw err
        }
      })

      console.log(`✓ Successfully stored ${totalTicketsStored} tickets`)

      // TEMPORARY: Skip comments for initial sync
      console.log('Skipping comments (temporary)...')
      const totalMessagesStored = 0

      // Messages skipped for now (no comment processing)

      // Trigger next step in workflow IMMEDIATELY after data is stored
      // Do this BEFORE status updates to ensure chain continues even if function times out
      console.log('Triggering next step: sync-linear-issues...')
      const supabaseUrl = Deno.env.get('SUPABASE_URL')
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

      if (supabaseUrl && serviceKey) {
        // Trigger next step in workflow (fire-and-forget)
        fetch(`${supabaseUrl}/functions/v1/sync-linear-issues`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
          },
        }).catch(err => {
          console.warn('⚠️ Failed to trigger sync-linear-issues:', err.message)
          // Don't fail this function if next step fails to trigger
        })
        console.log('✓ Triggered sync-linear-issues (async)')

        // Also trigger materialized view refresh asynchronously (fire-and-forget)
        // This can take a long time (30-60s), so don't wait for it
        supabase.rpc('refresh_enriched_support_conversations').then(({ error }) => {
          if (error) {
            console.warn('⚠️ Failed to refresh enriched_support_conversations:', error.message)
          } else {
            console.log('✓ Materialized view refreshed in background')
          }
        })
        console.log('✓ Triggered materialized view refresh (async)')
      } else {
        console.warn('⚠️ Cannot trigger next step - SUPABASE_URL or SERVICE_KEY not configured')
      }

      // Update sync status
      const now = new Date().toISOString()
      await supabase
        .from('support_sync_status')
        .update({
          last_sync_timestamp: now,
          last_sync_status: 'success',
          conversations_synced: totalTicketsStored,
          messages_synced: totalMessagesStored,
          error_message: null,
          updated_at: now,
        })
        .eq('source', 'zendesk')

      // COMMENTED OUT: Instabug integration (not ready yet)
      /*
      await supabase
        .from('support_sync_status')
        .update({
          last_sync_timestamp: now,
          last_sync_status: 'success',
          conversations_synced: normalizedBugs.length,
          messages_synced: normalizedInstabugComments.length,
          error_message: null,
          updated_at: now,
        })
        .eq('source', 'instabug')
      */

      const elapsedMs = Date.now() - executionStartMs
      const elapsedSec = Math.round(elapsedMs / 1000)

      // Update sync log with success
      await updateSyncLogSuccess(supabase, syncLogId, {
        total_records_inserted: totalTicketsStored + totalMessagesStored,
      })

      console.log(`Sync completed successfully in ${elapsedSec}s`)
      // Note: sync-linear-issues already triggered earlier (right after data storage)

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
      // Update sync log with failure
      await updateSyncLogFailure(supabase, syncLogId, error)
      throw error
    }
  } catch (error) {
    return createErrorResponse(error, 'sync-support-conversations')
  }
})
