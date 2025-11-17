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
  const instabugToken = Deno.env.get('INSTABUG_TOKEN')

  if (!zendeskSubdomain || !zendeskEmail || !zendeskToken) {
    throw new Error('Zendesk credentials not configured (ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, ZENDESK_TOKEN)')
  }

  if (!instabugToken) {
    throw new Error('Instabug credentials not configured (INSTABUG_TOKEN)')
  }

  console.log('Support API credentials loaded from secrets')

  return {
    zendesk: { subdomain: zendeskSubdomain, email: zendeskEmail, token: zendeskToken },
    instabug: { token: instabugToken },
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
        .in('source', ['zendesk', 'instabug'])

      const zendeskLastSync = syncStatus?.find((s) => s.source === 'zendesk')?.last_sync_timestamp
      const instabugLastSync = syncStatus?.find((s) => s.source === 'instabug')?.last_sync_timestamp

      // Default to 7 days lookback if no previous sync
      const lookbackDays = parseInt(Deno.env.get('ANALYSIS_LOOKBACK_DAYS') || '7')
      const defaultStartDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000)

      const zendeskStartTime = zendeskLastSync
        ? Math.floor(new Date(zendeskLastSync).getTime() / 1000)
        : Math.floor(defaultStartDate.getTime() / 1000)

      const instabugStartTime = instabugLastSync
        ? new Date(instabugLastSync).toISOString()
        : defaultStartDate.toISOString()

      console.log(`Syncing Zendesk from ${new Date(zendeskStartTime * 1000).toISOString()}`)
      console.log(`Syncing Instabug from ${instabugStartTime}`)

      // Initialize API clients
      const zendeskClient = new ZendeskClient(
        credentials.zendesk.subdomain,
        credentials.zendesk.email,
        credentials.zendesk.token
      )

      const instabugClient = new InstabugClient(credentials.instabug.token)

      // Fetch Zendesk data
      console.log('Fetching Zendesk tickets...')
      const zendeskTickets = await zendeskClient.fetchTicketsSince(zendeskStartTime)

      console.log('Fetching Zendesk comments...')
      const zendeskComments = await zendeskClient.fetchCommentsSince(zendeskStartTime)

      // Fetch Instabug data
      console.log('Fetching Instabug bugs...')
      const instabugBugs = await instabugClient.fetchBugsSince(instabugStartTime)

      console.log('Fetching Instabug comments...')
      const instabugComments: any[] = []
      for (const bug of instabugBugs) {
        const comments = await instabugClient.fetchBugComments(bug.id)
        instabugComments.push(...comments.map((c) => ({ ...c, bugId: bug.id })))
      }

      // Normalize data with PII redaction
      console.log('Normalizing and redacting PII...')
      const normalizedTickets = zendeskTickets.map((t) =>
        ConversationNormalizer.normalizeZendeskTicket(t)
      )
      const normalizedBugs = instabugBugs.map((b) =>
        ConversationNormalizer.normalizeInstabugBug(b)
      )
      const allConversations = [...normalizedTickets, ...normalizedBugs]

      // Create mapping of ticket/bug external IDs to user distinct_ids for comment redaction
      const distinctIdMap = new Map<string, string>()
      zendeskTickets.forEach((t) => {
        if (t.external_id) distinctIdMap.set(t.id.toString(), t.external_id)
      })
      instabugBugs.forEach((b) => {
        if (b.user?.id) distinctIdMap.set(b.id.toString(), b.user.id.toString())
      })

      const normalizedZendeskComments = zendeskComments.map((c) =>
        ConversationNormalizer.normalizeZendeskComment(
          c,
          c.ticket_id,
          distinctIdMap.get(c.ticket_id?.toString())
        )
      )
      const normalizedInstabugComments = instabugComments.map((c) =>
        ConversationNormalizer.normalizeInstabugComment(c, c.bugId, distinctIdMap.get(c.bugId?.toString()))
      )
      const allMessages = [...normalizedZendeskComments, ...normalizedInstabugComments]

      // Store conversations
      console.log(`Storing ${allConversations.length} conversations...`)
      const { error: convError } = await supabase
        .from('raw_support_conversations')
        .upsert(allConversations, {
          onConflict: 'source,external_id',
          ignoreDuplicates: false,
        })

      if (convError) throw convError

      // Get conversation UUIDs for messages
      const externalIds = [...new Set(allMessages.map((m) => m.conversation_external_id))]
      const { data: conversations } = await supabase
        .from('raw_support_conversations')
        .select('id, external_id, source')
        .in('external_id', externalIds)

      const idMap = new Map(conversations?.map((c) => [`${c.source}-${c.external_id}`, c.id]) || [])

      // Map messages to conversation UUIDs
      const mappedMessages = allMessages
        .map((m) => {
          // Determine source from conversation_external_id
          let source = 'zendesk'
          if (instabugBugs.some((b) => b.id.toString() === m.conversation_external_id)) {
            source = 'instabug'
          }

          const conversationId = idMap.get(`${source}-${m.conversation_external_id}`)
          if (!conversationId) return null

          return {
            conversation_id: conversationId,
            external_id: m.external_id,
            author_type: m.author_type,
            author_id: m.author_id,
            author_email: m.author_email,
            body: m.body,
            is_public: m.is_public,
            created_at: m.created_at,
            attachments: m.attachments,
            raw_data: m.raw_data,
          }
        })
        .filter((m) => m !== null)

      // Store messages
      console.log(`Storing ${mappedMessages.length} messages...`)
      if (mappedMessages.length > 0) {
        const { error: msgError } = await supabase
          .from('support_conversation_messages')
          .upsert(mappedMessages, {
            onConflict: 'conversation_id,external_id',
            ignoreDuplicates: false,
          })

        if (msgError) throw msgError
      }

      // Refresh materialized view
      console.log('Refreshing enriched view...')
      const { error: refreshError } = await supabase.rpc('refresh_enriched_support_conversations')
      if (refreshError) {
        console.warn('Failed to refresh materialized view:', refreshError)
        // Don't throw - this is non-critical
      }

      // Update sync status
      const now = new Date().toISOString()
      await supabase
        .from('support_sync_status')
        .update({
          last_sync_timestamp: now,
          last_sync_status: 'success',
          conversations_synced: normalizedTickets.length,
          messages_synced: normalizedZendeskComments.length,
          error_message: null,
          updated_at: now,
        })
        .eq('source', 'zendesk')

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

      const elapsedMs = Date.now() - executionStartMs
      const elapsedSec = Math.round(elapsedMs / 1000)

      // Update sync log with success
      await updateSyncLogSuccess(supabase, syncLogId, {
        total_records_inserted: allConversations.length + mappedMessages.length,
      })

      console.log(`Sync completed successfully in ${elapsedSec}s`)

      return createSuccessResponse('Support conversations synced successfully', {
        totalTimeSeconds: elapsedSec,
        zendesk: {
          tickets: zendeskTickets.length,
          comments: zendeskComments.length,
        },
        instabug: {
          bugs: instabugBugs.length,
          comments: instabugComments.length,
        },
        total_conversations: allConversations.length,
        total_messages: mappedMessages.length,
        pii_redacted: true,
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
