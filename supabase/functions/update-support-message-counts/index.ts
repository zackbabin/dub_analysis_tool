// Supabase Edge Function: update-support-message-counts
// Updates message_count in raw_support_conversations based on support_conversation_messages
// Can be run independently after sync-support-messages or as a repair function

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import {
  initializeSupabaseClient,
  handleCorsRequest,
  createSuccessResponse,
  createErrorResponse,
} from '../_shared/sync-helpers.ts'

serve(async (req) => {
  // Handle CORS preflight requests
  const corsResponse = handleCorsRequest(req)
  if (corsResponse) return corsResponse

  try {
    console.log('Starting message count update...')
    const startTime = Date.now()

    // Initialize Supabase client
    const supabase = initializeSupabaseClient()

    // Get all unique conversation IDs from messages table
    // This ensures we update counts for all conversations that have messages
    console.log('Fetching unique conversation IDs from support_conversation_messages...')
    const { data: conversations, error: fetchError } = await supabase
      .from('support_conversation_messages')
      .select('conversation_source, conversation_id')
      .eq('conversation_source', 'zendesk')

    if (fetchError) {
      throw new Error(`Failed to fetch conversations: ${fetchError.message}`)
    }

    // Get unique (source, conversation_id) pairs
    const uniqueConversations = new Map<string, Set<string>>()

    for (const row of conversations || []) {
      const source = row.conversation_source
      const conversationId = row.conversation_id

      if (!uniqueConversations.has(source)) {
        uniqueConversations.set(source, new Set())
      }
      uniqueConversations.get(source)!.add(conversationId)
    }

    console.log(`Found ${conversations?.length || 0} total message records`)

    let totalConversationsUpdated = 0

    // Process each source separately
    for (const [source, conversationIds] of uniqueConversations.entries()) {
      const conversationIdsArray = Array.from(conversationIds)
      console.log(`Updating message counts for ${conversationIdsArray.length} conversations from source: ${source}`)

      // Update message counts using our RPC function
      const { data: updateData, error: updateError } = await supabase.rpc(
        'update_support_message_counts',
        {
          p_source: source,
          p_conversation_ids: conversationIdsArray,
        }
      )

      if (updateError) {
        console.error(`⚠️ Failed to update message counts for source ${source}:`, updateError)
        throw new Error(`Failed to update message counts: ${updateError.message}`)
      }

      console.log(`✓ Updated message counts for ${conversationIdsArray.length} conversations from ${source}`)
      totalConversationsUpdated += conversationIdsArray.length
    }

    // Verify: Check a sample to confirm counts were updated
    const { data: sample, error: sampleError } = await supabase
      .from('raw_support_conversations')
      .select('id, message_count')
      .eq('source', 'zendesk')
      .not('message_count', 'is', null)
      .limit(5)

    if (!sampleError && sample) {
      console.log('✓ Sample verification - conversations with message_count:')
      sample.forEach(conv => {
        console.log(`  - Conversation ${conv.id}: ${conv.message_count} messages`)
      })
    }

    const elapsedMs = Date.now() - startTime
    const elapsedSec = Math.round(elapsedMs / 1000)

    console.log(`Message count update completed successfully in ${elapsedSec}s`)

    return createSuccessResponse('Message counts updated successfully', {
      totalTimeSeconds: elapsedSec,
      conversations_updated: totalConversationsUpdated,
      sources_processed: Array.from(uniqueConversations.keys()),
    })
  } catch (error) {
    return createErrorResponse(error, 'update-support-message-counts')
  }
})
