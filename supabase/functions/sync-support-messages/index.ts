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

      // Fetch comments using incremental API
      console.log('Fetching Zendesk comments...')
      const commentEvents = await zendeskClient.fetchCommentsSince(startTime)

      console.log(`✓ Fetched ${commentEvents.length} comment events from Zendesk`)

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

      // Group comments by ticket to get user context
      const ticketIds = [...new Set(commentEvents.map(e => e.ticket_id.toString()))]
      console.log(`Comments span ${ticketIds.length} unique tickets`)

      // Fetch ticket data for user_id context (for PII redaction)
      const { data: tickets, error: ticketError } = await supabase
        .from('raw_support_conversations')
        .select('external_id, user_id')
        .eq('source', 'zendesk')
        .in('external_id', ticketIds)

      if (ticketError) {
        console.warn('⚠️ Could not fetch ticket context for PII redaction:', ticketError.message)
      }

      // Build ticket -> user_id lookup map
      const ticketUserMap = new Map<string, string | null>()
      for (const ticket of tickets || []) {
        ticketUserMap.set(ticket.external_id, ticket.user_id)
      }

      // Normalize comments with PII redaction
      const normalizedComments = commentEvents.map(event => {
        const ticketId = event.ticket_id.toString()
        const userDistinctId = ticketUserMap.get(ticketId) || undefined

        return ConversationNormalizer.normalizeZendeskComment(
          event.child_events?.[0] || event, // Comment data is in child_events
          ticketId,
          userDistinctId
        )
      })

      // Get conversation IDs from database (map external_id -> internal id)
      const { data: conversationIds, error: convError } = await supabase
        .from('raw_support_conversations')
        .select('id, external_id')
        .eq('source', 'zendesk')
        .in('external_id', ticketIds)

      if (convError) {
        console.error('Error fetching conversation IDs:', convError)
        throw convError
      }

      const externalToInternalId = new Map<string, number>()
      for (const conv of conversationIds || []) {
        externalToInternalId.set(conv.external_id, conv.id)
      }

      // Map to database schema with internal conversation_id
      const messagesForDB = normalizedComments
        .map(msg => {
          const conversationId = externalToInternalId.get(msg.conversation_external_id)

          if (!conversationId) {
            console.warn(`⚠️ No conversation found for external_id ${msg.conversation_external_id}`)
            return null
          }

          return {
            conversation_id: conversationId,
            external_id: msg.external_id,
            author_type: msg.author_type,
            author_id: msg.author_id,
            body: msg.body,
            is_public: msg.is_public,
            created_at: msg.created_at,
          }
        })
        .filter(m => m !== null)

      console.log(`Mapped ${messagesForDB.length} comments to database schema`)

      // Store messages in batches (to handle large volumes)
      const BATCH_SIZE = 500
      let totalStored = 0

      for (let i = 0; i < messagesForDB.length; i += BATCH_SIZE) {
        const batch = messagesForDB.slice(i, i + BATCH_SIZE)

        const { error: insertError } = await supabase
          .from('support_conversation_messages')
          .upsert(batch, {
            onConflict: 'conversation_id,external_id',
            ignoreDuplicates: false,
          })

        if (insertError) {
          console.error('Error storing message batch:', insertError)
          throw insertError
        }

        totalStored += batch.length
        console.log(`  ✓ Stored batch ${Math.floor(i / BATCH_SIZE) + 1} (${totalStored}/${messagesForDB.length} total)`)
      }

      console.log(`✓ Successfully stored ${totalStored} messages`)

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
