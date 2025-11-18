// Supabase Edge Function: sync-linear-issues
// Fetches Linear issues from "dub 3.0" team (last 6 months)
// Stores issues in linear_issues table for mapping to support feedback

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { LinearClient } from 'npm:@linear/sdk@31.0.0'
import {
  initializeSupabaseClient,
  handleCorsRequest,
  createSyncLog,
  updateSyncLogSuccess,
  updateSyncLogFailure,
  createSuccessResponse,
  createErrorResponse,
} from '../_shared/sync-helpers.ts'

/**
 * Initialize Linear client with API key from environment
 */
function initializeLinearClient(): LinearClient {
  const linearApiKey = Deno.env.get('LINEAR_API_KEY')

  if (!linearApiKey) {
    throw new Error('LINEAR_API_KEY not configured in Supabase secrets')
  }

  return new LinearClient({ apiKey: linearApiKey })
}

/**
 * Fetch issues from Linear for "dub 3.0" team, last 6 months
 * Uses pagination to fetch all issues without limit
 */
async function fetchLinearIssues(linearClient: LinearClient) {
  console.log('Fetching issues from Linear...')

  // Calculate date range (6 months ago)
  const sixMonthsAgo = new Date()
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)

  try {
    // Get the "dub 3.0" team first
    const teams = await linearClient.teams({
      filter: {
        name: { eq: 'dub 3.0' }
      }
    })

    const dubTeam = teams.nodes[0]

    if (!dubTeam) {
      throw new Error('Team "dub 3.0" not found in Linear workspace')
    }

    console.log(`Found team: ${dubTeam.name} (${dubTeam.id})`)

    // Fetch all issues using pagination
    let allIssues = []
    let hasNextPage = true
    let cursor = undefined
    let pageCount = 0
    const PAGE_SIZE = 100 // Fetch 100 issues per page

    while (hasNextPage) {
      pageCount++
      console.log(`Fetching page ${pageCount}...`)

      const issuesPage = await linearClient.issues({
        filter: {
          team: { id: { eq: dubTeam.id } },
          createdAt: { gte: sixMonthsAgo }
        },
        includeArchived: false,
        first: PAGE_SIZE,
        after: cursor
      })

      allIssues = allIssues.concat(issuesPage.nodes)
      hasNextPage = issuesPage.pageInfo.hasNextPage
      cursor = issuesPage.pageInfo.endCursor

      console.log(`  Page ${pageCount}: ${issuesPage.nodes.length} issues (total: ${allIssues.length})`)
    }

    console.log(`✅ Fetched ${allIssues.length} total issues from Linear across ${pageCount} pages`)

    // Fetch state and assignee details for each issue
    const enrichedIssues = await Promise.all(
      allIssues.map(async (issue) => {
        const state = await issue.state
        const assignee = await issue.assignee
        const team = await issue.team

        return {
          id: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          description: issue.description || null,
          state_name: state?.name || 'Unknown',
          state_type: state?.type || null,
          team_id: team?.id || null,
          team_name: team?.name || null,
          assignee_id: assignee?.id || null,
          assignee_name: assignee?.name || null,
          priority: issue.priority,
          priority_label: issue.priorityLabel || null,
          url: issue.url,
          created_at: issue.createdAt,
          updated_at: issue.updatedAt,
          completed_at: issue.completedAt || null,
          canceled_at: issue.canceledAt || null,
        }
      })
    )

    return enrichedIssues
  } catch (error) {
    console.error('Error fetching Linear issues:', error)
    throw error
  }
}

/**
 * Store Linear issues in database
 */
async function storeLinearIssues(supabase: any, issues: any[]) {
  console.log(`Storing ${issues.length} issues in database...`)

  // Use upsert to handle updates to existing issues
  const { data, error } = await supabase
    .from('linear_issues')
    .upsert(
      issues.map((issue) => ({
        ...issue,
        synced_at: new Date().toISOString(),
      })),
      { onConflict: 'id' }
    )
    .select()

  if (error) {
    console.error('Error storing Linear issues:', error)
    throw error
  }

  console.log(`✅ Stored ${issues.length} Linear issues`)
  return issues.length
}

/**
 * Main handler
 */
serve(async (req) => {
  // Handle CORS preflight requests
  const corsResponse = handleCorsRequest(req)
  if (corsResponse) return corsResponse

  try {
    console.log('Starting Linear issues sync...')

    // Initialize clients
    const supabase = initializeSupabaseClient()
    const linearClient = initializeLinearClient()

    // Create sync log entry
    const executionStartMs = Date.now()
    const { syncLog } = await createSyncLog(supabase, 'linear', 'linear_issues')
    const syncLogId = syncLog.id

    try {
      // Fetch issues from Linear
      const issues = await fetchLinearIssues(linearClient)

      // Store in database
      const issuesStored = await storeLinearIssues(supabase, issues)

      const elapsedMs = Date.now() - executionStartMs
      const elapsedSec = Math.round(elapsedMs / 1000)

      // Update sync log with success
      await updateSyncLogSuccess(supabase, syncLogId, {
        total_records_inserted: issuesStored,
      })

      console.log(`✅ Linear sync completed successfully in ${elapsedSec}s`)

      // Trigger next step in workflow: analyze-support-feedback
      // Fire-and-forget to avoid timeout issues (don't await)
      console.log('Triggering next step: analyze-support-feedback...')
      const supabaseUrl = Deno.env.get('SUPABASE_URL')
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

      if (supabaseUrl && serviceKey) {
        fetch(`${supabaseUrl}/functions/v1/analyze-support-feedback`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
          },
        }).catch(err => {
          console.warn('⚠️ Failed to trigger analyze-support-feedback:', err.message)
          // Don't fail this function if next step fails to trigger
        })
        console.log('✓ Triggered analyze-support-feedback (async)')
      } else {
        console.warn('⚠️ Cannot trigger next step - SUPABASE_URL or SERVICE_KEY not configured')
      }

      // Return summary statistics
      const stateBreakdown = issues.reduce((acc: any, issue: any) => {
        acc[issue.state_name] = (acc[issue.state_name] || 0) + 1
        return acc
      }, {})

      return createSuccessResponse('Linear issues synced successfully', {
        totalTimeSeconds: elapsedSec,
        issues_synced: issuesStored,
        team: 'dub 3.0',
        date_range: '6 months',
        state_breakdown: stateBreakdown,
      })
    } catch (error) {
      // Update sync log with failure
      await updateSyncLogFailure(supabase, syncLogId, error)
      throw error
    }
  } catch (error) {
    return createErrorResponse(error, 'sync-linear-issues')
  }
})
