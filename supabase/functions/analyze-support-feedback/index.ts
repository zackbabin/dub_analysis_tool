// Supabase Edge Function: analyze-support-feedback
// Analyzes support conversations using Claude Sonnet 4
// Identifies top 10 product issues with frequency analysis and representative examples

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.32.0'
import {
  initializeSupabaseClient,
  handleCorsRequest,
  createSyncLog,
  updateSyncLogSuccess,
  updateSyncLogFailure,
  createSuccessResponse,
  createErrorResponse,
} from '../_shared/sync-helpers.ts'

interface EnrichedConversation {
  id: string
  external_id: string
  source: string
  title: string
  description: string
  created_at: string
  status: string
  priority: string
  tags: string[] | null
  custom_fields: Record<string, any> | null
  message_count: number
  all_messages: string[] | null
}

/**
 * Build Claude analysis prompt with conversations data
 */
function buildAnalysisPrompt(
  conversations: any[],
  weekStart: string,
  weekEnd: string,
  totalCount: number
): string {
  return `You are analyzing customer support conversations and bug reports for a fintech copy-trading platform called Dub, where retail investors follow and copy investment portfolios from creators.

<analysis_context>
Platform: Investment copy-trading platform (Dub)
Time Period: ${weekStart} to ${weekEnd}
Total Conversations: ${totalCount}
Data Sources: Zendesk support tickets + Instabug mobile bug reports
Metadata: Each conversation includes tags and custom_fields that may contain platform info, product areas, or other categorization hints
</analysis_context>

<conversations>
${JSON.stringify(conversations, null, 2)}
</conversations>

<task>
Analyze all conversations and identify the top 10 most significant product issues and feedback themes, ranked by a composite priority score.

**Consider tags and custom_fields** in each conversation for additional context about the issue type, platform, or product area.

**CATEGORIZATION RULES:**
You MUST assign each issue to exactly ONE of these categories, in this priority order:

1. **Compliance** - Issues related to:
   - Regulatory requirements (SEC, FINRA, state regulations)
   - KYC/AML verification and identity checks
   - Legal disclosures and risk warnings
   - Tax reporting (1099s, cost basis)
   - Accredited investor verification
   - Data privacy and GDPR compliance

2. **Money Movement** - Issues related to:
   - Bank account linking (Plaid integration)
   - Deposits and funding accounts
   - Withdrawals and cash-outs
   - Payment processing and transaction failures
   - ACH transfers and wire transfers
   - Refunds and chargebacks
   - Account balance discrepancies

3. **Trading** - Issues related to:
   - Order execution and fills
   - Portfolio copying and synchronization
   - Trade replication from creators
   - Position management
   - Stock/asset availability
   - Market data and quotes
   - Trade timing and latency

4. **App Functionality** - Issues related to:
   - UI bugs and crashes
   - App performance and loading times
   - Navigation and user flow problems
   - Login and authentication
   - Notifications and alerts
   - Search and filtering
   - Settings and preferences
   - Mobile app vs. web app issues

5. **Feature Request** - Issues related to:
   - New feature suggestions
   - Enhancement requests for existing features
   - User experience improvements
   - Creator tool requests
   - Analytics and reporting requests

**RANKING METHODOLOGY:**
Calculate a composite priority score (0-100) for each issue using this formula:

Priority Score = (Category Weight × 0.4) + (Percentage × 3 × 0.3) + (min(Volume, 50) / 50 × 100 × 0.3)

Where:
- Category Weight: Compliance=100, Money Movement=80, Trading=60, App Functionality=40, Feature Request=20
- Percentage: The percentage of total conversations (e.g., 15.5)
- Volume: Number of occurrences this week (capped at 50 for calculation)

Then rank all issues by priority score (highest to lowest) and return the top 10.

For each of the top 10 issues, provide:

1. **Category**: ONE of: Compliance, Money Movement, Trading, App Functionality, Feature Request

2. **Issue Summary**: Clear, concise description (140 characters or less, 1-2 sentences max)

3. **Percentage of Total**: Calculate what % of all ${totalCount} conversations relate to this issue

4. **Weekly Volume**: Count of tickets/bugs related to this issue this week

5. **Priority Score**: Calculated composite score (0-100) using the formula above. Show the calculation breakdown.

6. **Example Tickets**: Provide exactly 3 representative examples with:
   - Conversation ID (from the data)
   - Title (from the conversation title field)

</task>

<output_format>
Return ONLY valid JSON matching this exact structure:

{
  "analysis_summary": {
    "total_conversations_analyzed": number,
    "week_start": "YYYY-MM-DD",
    "week_end": "YYYY-MM-DD",
    "category_breakdown": {
      "compliance": number,
      "money_movement": number,
      "trading": number,
      "app_functionality": number,
      "feature_request": number
    },
    "key_insights": "2-3 sentence high-level summary"
  },
  "top_issues": [
    {
      "rank": 1,
      "category": "Compliance | Money Movement | Trading | App Functionality | Feature Request",
      "issue_summary": "string",
      "percentage_of_total": number,
      "weekly_volume": number,
      "priority_score": number,
      "priority_calculation": {
        "category_weight": number,
        "category_weight_contribution": number,
        "percentage_contribution": number,
        "volume_contribution": number
      },
      "examples": [
        {
          "conversation_id": "string",
          "title": "string"
        }
      ]
    }
  ]
}
</output_format>

<critical_instructions>
- Return ONLY the JSON object, no markdown formatting or code blocks
- Ensure all 10 issues have exactly 3 examples each
- STRICT CATEGORIZATION: Each issue must be assigned to exactly ONE category using the priority hierarchy (Compliance > Money Movement > Trading > App Functionality > Feature Request)
- When an issue could fit multiple categories, choose the HIGHEST priority category it matches
- Calculate priority scores exactly as specified in the formula
- Rank issues 1-10 by priority score (highest score = rank 1)
- Show priority calculation breakdown for transparency
- Include category_breakdown in analysis_summary showing count of issues per category across ALL conversations
- Focus on actionable product feedback, not general support inquiries
- Compliance issues automatically get highest priority due to regulatory risk
- Keep issue_summary to 140 characters or less for UI display
</critical_instructions>`
}

serve(async (req) => {
  // Handle CORS preflight requests
  const corsResponse = handleCorsRequest(req)
  if (corsResponse) return corsResponse

  try {
    console.log('Starting support feedback analysis...')

    // Initialize clients
    const supabase = initializeSupabaseClient()
    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY')

    if (!anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY not configured')
    }

    const anthropic = new Anthropic({ apiKey: anthropicApiKey })

    // Create sync log entry
    const executionStartMs = Date.now()
    const { syncLog, syncStartTime } = await createSyncLog(supabase, 'support', 'support_analysis')
    const syncLogId = syncLog.id

    try {
      // Calculate date range (default: last 30 days for analysis)
      // Note: ANALYSIS_WINDOW_DAYS is separate from sync lookback
      const analysisWindowDays = parseInt(Deno.env.get('ANALYSIS_WINDOW_DAYS') || '30')
      const now = new Date()
      const startDate = new Date(now.getTime() - analysisWindowDays * 24 * 60 * 60 * 1000)
      const weekStart = startDate.toISOString().split('T')[0]
      const weekEnd = now.toISOString().split('T')[0]

      console.log(`Analyzing conversations from ${weekStart} to ${weekEnd} (${analysisWindowDays} days)`)

      // NOTE: We skip refreshing the materialized view here to reduce disk IO
      // The view is refreshed by a scheduled job (refresh-materialized-views cron)
      // This prevents expensive full table scans on every analysis run
      console.log('Skipping materialized view refresh (handled by cron job)')

      let conversations = null
      let fetchError = null
      const MAX_CONVERSATIONS = 300

      // Try fetching from enriched view first
      console.log('Attempting to fetch from enriched_support_conversations...')
      const enrichedResult = await supabase
        .from('enriched_support_conversations')
        .select('*')
        .gte('created_at', startDate.toISOString())
        .lt('created_at', now.toISOString())
        .order('created_at', { ascending: false })
        .limit(MAX_CONVERSATIONS)

      if (enrichedResult.error) {
        console.warn('⚠️ Failed to fetch from enriched view:', enrichedResult.error.message)
      } else if (enrichedResult.data && enrichedResult.data.length > 0) {
        console.log(`✓ Fetched ${enrichedResult.data.length} conversations from enriched view`)
        conversations = enrichedResult.data
      }

      // FALLBACK: If enriched view is empty or failed, query raw table directly
      if (!conversations || conversations.length === 0) {
        console.log('⚠️ Enriched view empty or unavailable, querying raw_support_conversations...')

        const rawResult = await supabase
          .from('raw_support_conversations')
          .select(`
            id,
            external_id,
            source,
            title,
            description,
            created_at,
            status,
            priority,
            tags,
            custom_fields
          `)
          .gte('created_at', startDate.toISOString())
          .lt('created_at', now.toISOString())
          .order('created_at', { ascending: false })
          .limit(MAX_CONVERSATIONS)

        if (rawResult.error) {
          console.error('❌ Failed to fetch from raw table:', rawResult.error)
          throw rawResult.error
        }

        if (!rawResult.data || rawResult.data.length === 0) {
          console.log('No conversations found in raw table either')
          await updateSyncLogSuccess(supabase, syncLogId, {
            total_records_inserted: 0,
          })

          return createSuccessResponse('No conversations to analyze', {
            conversation_count: 0,
            week_start: weekStart,
            week_end: weekEnd,
          })
        }

        // Fetch messages separately for raw conversations
        console.log(`✓ Fetched ${rawResult.data.length} conversations from raw table, fetching messages...`)

        const conversationIds = rawResult.data.map(c => c.id)
        const { data: messages } = await supabase
          .from('support_conversation_messages')
          .select('conversation_id, body, created_at')
          .in('conversation_id', conversationIds)
          .order('created_at', { ascending: true })

        // Build enriched format from raw data
        conversations = rawResult.data.map((conv: any) => {
          const convMessages = messages?.filter(m => m.conversation_id === conv.id) || []
          return {
            ...conv,
            message_count: convMessages.length,
            all_messages: convMessages.map(m => m.body),
            // No Linear data available in fallback mode
            linear_identifier: null,
            linear_title: null,
            linear_state: null,
            linear_url: null
          }
        })

        console.log(`✓ Built ${conversations.length} enriched conversations from raw data (without Linear metadata)`)
      }

      console.log(`Found ${conversations.length} conversations to analyze`)

      // Format conversations for Claude (with text sanitization and truncation)
      const formattedConversations = conversations.map((conv: EnrichedConversation, idx: number) => {
        const messages = conv.all_messages || []
        const conversationText = messages.length > 0 ? messages.join('\n---\n') : conv.description || ''

        // Sanitize text to prevent JSON issues
        const sanitize = (text: string | null) => {
          if (!text) return ''
          // Replace problematic characters but keep readable
          return text
            .replace(/\\/g, '\\\\')  // Escape backslashes
            .replace(/"/g, '\\"')     // Escape quotes
            .replace(/\n/g, ' ')      // Replace newlines with spaces
            .replace(/\r/g, '')       // Remove carriage returns
            .replace(/\t/g, ' ')      // Replace tabs with spaces
        }

        // Truncate conversation text to 225 chars to stay under 200k token limit (with buffer for tags/custom_fields)
        const MAX_CONVERSATION_LENGTH = 225
        let truncatedText = sanitize(conversationText)
        if (truncatedText.length > MAX_CONVERSATION_LENGTH) {
          truncatedText = truncatedText.substring(0, MAX_CONVERSATION_LENGTH) + '... [truncated]'
        }

        return {
          id: idx + 1,
          external_id: conv.external_id,
          source: conv.source,
          title: sanitize(conv.title),
          created_at: conv.created_at,
          status: conv.status,
          priority: conv.priority,
          tags: conv.tags || [],
          custom_fields: conv.custom_fields || {},
          full_conversation: truncatedText,
          message_count: conv.message_count,
        }
      })

      // Build Claude prompt
      const prompt = buildAnalysisPrompt(formattedConversations, weekStart, weekEnd, conversations.length)

      console.log('Sending to Claude for analysis...')

      // Call Claude API
      const message = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8000, // Reduced to stay under 200k combined input+output limit
        temperature: 0.3,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      })

      const textContent = message.content[0].type === 'text' ? message.content[0].text : ''

      console.log('Claude response length:', textContent.length)
      console.log('First 500 chars:', textContent.substring(0, 500))
      console.log('Last 500 chars:', textContent.substring(textContent.length - 500))

      // Parse Claude's response with better error handling
      let analysis
      try {
        // Try to clean common JSON issues
        let cleanedText = textContent.trim()

        // Remove markdown code blocks if present
        if (cleanedText.startsWith('```json')) {
          cleanedText = cleanedText.replace(/^```json\s*/, '').replace(/```\s*$/, '')
        } else if (cleanedText.startsWith('```')) {
          cleanedText = cleanedText.replace(/^```\s*/, '').replace(/```\s*$/, '')
        }

        analysis = JSON.parse(cleanedText)
      } catch (parseError) {
        console.error('JSON Parse Error:', parseError)
        console.error('Failed to parse response:', textContent)
        throw new Error(`Claude returned invalid JSON: ${parseError.message}. Response preview: ${textContent.substring(0, 1000)}`)
      }

      // Calculate cost
      const inputCostPer1M = 3.0
      const outputCostPer1M = 15.0
      const inputCost = (message.usage.input_tokens / 1_000_000) * inputCostPer1M
      const outputCost = (message.usage.output_tokens / 1_000_000) * outputCostPer1M
      const totalCost = inputCost + outputCost
      const totalTokens = message.usage.input_tokens + message.usage.output_tokens

      console.log(`Analysis complete. Tokens: ${totalTokens}, Cost: $${totalCost.toFixed(4)}`)

      // Store results
      const { error: saveError } = await supabase
        .from('support_analysis_results')
        .upsert(
          {
            analysis_date: now.toISOString().split('T')[0],
            week_start_date: weekStart,
            conversation_count: conversations.length,
            total_tokens_used: totalTokens,
            analysis_cost: totalCost,
            top_issues: analysis.top_issues,
            raw_response: JSON.stringify(analysis),
          },
          { onConflict: 'week_start_date' }
        )

      if (saveError) throw saveError

      const elapsedMs = Date.now() - executionStartMs
      const elapsedSec = Math.round(elapsedMs / 1000)

      // Update sync log with success
      await updateSyncLogSuccess(supabase, syncLogId, {
        total_records_inserted: 1, // 1 analysis result
      })

      console.log(`Analysis completed successfully in ${elapsedSec}s`)

      // Trigger next step in workflow: map-linear-to-feedback
      // Fire-and-forget to avoid timeout issues (don't await)
      console.log('Triggering next step: map-linear-to-feedback...')
      const supabaseUrl = Deno.env.get('SUPABASE_URL')
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

      if (supabaseUrl && serviceKey) {
        fetch(`${supabaseUrl}/functions/v1/map-linear-to-feedback`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
          },
        }).catch(err => {
          console.warn('⚠️ Failed to trigger map-linear-to-feedback:', err.message)
          // Don't fail this function if next step fails to trigger
        })
        console.log('✓ Triggered map-linear-to-feedback (async)')
      } else {
        console.warn('⚠️ Cannot trigger next step - SUPABASE_URL or SERVICE_KEY not configured')
      }

      return createSuccessResponse('Support feedback analyzed successfully', {
        totalTimeSeconds: elapsedSec,
        conversation_count: conversations.length,
        tokens_used: totalTokens,
        cost: totalCost,
        week_start: weekStart,
        week_end: weekEnd,
        top_issues_count: analysis.top_issues?.length || 0,
      })
    } catch (error) {
      // Update sync log with failure
      await updateSyncLogFailure(supabase, syncLogId, error)
      throw error
    }
  } catch (error) {
    return createErrorResponse(error, 'analyze-support-feedback')
  }
})
