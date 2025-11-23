// Supabase Edge Function: sync-support-messages
// Fetches comments/messages from Zendesk tickets and stores in support_conversation_messages
// Runs after sync-support-conversations to get the full back-and-forth conversation threads

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
import { ZendeskClient } from '../_shared/support-api-clients.ts'
import { ConversationNormalizer } from '../_shared/support-normalizers.ts'

/**
 * Initialize Zendesk API credentials from environment variables
 */
function initializeZendeskCredentials() {
  const zendeskSubdomain = Deno.env.get('ZENDESK_SUBDOMAIN')
  const zendeskEmail = Deno.env.get('ZENDESK_EMAIL')
  const zendeskToken = Deno.env.get('ZENDESK_TOKEN')

  if (!zendeskSubdomain || !zendeskEmail || !zendeskToken) {
    throw new Error('Zendesk credentials not configured (ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, ZENDESK_TOKEN)')
  }

  console.log('Zendesk credentials loaded from secrets')

  return { subdomain: zendeskSubdomain, email: zendeskEmail, token: zendeskToken }
}

serve(async (req) => {
  // Handle CORS preflight requests
  const corsResponse = handleCorsRequest(req)
  if (corsResponse) return corsResponse

  try {
    console.log('Starting support messages sync...')

    // Initialize clients
    const supabase = initializeSupabaseClient()
    const credentials = initializeZendeskCredentials()

    // Create sync log entry
    const executionStartMs = Date.now()
    const timeoutGuard = new TimeoutGuard(executionStartMs)
    const { syncLog } = await createSyncLog(supabase, 'support', 'support_messages')
    const syncLogId = syncLog.id

    try {
      // Get last sync timestamp for incremental sync
      const { data: syncStatus } = await supabase
        .from('support_sync_status')
        .select('*')
        .eq('source', 'zendesk')
        .single()

      const lastSync = syncStatus?.last_messages_sync_timestamp

      // Default to 7 days lookback if no previous sync
      const lookbackDays = parseInt(Deno.env.get('ANALYSIS_LOOKBACK_DAYS') || '7')
      const defaultStartDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000)

      const startTime = lastSync
        ? Math.floor(new Date(lastSync).getTime() / 1000)
        : Math.floor(defaultStartDate.getTime() / 1000)

      console.log(`Syncing Zendesk comments from ${new Date(startTime * 1000).toISOString()}`)

      // Initialize Zendesk API client
      const zendeskClient = new ZendeskClient(
        credentials.subdomain,
        credentials.email,
        credentials.token
      )

      // Fetch and store comments using streaming pattern (same as sync-support-conversations)
      // This processes comments in batches as they arrive, avoiding timeout issues
      console.log('Fetching and storing Zendesk comments (streaming mode)...')

      let totalStored = 0
      const ticketIds = new Set<string>()

      await zendeskClient.fetchCommentsSince(startTime, async (commentBatch) => {
        // Check timeout before processing batch
        if (timeoutGuard.isApproachingTimeout()) {
          console.warn('⏱️ Approaching 140s timeout during comment fetch - stopping early')
          timeoutGuard.logStatus('During-Comment-Fetch')
          throw new Error('TIMEOUT_PREEMPTIVE: Stopped early to avoid 150s timeout')
        }

        // Track unique ticket IDs
        for (const comment of commentBatch) {
          ticketIds.add(comment.ticket_id.toString())
        }

        // Normalize comments with PII redaction
        const messagesForDB = commentBatch.map(comment => {
          const ticketId = comment.ticket_id.toString()
          const userDistinctId = comment.ticket_external_id || undefined

          return ConversationNormalizer.normalizeZendeskComment(
            comment,
            ticketId,
            userDistinctId
          )
        })

        // Store batch immediately
        try {
          const { error: insertError } = await supabase
            .from('support_conversation_messages')
            .insert(messagesForDB, {
              ignoreDuplicates: true,
            })

          if (insertError) {
            // Handle duplicate key errors gracefully
            const errorCode = insertError.code || insertError.error_code || ''

            if (errorCode === '23505' || insertError.message?.includes('duplicate key')) {
              console.warn(`⚠️ Duplicate key in batch - some messages already exist (continuing)`)
              return // Skip this batch but don't fail
            }

            // Handle statement timeout gracefully
            if (errorCode === '57014' || errorCode?.includes('57014') || insertError.message?.includes('statement timeout')) {
              console.warn(`⚠️ Statement timeout on batch - skipping and continuing...`)
              return // Skip this batch but don't fail
            }

            console.error('Error storing comment batch:', insertError)
            throw insertError
          }

          totalStored += messagesForDB.length
          console.log(`  ✓ Stored batch of ${messagesForDB.length} comments (total: ${totalStored})`)
        } catch (err) {
          // Handle preemptive timeout
          if (err?.message?.includes('TIMEOUT_PREEMPTIVE')) {
            console.warn(`⏱️ Preemptive timeout triggered - stopping batch processing`)
            throw err
          }

          // Handle statement timeout
          const errorCode = err?.code || err?.error_code || err?.message
          if (errorCode === '57014' || errorCode?.includes('57014') || err?.message?.includes('statement timeout')) {
            console.warn(`⚠️ Caught statement timeout exception - continuing...`)
            return // Skip this batch but don't fail
          }

          throw err
        }
      })

      console.log(`✓ Successfully stored ${totalStored} comments from ${ticketIds.size} tickets`)

      // Update message_count in raw_support_conversations for affected tickets
      console.log(`Updating message counts for ${ticketIds.size} affected conversations...`)
      console.log(`Sample ticket IDs:`, Array.from(ticketIds).slice(0, 5))

      // Use a single SQL query to update all message counts efficiently
      // This counts messages per conversation and updates the message_count column
      const { data: updateData, error: updateError } = await supabase.rpc('update_support_message_counts', {
        p_source: 'zendesk',
        p_conversation_ids: Array.from(ticketIds)
      })

      if (updateError) {
        console.error('⚠️ Failed to update message counts:', updateError)
        console.error('Error details:', JSON.stringify(updateError, null, 2))
      } else {
        console.log(`✓ RPC call succeeded - updated message counts for ${ticketIds.size} conversations`)
        if (updateData) {
          console.log('RPC response:', updateData)
        }

        // Verify: Check a sample conversation to see if message_count was updated
        const sampleTicketId = Array.from(ticketIds)[0]
        const { data: sampleConvo, error: checkError } = await supabase
          .from('raw_support_conversations')
          .select('id, message_count')
          .eq('source', 'zendesk')
          .eq('id', sampleTicketId)
          .single()

        if (!checkError && sampleConvo) {
          console.log(`Verification: Ticket ${sampleTicketId} has message_count = ${sampleConvo.message_count}`)
        } else {
          console.warn('Could not verify message_count update:', checkError?.message)
        }
      }

      // Update sync status with last messages sync timestamp (upsert to create if doesn't exist)
      const now = new Date().toISOString()
      const { error: syncStatusError } = await supabase
        .from('support_sync_status')
        .upsert({
          source: 'zendesk',
          last_sync_timestamp: now, // Required field
          last_messages_sync_timestamp: now,
          last_sync_status: 'success',
          updated_at: now,
        }, {
          onConflict: 'source'
        })

      if (syncStatusError) {
        console.error('⚠️ Failed to update support_sync_status:', syncStatusError)
      } else {
        console.log('✓ Updated support_sync_status table')
      }

      const elapsedMs = Date.now() - executionStartMs
      const elapsedSec = Math.round(elapsedMs / 1000)

      // Update sync log with success
      await updateSyncLogSuccess(supabase, syncLogId, {
        total_records_inserted: totalStored,
      })

      console.log(`Messages sync completed successfully in ${elapsedSec}s`)

      return createSuccessResponse('Support messages synced successfully', {
        totalTimeSeconds: elapsedSec,
        comments_synced: totalStored,
        tickets_affected: ticketIds.size,
        pii_redacted: true,
        streaming_mode: true,
      })
    } catch (error) {
      // Handle preemptive timeout gracefully (partial success)
      if (error?.message?.includes('TIMEOUT_PREEMPTIVE')) {
        console.warn('⏱️ Function stopped due to approaching timeout - returning partial results')

        await updateSyncLogSuccess(supabase, syncLogId, {
          total_records_inserted: totalStored,
        })

        return createSuccessResponse(
          'Support messages sync completed with partial results (timeout prevented)',
          {
            timeout_triggered: true,
            elapsed_seconds: timeoutGuard.getElapsedSeconds(),
            comments_synced: totalStored,
            tickets_affected: ticketIds.size,
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
    return createErrorResponse(error, 'sync-support-messages')
  }
})
