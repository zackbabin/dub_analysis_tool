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
 * Extract Linear ticket IDs from text using pattern matching
 * Matches patterns like: DUB-123, LINEAR-456, etc.
 */
function extractLinearIds(text: string | null | undefined): string[] {
  if (!text) return []
  const matches = text.match(/\b[A-Z]+-\d+\b/g)
  return matches || []
}

/**
 * Find Linear issues directly linked via Zendesk integration, tags, or custom fields
 */
async function findDirectLinearLinks(
  supabase: any,
  feedbackIssue: FeedbackIssue
): Promise<Set<string>> {
  const linearIdentifiers = new Set<string>()

  // Get all conversation external IDs from examples
  const conversationIds = feedbackIssue.examples
    .map(ex => ex.conversation_id)

  if (conversationIds.length === 0) {
    return linearIdentifiers
  }

  // Query for all conversation data including tags and custom_fields
  const { data: conversations, error } = await supabase
    .from('enriched_support_conversations')
    .select('external_id, linear_identifier, tags, custom_fields')
    .in('external_id', conversationIds)

  if (error) {
    console.error('Error querying conversations for Linear links:', error)
    return linearIdentifiers
  }

  // Collect Linear identifiers from multiple sources
  for (const conv of conversations || []) {
    // Source 1: Direct linear_identifier field (from Zendesk-Linear integration)
    if (conv.linear_identifier) {
      linearIdentifiers.add(conv.linear_identifier)
    }

    // Source 2: Tags array (e.g., ["DUB-123", "bug"])
    if (conv.tags && Array.isArray(conv.tags)) {
      for (const tag of conv.tags) {
        const ids = extractLinearIds(tag)
        ids.forEach(id => linearIdentifiers.add(id))
      }
    }

    // Source 3: Custom fields object (e.g., { "linear_issue": "DUB-456", "linear_ticket": "DUB-789" })
    if (conv.custom_fields && typeof conv.custom_fields === 'object') {
      for (const value of Object.values(conv.custom_fields)) {
        if (typeof value === 'string') {
          const ids = extractLinearIds(value)
          ids.forEach(id => linearIdentifiers.add(id))
        }
      }
    }
  }

  if (linearIdentifiers.size > 0) {
    console.log(`  Found ${linearIdentifiers.size} direct Linear links for issue #${feedbackIssue.rank}`)
  }

  return linearIdentifiers
}

/**
 * Use Claude AI to semantically match ALL feedback issues to Linear issues in a SINGLE API call
 * This is 10x faster and cheaper than making 10 separate API calls
 */
async function findAISemanticMatchesBatch(
  anthropic: Anthropic,
  feedbackIssues: FeedbackIssue[],
  linearIssues: LinearIssue[]
): Promise<Map<number, Array<{ identifier: string; confidence: number }>>> {
  if (linearIssues.length === 0 || feedbackIssues.length === 0) {
    return new Map()
  }

  const prompt = `You are helping map customer support feedback to engineering tickets in Linear.

<feedback_issues>
${feedbackIssues.map(issue => `
Issue #${issue.rank}:
Category: ${issue.category}
Summary: ${issue.issue_summary}
Weekly Volume: ${issue.weekly_volume}
Examples: ${issue.examples.map(ex => `"${ex.excerpt}"`).join(', ')}
`).join('\n---\n')}
</feedback_issues>

<linear_issues>
${linearIssues.map(issue => `
ID: ${issue.identifier}
Title: ${issue.title}
Description: ${issue.description || 'No description'}
State: ${issue.state_name}
`).join('\n---\n')}
</linear_issues>

<task>
For EACH feedback issue (1-${feedbackIssues.length}), analyze and determine which Linear issues (if any) are related.

Consider:
- Direct matches (e.g., feedback about "bank linking" matches Linear issue "Fix Plaid bank linking errors")
- Indirect matches (e.g., feedback about "can't deposit money" relates to "Payment processing issues")
- Context and intent (e.g., "app crashes on portfolio page" relates to "Portfolio rendering bug")

Return ONLY a JSON object mapping issue ranks to matching Linear issues:
{
  "1": [
    { "identifier": "DUB-123", "confidence": 0.95 },
    { "identifier": "DUB-456", "confidence": 0.75 }
  ],
  "2": [
    { "identifier": "DUB-789", "confidence": 0.80 }
  ],
  "3": []
}

Rules:
- Only include matches with confidence >= 0.60
- confidence: 0.90-1.00 = Very strong match (same feature/bug)
- confidence: 0.75-0.89 = Strong match (related feature)
- confidence: 0.60-0.74 = Moderate match (related area)
- Return empty array [] for issues with no good matches
- Return ONLY the JSON object, no markdown or explanations
</task>`

  console.log(`  Using Claude AI to find semantic matches for ${feedbackIssues.length} issues (batch mode)...`)

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 16384,
      temperature: 0.3,
      messages: [{ role: 'user', content: prompt }],
    })

    const textContent = message.content[0].type === 'text' ? message.content[0].text : ''
    const cleanedText = textContent.trim()
      .replace(/^```json\s*/, '')
      .replace(/^```\s*/, '')
      .replace(/```\s*$/, '')

    const batchResults = JSON.parse(cleanedText)

    // Convert to Map<rank, matches[]>
    const resultsMap = new Map<number, Array<{ identifier: string; confidence: number }>>()
    for (const [rank, matches] of Object.entries(batchResults)) {
      resultsMap.set(parseInt(rank), matches as Array<{ identifier: string; confidence: number }>)
    }

    const totalMatches = Array.from(resultsMap.values()).reduce((sum, m) => sum + m.length, 0)
    console.log(`  Found ${totalMatches} total AI semantic matches across ${feedbackIssues.length} issues`)

    return resultsMap
  } catch (error) {
    console.error('  Error in batch AI semantic matching:', error)
    return new Map()
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

  // Load recent Linear issues from database (limit to 200 to avoid token limits)
  // This includes all recently updated issues which are most likely to be relevant
  const { data: linearIssues, error: linearError } = await supabase
    .from('linear_issues')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(200)

  if (linearError) throw linearError

  console.log(`Loaded ${linearIssues.length} Linear issues (limited to 200 most recent)`)

  // Clear existing mappings for this week
  await supabase
    .from('linear_feedback_mapping')
    .delete()
    .eq('feedback_week_start', weekStartDate)

  let totalMappings = 0
  const updatedIssues = []

  // Phase 1: Find direct Zendesk-Linear links for ALL issues
  console.log('\nPhase 1: Finding direct Zendesk-Linear links...')
  const directLinksMap = new Map<number, Set<string>>()
  for (const issue of topIssues) {
    const directLinks = await findDirectLinearLinks(supabase, issue)
    directLinksMap.set(issue.rank, directLinks)
    if (directLinks.size > 0) {
      console.log(`  Issue #${issue.rank}: ${directLinks.size} direct links`)
    }
  }

  // Phase 2: Batch AI semantic matching for issues WITHOUT direct links
  console.log('\nPhase 2: Running batch AI semantic matching...')
  const issuesNeedingAI = topIssues.filter(issue => {
    const directLinks = directLinksMap.get(issue.rank)
    return !directLinks || directLinks.size === 0
  })

  let aiMatchesMap = new Map<number, Array<{ identifier: string; confidence: number }>>()
  if (issuesNeedingAI.length > 0) {
    console.log(`  ${issuesNeedingAI.length} issues need AI matching`)
    aiMatchesMap = await findAISemanticMatchesBatch(anthropic, issuesNeedingAI, linearIssues)
  } else {
    console.log(`  All issues have direct links - skipping AI matching`)
  }

  // Phase 3: Process each issue and store mappings
  console.log('\nPhase 3: Creating database mappings...')
  for (const issue of topIssues) {
    console.log(`\nProcessing feedback issue #${issue.rank}: ${issue.issue_summary}`)

    const mappings: LinearMapping[] = []

    // Add direct links
    const directLinks = directLinksMap.get(issue.rank) || new Set()
    for (const identifier of directLinks) {
      const linearIssue = linearIssues.find((li: LinearIssue) => li.identifier === identifier)
      if (linearIssue) {
        mappings.push({
          linear_issue_id: linearIssue.id,
          linear_identifier: linearIssue.identifier,
          mapping_source: 'zendesk_integration',
          mapping_confidence: null,
        })
      }
    }

    // Add AI matches (if no direct links)
    if (mappings.length === 0) {
      const aiMatches = aiMatchesMap.get(issue.rank) || []
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
