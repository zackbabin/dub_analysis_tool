// Supabase Edge Function: sync-first-copy-users
// Fetches users who copied at least once from Mixpanel Insights chart 86612901
// Populates user_first_copies table for use by sync-portfolio-sequences and sync-creator-sequences
//
// Data source:
//   - Mixpanel Insights chart 86612901: "Uniques of Copied Portfolio" with $user_id and $time
//
// Note: Insights API doesn't support date filtering
//   - Always fetches all data from chart (date range configured in Mixpanel UI)
//   - Database upsert with onConflict handles deduplication

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import {
  initializeMixpanelCredentials,
  initializeSupabaseClient,
  handleCorsRequest,
  createSyncLog,
  updateSyncLogSuccess,
  updateSyncLogFailure,
  createSuccessResponse,
  createErrorResponse,
} from '../_shared/sync-helpers.ts'
import { MIXPANEL_CONFIG } from '../_shared/mixpanel-api.ts'

serve(async (req) => {
  // Handle CORS preflight requests
  const corsResponse = handleCorsRequest(req)
  if (corsResponse) return corsResponse

  try {
    // Initialize Mixpanel credentials and Supabase client
    const credentials = initializeMixpanelCredentials()
    const supabase = initializeSupabaseClient()

    console.log('Starting first copy users sync from Mixpanel chart 86612901...')

    // Create sync log entry
    const { syncLog, syncStartTime } = await createSyncLog(supabase, 'user', 'first_copy_users')
    const syncLogId = syncLog.id

    try {
      // Note: Insights API doesn't support date filtering
      // We fetch all data from the chart and let DB upsert handle deduplication
      console.log('📦 Fetching all data from chart (date range configured in Mixpanel UI)')

      // Fetch chart 86612901
      const projectId = MIXPANEL_CONFIG.PROJECT_ID
      const chartId = '86612901'
      const chartUrl = `https://mixpanel.com/api/query/insights?project_id=${projectId}&bookmark_id=${chartId}`

      console.log(`Fetching Mixpanel chart ${chartId}...`)

      // Use Basic Auth
      const authString = `${credentials.username}:${credentials.secret}`
      const authHeader = `Basic ${btoa(authString)}`

      const chartResponse = await fetch(chartUrl, {
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/json',
        },
      })

      if (!chartResponse.ok) {
        throw new Error(`Chart API failed: ${chartResponse.status} ${chartResponse.statusText}`)
      }

      const chartData = await chartResponse.json()
      console.log(`✓ Fetched chart data (${Object.keys(chartData.series || {}).length} total keys)`)

      // Parse series object to extract first copy times
      // Chart 86612901 structure: metric -> $user_id -> $time
      // Headers: ["$metric", "$user_id", "$time"]
      const copyRows: Array<{ user_id: string; first_copy_time: string }> = []
      const series = chartData.series?.['Uniques of Copied Portfolio'] || {}

      for (const [userId, userIdData] of Object.entries(series)) {
        // Skip $overall aggregation key
        if (userId === '$overall') continue
        if (!userId) continue

        // Validate userIdData is an object
        if (!userIdData || typeof userIdData !== 'object') {
          console.warn(`Skipping user_id ${userId} - no timestamp data`)
          continue
        }

        // Find ISO timestamp within user_id data (exclude $overall)
        const isoTimestamps = Object.keys(userIdData as Record<string, any>).filter(k => k !== '$overall')
        if (isoTimestamps.length === 0) {
          console.warn(`Skipping user_id ${userId} - no timestamp in data`)
          continue
        }

        // First ISO timestamp is the first copy time
        const firstCopyTime = isoTimestamps[0]

        // Validate it's a proper ISO timestamp
        if (!firstCopyTime.includes('T') && !firstCopyTime.includes('-')) {
          console.warn(`Skipping user_id ${userId} - invalid timestamp format: ${firstCopyTime}`)
          continue
        }

        const firstCopyDate = new Date(firstCopyTime)

        // Store user_id and first copy time
        copyRows.push({
          user_id: userId,
          first_copy_time: firstCopyDate.toISOString()
        })
      }

      console.log(`✓ Extracted ${copyRows.length} first copy users from chart`)

      // Insert/update user_first_copies
      if (copyRows.length > 0) {
        const { error: copyError } = await supabase
          .from('user_first_copies')
          .upsert(copyRows, {
            onConflict: 'user_id'  // PRIMARY KEY - will update first_copy_time if changed
          })

        if (copyError) {
          console.error('Error upserting user_first_copies:', copyError)
          throw copyError
        }

        console.log(`✅ Upserted ${copyRows.length} rows to user_first_copies`)
      } else {
        console.log('ℹ️ No new first copy users to sync')
      }

      // Update sync log with success
      await updateSyncLogSuccess(supabase, syncLogId, {
        total_records_inserted: copyRows.length,
        metadata: {
          chartId: '86612901'
        }
      })

      return createSuccessResponse({
        message: 'First copy users synced successfully',
        stats: {
          usersSynced: copyRows.length
        }
      })
    } catch (error: any) {
      // Update sync log with failure
      await updateSyncLogFailure(supabase, syncLogId, error)
      throw error
    }
  } catch (error: any) {
    console.error('Error in sync-first-copy-users function:', error)
    return createErrorResponse(error.message || String(error))
  }
})
