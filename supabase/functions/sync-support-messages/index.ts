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

      // Fetch comments using incremental API with timeout awareness
      // Use 120s threshold (30s buffer for processing) instead of default 140s
      console.log('Fetching Zendesk comments...')
      const fetchStartMs = Date.now()
      const commentEvents = await zendeskClient.fetchCommentsSince(
        startTime,
        () => timeoutGuard.getElapsedSeconds() >= 120 // Stop at 120s to leave 30s for processing
      )
      const fetchElapsedSec = Math.round((Date.now() - fetchStartMs) / 1000)

      console.log(`✓ Fetched ${commentEvents.length} comment events from Zendesk in ${fetchElapsedSec}s`)
      console.log(`  Total elapsed: ${timeoutGuard.getElapsedSeconds()}s / 120s fetch limit (30s reserved for processing)`)

      if (commentEvents.length > 0) {
        console.log(`  Sample comment event keys: ${Object.keys(commentEvents[0]).join(', ')}`)
      }

      // Check timeout after fetch
      if (timeoutGuard.isApproachingTimeout()) {
        console.warn('⏱️ Approaching 140s timeout after comment fetch - returning early')
        timeoutGuard.logStatus('Post-Comment-Fetch')

        await updateSyncLogSuccess(supabase, syncLogId, {
          total_records_inserted: 0,
        })

        return createSuccessResponse('Sync stopped early due to timeout (no comments processed)', {
          timeout_triggered: true,
          elapsed_seconds: timeoutGuard.getElapsedSeconds(),
          comments_synced: 0,
        })
      }

      if (commentEvents.length === 0) {
        console.log('No new comments to sync')

        await updateSyncLogSuccess(supabase, syncLogId, {
          total_records_inserted: 0,
        })

        return createSuccessResponse('No new comments to sync', {
          totalTimeSeconds: Math.round((Date.now() - executionStartMs) / 1000),
          comments_synced: 0,
        })
      }

      // Normalize comments with PII redaction
      // NOTE: ticket_external_id is already included in comment events from Zendesk API
      console.log(`Normalizing ${commentEvents.length} comments with PII redaction...`)

      const ticketIds = [...new Set(commentEvents.map(e => e.ticket_id.toString()))]
      console.log(`Comments span ${ticketIds.length} unique tickets`)

      const messagesForDB = commentEvents.map(comment => {
        const ticketId = comment.ticket_id.toString()
        const userDistinctId = comment.ticket_external_id || undefined // external_id = Mixpanel distinct_id

        return ConversationNormalizer.normalizeZendeskComment(
          comment,
          ticketId, // This is the Zendesk ticket ID, which is now our primary key
          userDistinctId
        )
      })

      console.log(`✓ Normalized ${messagesForDB.length} comments, ready to store`)

      // Store messages in batches (to handle large volumes)
      const BATCH_SIZE = 500
      let totalStored = 0

      if (messagesForDB.length === 0) {
        console.warn('⚠️ No messages to store - all messages were filtered out')
      } else {
        console.log(`Starting batch insert for ${messagesForDB.length} messages...`)
        console.log(`Sample message record: ${JSON.stringify(messagesForDB[0])}`)
      }

      const batchStartMs = Date.now()
      for (let i = 0; i < messagesForDB.length; i += BATCH_SIZE) {
        const batch = messagesForDB.slice(i, i + BATCH_SIZE)
        const batchNum = Math.floor(i / BATCH_SIZE) + 1
        const totalBatches = Math.ceil(messagesForDB.length / BATCH_SIZE)

        console.log(`  Inserting batch ${batchNum}/${totalBatches} (${batch.length} messages)...`)
        console.log(`    Total elapsed: ${timeoutGuard.getElapsedSeconds()}s / 140s`)

        const { data, error: insertError, count } = await supabase
          .from('support_conversation_messages')
          .upsert(batch, {
            onConflict: 'conversation_source,conversation_id,created_at,author_id',
            ignoreDuplicates: false,
            count: 'exact'
          })

        if (insertError) {
          console.error(`❌ Error storing message batch ${batchNum}/${totalBatches}:`, insertError)
          console.error('   Error code:', insertError.code)
          console.error('   Error details:', insertError.details)
          console.error('   Sample record from failed batch:', JSON.stringify(batch[0]))
          throw insertError
        }

        totalStored += batch.length
        const batchElapsedSec = Math.round((Date.now() - batchStartMs) / 1000)
        console.log(`  ✓ Batch ${batchNum}/${totalBatches} complete in ${batchElapsedSec}s: ${totalStored}/${messagesForDB.length} total messages stored`)
      }

      console.log(`✓ Successfully stored ${totalStored} messages`)

      // Check timeout before updating counts
      if (timeoutGuard.isApproachingTimeout()) {
        console.warn('⏱️ Approaching 140s timeout - skipping message count updates')
        timeoutGuard.logStatus('Pre-Count-Update')

        await updateSyncLogSuccess(supabase, syncLogId, {
          total_records_inserted: totalStored,
        })

        return createSuccessResponse('Messages synced (counts skipped due to timeout)', {
          timeout_triggered: true,
          elapsed_seconds: timeoutGuard.getElapsedSeconds(),
          comments_synced: totalStored,
          tickets_affected: ticketIds.length,
          message_counts_updated: false,
        })
      }

      // Update message_count in raw_support_conversations for each affected conversation
      // Count messages per conversation in the Edge Function (more efficient than DB queries)
      console.log('Calculating message counts per conversation...')
      const conversationMessageCounts = new Map()

      for (const msg of messagesForDB) {
        const count = conversationMessageCounts.get(msg.conversation_id) || 0
        conversationMessageCounts.set(msg.conversation_id, count + 1)
      }

      console.log(`Updating message counts for ${conversationMessageCounts.size} conversations in batch...`)

      // Batch update message counts (much faster than individual RPC calls)
      const updatePromises = Array.from(conversationMessageCounts.entries()).map(([conversationId, count]) =>
        supabase
          .from('raw_support_conversations')
          .update({ message_count: count })
          .eq('source', 'zendesk')
          .eq('id', conversationId)
      )

      const updateResults = await Promise.allSettled(updatePromises)
      const successCount = updateResults.filter(r => r.status === 'fulfilled').length
      const failCount = updateResults.filter(r => r.status === 'rejected').length

      console.log(`✓ Updated message counts: ${successCount} succeeded, ${failCount} failed`)

      if (failCount > 0) {
        console.warn(`⚠️ ${failCount} conversations failed to update message count (non-fatal)`)
      }

      // Update sync status with last messages sync timestamp
      const now = new Date().toISOString()
      await supabase
        .from('support_sync_status')
        .update({
          last_messages_sync_timestamp: now,
          updated_at: now,
        })
        .eq('source', 'zendesk')

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
        tickets_affected: ticketIds.length,
        pii_redacted: true,
      })
    } catch (error) {
      // Update sync log with failure
      await updateSyncLogFailure(supabase, syncLogId, error)
      throw error
    }
  } catch (error) {
    return createErrorResponse(error, 'sync-support-messages')
  }
})
