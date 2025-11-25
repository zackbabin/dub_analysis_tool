// Supabase Edge Function: sync-mixpanel-user-events-v2 (Insights API)
// Fetches aggregated event metrics from Mixpanel Insights API chart 85713544
// Replaces Export API with Insights API for better performance and reliability

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { fetchInsightsData } from '../_shared/mixpanel-api.ts'
import {
  initializeMixpanelCredentials,
  initializeSupabaseClient,
  handleCorsRequest,
  checkAndHandleSkipSync,
  createSyncLog,
  updateSyncLogSuccess,
  updateSyncLogFailure,
  createSuccessResponse,
  createErrorResponse,
  sanitizeDistinctId,
} from '../_shared/sync-helpers.ts'

const INSIGHTS_CHART_ID = '85713544' // Mixpanel Insights chart with 17 event metrics (returns both $user_id and $distinct_id)

// Map Mixpanel metric keys to database column names
const METRIC_MAP: Record<string, string> = {
  'A. Total Bank Links': 'total_bank_links',
  'B. Total Copies': 'total_copies',
  'C. Total Regular Copies': 'total_regular_copies',
  'D. Total Premium Copies': 'total_premium_copies',
  'E. Regular PDP Views': 'regular_pdp_views',
  'F. Premium PDP Views': 'premium_pdp_views',
  'G. Paywall Views': 'paywall_views',
  'H. Regular Creator Profile Views': 'regular_creator_views',
  'I. Premium Creator Profile Views': 'premium_creator_views',
  'J. Total Subscriptions': 'total_subscriptions',
  'K. App Sessions': 'app_sessions',
  'L. Discover Tab Views': 'discover_tab_views',
  'M. Leaderboard Tab Views': 'leaderboard_tab_views',
  'N. Premium Tab Views': 'premium_tab_views',
  'O. Stripe Modal Views': 'stripe_modal_views',
  'P. Creator Card Taps': 'creator_card_taps',
  'Q. Portfolio Card Taps': 'portfolio_card_taps',
}

interface UserMetrics {
  user_id: string        // Primary identifier from Mixpanel $user_id
  distinct_id: string    // Secondary identifier for Engage API mapping
  total_bank_links?: number
  total_copies?: number
  total_regular_copies?: number
  total_premium_copies?: number
  regular_pdp_views?: number
  premium_pdp_views?: number
  paywall_views?: number
  regular_creator_views?: number
  premium_creator_views?: number
  total_subscriptions?: number
  app_sessions?: number
  discover_tab_views?: number
  leaderboard_tab_views?: number
  premium_tab_views?: number
  stripe_modal_views?: number
  creator_card_taps?: number
  portfolio_card_taps?: number
}

/**
 * Parse Insights API response and transpose to user-centric format
 *
 * Chart 85713544 structure (with both identifiers):
 * {
 *   series: {
 *     "metric_key": {
 *       "$user_id": {
 *         "$overall": { "all": total_count },
 *         "$distinct_id_1": { "all": count1 },
 *         "$distinct_id_2": { "all": count2 }
 *       }
 *     }
 *   }
 * }
 *
 * Strategy:
 * - Use $user_id as primary key (unique per user)
 * - Use $overall count for metrics (aggregates across all distinct_ids)
 * - Pick one distinct_id for Engage API mapping (prefer non-$device: if available)
 *
 * Output format: Map<user_id, { user_id, distinct_id, metric1, metric2, ... }>
 */
function parseInsightsResponse(data: any): Map<string, UserMetrics> {
  const userMetricsMap = new Map<string, UserMetrics>()

  if (!data.series) {
    console.warn('No series data in Insights API response')
    return userMetricsMap
  }

  // Iterate through each metric (A. Total Bank Links, B. Total Copies, etc.)
  for (const [metricKey, metricData] of Object.entries(data.series)) {
    const dbColumn = METRIC_MAP[metricKey]
    if (!dbColumn) {
      console.warn(`Unknown metric key: ${metricKey}`)
      continue
    }

    // Iterate through each $user_id for this metric
    for (const [userId, userIdData] of Object.entries(metricData as Record<string, any>)) {
      // Skip $overall aggregate
      if (userId === '$overall') continue
      if (!userId) continue

      // Get $overall count (aggregates across all distinct_ids for this user)
      const overallData = userIdData['$overall']
      const count = overallData?.all || 0

      // Get or create user metrics object
      let userMetrics = userMetricsMap.get(userId)
      if (!userMetrics) {
        // Extract a distinct_id for Engage API mapping
        // Preference: non-$device: distinct_id, otherwise use any available
        let distinctId: string | null = null

        for (const [key, value] of Object.entries(userIdData)) {
          if (key === '$overall') continue

          // Found a distinct_id key
          if (key.startsWith('$device:')) {
            // Sanitize $device: prefix
            const sanitized = sanitizeDistinctId(key)
            if (sanitized && !distinctId) {
              distinctId = sanitized  // Use as fallback
            }
          } else {
            // Prefer non-$device: distinct_id
            distinctId = key
            break  // Stop searching, we found the preferred type
          }
        }

        // If no distinct_id found in nested data, use user_id as fallback
        if (!distinctId) {
          distinctId = userId
        }

        userMetrics = {
          user_id: userId,           // Primary identifier
          distinct_id: distinctId    // Secondary identifier for Engage API
        }
        userMetricsMap.set(userId, userMetrics)
      }

      // Set metric value using $overall count
      (userMetrics as any)[dbColumn] = count
    }
  }

  console.log(`✓ Parsed ${userMetricsMap.size} users with ${Object.keys(METRIC_MAP).length} metrics`)
  return userMetricsMap
}

/**
 * Bulk upsert user metrics to database with change detection
 */
async function upsertUserMetrics(
  supabase: any,
  users: UserMetrics[]
): Promise<number> {
  console.log(`Upserting ${users.length} users to subscribers_insights...`)

  const BATCH_SIZE = 250
  let totalUpserted = 0

  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const batch = users.slice(i, i + BATCH_SIZE)

    try {
      const { error, count } = await supabase
        .from('subscribers_insights')
        .upsert(batch, {
          onConflict: 'user_id',  // Use user_id as primary key
          count: 'exact'
        })

      if (error) {
        console.error(`Error upserting batch ${Math.floor(i / BATCH_SIZE) + 1}:`, error.message)
        throw error
      }

      const batchCount = count || batch.length
      totalUpserted += batchCount
      console.log(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batchCount} upserted`)
    } catch (batchError) {
      console.error(`Exception in batch ${Math.floor(i / BATCH_SIZE) + 1}:`, batchError)
      throw batchError
    }
  }

  console.log(`✓ Finished upsert: ${totalUpserted} users updated`)
  return totalUpserted
}

serve(async (req) => {
  const corsResponse = handleCorsRequest(req)
  if (corsResponse) return corsResponse

  try {
    console.log('Initializing credentials and Supabase client...')
    const credentials = initializeMixpanelCredentials()
    const supabase = initializeSupabaseClient()

    console.log('Starting Mixpanel user events sync v2 (Insights API)...')

    // Check skip sync (within 1-hour window)
    console.log('Checking skip sync...')
    const skipResponse = await checkAndHandleSkipSync(supabase, 'mixpanel_user_events_v2', 1)
    if (skipResponse) return skipResponse

    console.log('Creating sync log...')
    const executionStartMs = Date.now()
    const { syncLog, syncStartTime } = await createSyncLog(supabase, 'user', 'mixpanel_user_events_v2')
    const syncLogId = syncLog.id

    try {
      console.log(`Fetching event metrics from Mixpanel Insights API (chart ${INSIGHTS_CHART_ID})...`)
      console.log(`Tracking ${Object.keys(METRIC_MAP).length} metrics`)

      // Fetch data from Insights API
      const insightsData = await fetchInsightsData(
        credentials,
        INSIGHTS_CHART_ID,
        'User Event Metrics'
      )

      console.log('✓ Received data from Mixpanel Insights API')

      // Parse and transpose data to user-centric format
      const userMetricsMap = parseInsightsResponse(insightsData)
      const users = Array.from(userMetricsMap.values())

      console.log(`✓ Parsed ${users.length} user profiles`)

      // Upsert to database
      if (users.length > 0) {
        const updatedCount = await upsertUserMetrics(supabase, users)
        console.log(`✓ Upserted ${updatedCount} users`)
      }

      // Refresh dependent materialized views
      console.log('Refreshing main_analysis view...')
      const mainAnalysisStart = Date.now()
      const { error: mainAnalysisError } = await supabase.rpc('refresh_main_analysis')

      if (mainAnalysisError) {
        console.error('Error refreshing main_analysis:', mainAnalysisError)
        throw mainAnalysisError
      }

      const mainAnalysisElapsedSec = Math.round((Date.now() - mainAnalysisStart) / 1000)
      console.log(`✓ main_analysis refreshed in ${mainAnalysisElapsedSec}s`)

      // Note: copy_engagement_summary is now a regular view (not materialized)
      // No refresh needed - it automatically reflects changes to main_analysis
      console.log('ℹ️ copy_engagement_summary is a regular view - no refresh needed')

      const elapsedMs = Date.now() - executionStartMs
      const elapsedSec = Math.round(elapsedMs / 1000)

      await updateSyncLogSuccess(supabase, syncLogId, {
        total_records_inserted: users.length,
      })

      console.log(`✅ Sync completed successfully in ${elapsedSec}s`)

      return createSuccessResponse('User event metrics synced successfully (Insights API)', {
        totalTimeSeconds: elapsedSec,
        usersProcessed: users.length,
        metricsTracked: Object.keys(METRIC_MAP).length,
        chartId: INSIGHTS_CHART_ID,
      })
    } catch (error) {
      await updateSyncLogFailure(supabase, syncLogId, error)
      throw error
    }
  } catch (error) {
    return createErrorResponse(error, 'sync-mixpanel-user-events-v2')
  }
})
