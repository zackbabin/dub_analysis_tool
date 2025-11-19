// Supabase Edge Function: map-linear-to-feedback
// Maps Linear issues to the top 10 support feedback items
// Uses both direct Zendesk-Linear integration links and AI semantic matching

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

interface FeedbackIssue {
  rank: number
  category: string
  issue_summary: string
  percentage_of_total: number
  weekly_volume: number
  examples: Array<{
    conversation_id: string
    source: string
    excerpt: string
    user_info?: string
  }>
}

interface LinearIssue {
  id: string
  identifier: string
  title: string
  description: string | null
  state_name: string
  url: string
}

interface LinearMapping {
  linear_issue_id: string
  linear_identifier: string
  mapping_source: 'zendesk_integration' | 'ai_semantic_match'
  mapping_confidence: number | null
}

/**
 * Calculate consolidated status from multiple Linear issues
 */
function calculateLinearStatus(linearIssues: LinearIssue[]): string | null {
  if (linearIssues.length === 0) return null

  const states = linearIssues.map(i => i.state_name)

  // All in Backlog or Todo => "Backlog"
  const allBacklogOrTodo = states.every(s =>
    ['Backlog', 'Todo', 'To Do'].includes(s)
  )
  if (allBacklogOrTodo) return 'Backlog'

  // All Done or Cancelled => "Done"
  const allDoneOrCancelled = states.every(s =>
    ['Done', 'Cancelled', 'Canceled'].includes(s)
  )
  if (allDoneOrCancelled) return 'Done'

  // Any active work (not Backlog/Todo/Triage/Cancelled/Done) => "In Progress"
  const hasActiveWork = states.some(s =>
    !['Backlog', 'Todo', 'To Do', 'Triage', 'Cancelled', 'Canceled', 'Done'].includes(s)
  )
  if (hasActiveWork) return 'In Progress'

  return null
}

/**
 * Find Linear issues directly linked via Zendesk integration
 */
async function findDirectLinearLinks(
  supabase: any,
  feedbackIssue: FeedbackIssue
): Promise<Set<string>> {
  const linearIdentifiers = new Set<string>()

  // Get all conversation external IDs from examples
  const conversationIds = feedbackIssue.examples
    .filter(ex => ex.source === 'zendesk')
    .map(ex => ex.conversation_id)

  if (conversationIds.length === 0) {
    return linearIdentifiers
  }

  // Query enriched_support_conversations for Linear metadata
  const { data: conversations, error } = await supabase
    .from('enriched_support_conversations')
    .select('external_id, linear_identifier, linear_issue_id')
    .in('external_id', conversationIds)
    .not('linear_identifier', 'is', null)

  if (error) {
    console.error('Error querying conversations for Linear links:', error)
    return linearIdentifiers
  }

  // Collect all Linear identifiers
  for (const conv of conversations || []) {
    if (conv.linear_identifier) {
      linearIdentifiers.add(conv.linear_identifier)
    }
  }

  if (linearIdentifiers.size > 0) {
    console.log(`  Found ${linearIdentifiers.size} direct Linear links for issue #${feedbackIssue.rank}`)
  }

  return linearIdentifiers
}

/**
 * Use Claude AI to semantically match feedback to Linear issues
 */
async function findAISemanticMatches(
  anthropic: Anthropic,
  feedbackIssue: FeedbackIssue,
  linearIssues: LinearIssue[]
): Promise<Array<{ identifier: string; confidence: number }>> {
  if (linearIssues.length === 0) {
    return []
  }

  const prompt = `You are helping map customer support feedback to engineering tickets in Linear.

<feedback_issue>
Category: ${feedbackIssue.category}
Summary: ${feedbackIssue.issue_summary}
Weekly Volume: ${feedbackIssue.weekly_volume}
Examples: ${feedbackIssue.examples.map(ex => `"${ex.excerpt}"`).join(', ')}
</feedback_issue>

<linear_issues>
${linearIssues.map(issue => `
ID: ${issue.identifier}
Title: ${issue.title}
Description: ${issue.description || 'No description'}
State: ${issue.state_name}
`).join('\n---\n')}
</linear_issues>

<task>
Analyze the feedback issue and determine which Linear issues (if any) are related to this customer feedback.

Consider:
- Direct matches (e.g., feedback about "bank linking" matches Linear issue "Fix Plaid bank linking errors")
- Indirect matches (e.g., feedback about "can't deposit money" relates to "Payment processing issues")
- Context and intent (e.g., "app crashes on portfolio page" relates to "Portfolio rendering bug")

Return ONLY a JSON array of matching Linear issue identifiers with confidence scores:
[
  { "identifier": "DUB-123", "confidence": 0.95 },
  { "identifier": "DUB-456", "confidence": 0.75 }
]

Rules:
- Only include matches with confidence >= 0.60
- confidence: 0.90-1.00 = Very strong match (same feature/bug)
- confidence: 0.75-0.89 = Strong match (related feature)
- confidence: 0.60-0.74 = Moderate match (related area)
- Return empty array [] if no good matches found
- Return ONLY the JSON array, no markdown or explanations
</task>`

  console.log(`  Using Claude AI to find semantic matches for issue #${feedbackIssue.rank}...`)

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 16384, // Match analyze-support-feedback for consistency
      temperature: 0.3,  // Match analyze-support-feedback for consistency
      messages: [{ role: 'user', content: prompt }],
    })

    const textContent = message.content[0].type === 'text' ? message.content[0].text : ''
    const cleanedText = textContent.trim()
      .replace(/^```json\s*/, '')
      .replace(/^```\s*/, '')
      .replace(/```\s*$/, '')

    const matches = JSON.parse(cleanedText)
    console.log(`  Found ${matches.length} AI semantic matches`)

    return matches
  } catch (error) {
    console.error('  Error in AI semantic matching:', error)
    return []
  }
}

/**
 * Map Linear issues to feedback items
 */
async function mapLinearToFeedback(
  supabase: any,
  anthropic: Anthropic,
  analysisId: string
) {
  console.log('Loading latest support analysis results...')

  // Get latest analysis
  const { data: analysis, error: analysisError } = await supabase
    .from('support_analysis_results')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (analysisError || !analysis) {
    throw new Error('No support analysis results found')
  }

  const weekStartDate = analysis.week_start_date
  const topIssues: FeedbackIssue[] = analysis.top_issues

  console.log(`Found ${topIssues.length} feedback issues to map`)

  // Load all Linear issues from database
  const { data: linearIssues, error: linearError } = await supabase
    .from('linear_issues')
    .select('*')
    .order('updated_at', { ascending: false })

  if (linearError) throw linearError

  console.log(`Loaded ${linearIssues.length} Linear issues`)

  // Clear existing mappings for this week
  await supabase
    .from('linear_feedback_mapping')
    .delete()
    .eq('feedback_week_start', weekStartDate)

  let totalMappings = 0
  const updatedIssues = []

  // Process each feedback issue
  for (const issue of topIssues) {
    console.log(`\nProcessing feedback issue #${issue.rank}: ${issue.issue_summary}`)

    const mappings: LinearMapping[] = []

    // Phase 1: Find direct Zendesk-Linear links
    const directLinks = await findDirectLinearLinks(supabase, issue)

    for (const identifier of directLinks) {
      // Find the Linear issue by identifier
      const linearIssue = linearIssues.find((li: LinearIssue) => li.identifier === identifier)
      if (linearIssue) {
        mappings.push({
          linear_issue_id: linearIssue.id,
          linear_identifier: linearIssue.identifier,
          mapping_source: 'zendesk_integration',
          mapping_confidence: null, // Direct link, no confidence score
        })
      }
    }

    // Phase 2: AI semantic matching (if no direct links found)
    if (mappings.length === 0) {
      const aiMatches = await findAISemanticMatches(anthropic, issue, linearIssues)

      for (const match of aiMatches) {
        const linearIssue = linearIssues.find((li: LinearIssue) => li.identifier === match.identifier)
        if (linearIssue) {
          mappings.push({
            linear_issue_id: linearIssue.id,
            linear_identifier: linearIssue.identifier,
            mapping_source: 'ai_semantic_match',
            mapping_confidence: match.confidence,
          })
        }
      }
    }

    // Store mappings in database
    if (mappings.length > 0) {
      const mappingRecords = mappings.map(m => ({
        feedback_week_start: weekStartDate,
        feedback_rank: issue.rank,
        feedback_summary: issue.issue_summary,
        linear_issue_id: m.linear_issue_id,
        linear_identifier: m.linear_identifier,
        mapping_source: m.mapping_source,
        mapping_confidence: m.mapping_confidence,
      }))

      const { error: insertError } = await supabase
        .from('linear_feedback_mapping')
        .insert(mappingRecords)

      if (insertError) {
        console.error('Error inserting mappings:', insertError)
      } else {
        totalMappings += mappings.length
        console.log(`  ✅ Created ${mappings.length} mappings`)
      }
    } else {
      console.log(`  No Linear issues found for this feedback`)
    }

    // Calculate status and prepare updated issue data
    const mappedLinearIssues = mappings.map(m =>
      linearIssues.find((li: LinearIssue) => li.id === m.linear_issue_id)
    ).filter(Boolean)

    const linearStatus = calculateLinearStatus(mappedLinearIssues)

    const updatedIssue = {
      ...issue,
      linear_issue_ids: mappings.map(m => m.linear_identifier),
      linear_status: linearStatus,
      linear_issues: mappedLinearIssues.map(li => ({
        id: li.identifier,
        title: li.title,
        state: li.state_name,
        url: li.url,
      })),
    }

    updatedIssues.push(updatedIssue)
  }

  // Update support_analysis_results with Linear data
  const { error: updateError } = await supabase
    .from('support_analysis_results')
    .update({ top_issues: updatedIssues })
    .eq('id', analysis.id)

  if (updateError) {
    console.error('Error updating analysis with Linear data:', updateError)
    throw updateError
  }

  console.log(`\n✅ Mapping complete: ${totalMappings} total mappings created`)

  return {
    total_mappings: totalMappings,
    issues_with_mappings: updatedIssues.filter(i => i.linear_issue_ids?.length > 0).length,
    issues_without_mappings: updatedIssues.filter(i => !i.linear_issue_ids || i.linear_issue_ids.length === 0).length,
  }
}

/**
 * Main handler
 */
serve(async (req) => {
  // Handle CORS preflight requests
  const corsResponse = handleCorsRequest(req)
  if (corsResponse) return corsResponse

  try {
    console.log('Starting Linear-to-feedback mapping...')

    // Initialize clients
    const supabase = initializeSupabaseClient()
    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY')

    if (!anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY not configured')
    }

    const anthropic = new Anthropic({ apiKey: anthropicApiKey })

    // Create sync log entry
    const executionStartMs = Date.now()
    const { syncLog } = await createSyncLog(supabase, 'linear', 'linear_feedback_mapping')
    const syncLogId = syncLog.id

    try {
      // Perform mapping
      const stats = await mapLinearToFeedback(supabase, anthropic, syncLogId)

      const elapsedMs = Date.now() - executionStartMs
      const elapsedSec = Math.round(elapsedMs / 1000)

      // Update sync log with success
      await updateSyncLogSuccess(supabase, syncLogId, {
        total_records_inserted: stats.total_mappings,
      })

      console.log(`✅ Linear mapping completed successfully in ${elapsedSec}s`)

      return createSuccessResponse('Linear-to-feedback mapping completed', {
        totalTimeSeconds: elapsedSec,
        ...stats,
      })
    } catch (error) {
      // Update sync log with failure
      await updateSyncLogFailure(supabase, syncLogId, error)
      throw error
    }
  } catch (error) {
    return createErrorResponse(error, 'map-linear-to-feedback')
  }
})
