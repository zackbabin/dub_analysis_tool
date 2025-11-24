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
  id: string // Ticket ID (Zendesk ticket.id, Instabug bug.id)
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

**ANALYSIS APPROACH:**
- Look for recurring patterns and common root causes across conversations
- Group similar issues together (e.g., "ACH transfer delays" not "payment issues" and "transfer problems" separately)
- Be specific: identify the exact feature, flow, or technical problem users are experiencing
- Consider tags and custom_fields in each conversation for additional context about the issue type, platform, or product area
- Focus on the core underlying issue, not superficial variations in how users describe it
- Maintain consistent terminology across analyses - use the same names for recurring issues

**CATEGORIZATION RULES:**
You MUST assign each issue to exactly ONE of these categories, in this priority order:

1. **Money Movement** - If a user cannot deposit or withdraw money from the platform:
   - Bank account linking (Plaid integration)
   - Deposits and funding accounts
   - Withdrawals and cash-outs
   - Payment processing and transaction failures
   - ACH transfers and wire transfers
   - Refunds and chargebacks
   - Account balance discrepancies

2. **Trading** - If a user is unable to trade or sell:
   - Order execution and fills
   - Portfolio copying and synchronization
   - Trade replication from creators
   - Position management
   - Stock/asset availability
   - Market data and quotes
   - Trade timing and latency

3. **App Functionality** - If the user cannot access the app or faces broken functionality:
   - UI bugs and crashes
   - App performance and loading times
   - Navigation and user flow problems
   - Login and authentication
   - Notifications and alerts
   - Search and filtering
   - Settings and preferences
   - Mobile app vs. web app issues

4. **Feedback** - If user gets frustrated or provides feedback about the app experience or new features:
   - User frustration or complaints
   - General feedback about the app experience
   - New feature suggestions
   - Enhancement requests for existing features
   - User experience improvements
   - Creator tool requests
   - Analytics and reporting requests

**RANKING METHODOLOGY:**
Calculate a composite priority score (0-100) for each issue using this formula with EQUAL WEIGHT for all components:

Priority Score = (Category Weight × 0.33) + (Percentage × 3 × 0.33) + (min(Volume, 50) / 50 × 100 × 0.34)

Where:
- Category Weight: Money Movement=100, Trading=80, App Functionality=60, Feedback=40
- Percentage: The percentage of total conversations (e.g., 15.5)
- Volume: Number of occurrences this week (capped at 50 for calculation)
- Each component now has equal weight (33.33% each)

**MESSAGE COUNT ANALYSIS:**
When analyzing conversations, consider the number of back-and-forth messages between user and agent as an indicator of issue complexity/severity:
- Higher message count (5+ messages) often indicates complex issues, user frustration, or inadequate resolution
- Lower message count (1-2 messages) may indicate simple issues or quick resolutions
- Use message_count field from conversation data to inform your analysis
- Include this insight in your issue_summary when relevant (e.g., "Users report X issue requiring multiple back-and-forth exchanges to resolve")

Then rank all issues by priority score (highest to lowest) and return the top 10.

For each of the top 10 issues, provide:

1. **Category**: ONE of: Money Movement, Trading, App Functionality, Feedback

2. **Issue Summary**: Clear, concise description (140 characters or less, 1-2 sentences max)

3. **Percentage of Total**: Calculate what % of all ${totalCount} conversations relate to this issue

4. **Weekly Volume**: Count of tickets/bugs related to this issue this week

5. **Priority Score**: Calculated composite score (0-100) using the formula above. Show the calculation breakdown.

6. **Example Tickets**: Provide exactly 3 representative examples with:
   - Conversation ID (from the data)
   - Title (from the conversation title field)
   - Description (up to 140 characters from the conversation content, truncated if longer)

</task>

<output_format>
Return ONLY valid JSON matching this exact structure:

{
  "analysis_summary": {
    "total_conversations_analyzed": number,
    "week_start": "YYYY-MM-DD",
    "week_end": "YYYY-MM-DD",
    "category_breakdown": {
      "money_movement": number,
      "trading": number,
      "app_functionality": number,
      "feedback": number
    },
    "key_insights": "2-3 sentence high-level summary focusing on the most significant patterns and trends. Be specific about what issues are affecting users."
  },
  "top_issues": [
    {
      "rank": 1,
      "category": "Money Movement | Trading | App Functionality | Feedback",
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
      "avg_message_count": number,
      "message_count_insight": "string (optional: brief note if high message count indicates complexity/frustration)",
      "examples": [
        {
          "conversation_id": "string",
          "title": "string",
          "description": "string (max 140 characters)",
          "message_count": number
        }
      ]
    }
  ]
}
</output_format>

<critical_instructions>
- Return ONLY the JSON object, no markdown formatting or code blocks
- Ensure all 10 issues have exactly 3 examples each
- STRICT CATEGORIZATION: Each issue must be assigned to exactly ONE category using the priority hierarchy (Money Movement > Trading > App Functionality > Feedback)
- When an issue could fit multiple categories, choose the HIGHEST priority category it matches
- Calculate priority scores exactly as specified in the formula with equal 33% weight for each component
- Rank issues 1-10 by priority score (highest score = rank 1)

**SPECIFICITY REQUIREMENTS:**
- Be specific and concrete in your issue summaries - avoid vague descriptions
- Reference specific features, user flows, or technical problems when possible
- For example, instead of "Users having payment issues", say "Users unable to link bank accounts via Plaid integration"
- Include specific error types, feature names, or user actions in your summaries

**CONSISTENCY REQUIREMENTS:**
- Your analysis should remain stable and consistent across runs when analyzing similar data
- If the ticket data hasn't changed significantly day-to-day, your top issues should remain largely the same
- Focus on identifying the true underlying patterns rather than minor variations in how users describe problems
- Group related issues together consistently (e.g., all ACH transfer delays should be one issue, not split across multiple issues)
- Use the same terminology and phrasing for recurring issues across different analysis runs
- Prioritize consistency in issue identification over finding new variations of the same problem
- Show priority calculation breakdown for transparency
- Include category_breakdown in analysis_summary showing count of issues per category across ALL conversations
- Include avg_message_count for each issue (average of message_count across related conversations)
- Include message_count for each example ticket
- Add message_count_insight when high message counts (5+) indicate issue complexity or user frustration
- Focus on actionable product feedback, not general support inquiries
- Money Movement issues automatically get highest priority since users cannot deposit or withdraw money
- Keep issue_summary to 140 characters or less for UI display
- IMPORTANT: Properly escape all special characters in JSON strings (quotes, backslashes, unicode characters like ellipsis …)
- Replace ellipsis characters (…) with three dots (...) in all text fields
- Ensure all conversation titles are properly escaped for valid JSON
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

      // NOTE: enriched_support_conversations is a regular view (not materialized)
      // It automatically shows latest data from support conversations and messages
      // No refresh needed - queries are fast with indexed date filters
      console.log('Querying enriched_support_conversations (regular view - always current)...')

      let conversations = null
      let fetchError = null
      const MAX_CONVERSATIONS = 250

      // Query enriched view with date filter
      console.log('Fetching from enriched_support_conversations...')
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
            custom_fields,
            message_count
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
            // Use message_count from database if available, otherwise count messages
            message_count: conv.message_count ?? convMessages.length,
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
            .replace(/…/g, '...')     // Replace ellipsis with three dots
            .replace(/'/g, "'")       // Replace curly single quotes
            .replace(/'/g, "'")       // Replace curly single quotes
            .replace(/"/g, '"')       // Replace curly double quotes
            .replace(/"/g, '"')       // Replace curly double quotes
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
          ticket_id: conv.id, // Ticket ID from source system
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
        max_tokens: 10000, // Increased to accommodate descriptions in examples (10 issues x 3 examples x 140 chars)
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

      // Post-process: Convert weekly_volume to true weekly average
      // Claude returns total count in analysis window, we need to divide by number of weeks
      const numberOfWeeks = analysisWindowDays / 7
      console.log(`Converting weekly_volume to average (dividing by ${numberOfWeeks.toFixed(1)} weeks)`)

      if (analysis.top_issues && Array.isArray(analysis.top_issues)) {
        analysis.top_issues = analysis.top_issues.map((issue: any) => ({
          ...issue,
          weekly_volume: issue.weekly_volume ? Math.round(issue.weekly_volume / numberOfWeeks) : 0
        }))
      }

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
      console.log('✓ Frontend will trigger map-linear-to-feedback to complete workflow')

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
