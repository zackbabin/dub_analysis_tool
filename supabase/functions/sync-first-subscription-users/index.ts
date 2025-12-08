// Supabase Edge Function: sync-first-subscription-users
// Fetches users who subscribed at least once from Mixpanel Insights chart 87078016
// Populates user_first_subscriptions table for use by analyze-subscription-sequences
//
// Data source:
//   - Mixpanel Insights chart 87078016: "Total Subscriptions (net refunds)" with $user_id and $time
//
// Chart structure:
//   - series["Total Subscriptions (net refunds)"][user_id][$overall]["all"] = 1
//   - series["Total Subscriptions (net refunds)"][user_id][timestamp]["all"] = 1
//
// Optimizations:
//   - Batched upserts (1000 rows per batch) to avoid timeout
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

    console.log('Starting first subscription users sync from Mixpanel chart 87078016...')

    // Create sync log entry
    const { syncLog, syncStartTime } = await createSyncLog(supabase, 'user', 'first_subscription_users')
    const syncLogId = syncLog.id

    try {
      // Fetch chart 87078016
      const projectId = MIXPANEL_CONFIG.PROJECT_ID
      const chartId = '87078016'
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

      // Debug: Log response structure
      console.log('📊 Chart API response keys:', Object.keys(chartData))
      if (chartData.meta) {
        console.log('📊 Response metadata:', JSON.stringify(chartData.meta, null, 2))
      }

      // Parse series object to extract first subscription times
      // Chart 87078016 structure: metric -> $user_id -> $time (first_subscription_time)
      const subscriptionRows: Array<{ user_id: string; first_subscription_time: string }> = []
      const series = chartData.series?.['Total Subscriptions (net refunds)'] || {}

      // Check response size
      const seriesLength = Object.keys(series).filter(k => k !== '$overall').length
      console.log(`⚠️ IMPORTANT: Fetched ${seriesLength} users from Insights API`)
      if (seriesLength >= 3000) {
        console.log(`⚠️ Mixpanel Insights API may be limiting results at ~3000 rows`)
      }

      const totalUserEntries = Object.keys(series).filter(k => k !== '$overall').length
      console.log(`📊 Processing ${totalUserEntries} user entries from series`)

      let skippedCount = 0
      let processedCount = 0

      for (const [userId, userIdData] of Object.entries(series)) {
        // Skip $overall aggregation key and empty user IDs
        if (userId === '$overall' || !userId) continue

        // Validate userIdData
        if (!userIdData || typeof userIdData !== 'object') {
          skippedCount++
          continue
        }

        // Extract first subscription time (first timestamp key that isn't $overall)
        const timestamps = Object.keys(userIdData as Record<string, any>)
        const firstSubscriptionTime = timestamps.find(k => k !== '$overall')

        if (!firstSubscriptionTime) {
          skippedCount++
          continue
        }

        // Parse subscription time
        let subscriptionDate: Date
        try {
          subscriptionDate = new Date(firstSubscriptionTime)
          if (isNaN(subscriptionDate.getTime())) {
            skippedCount++
            continue
          }
        } catch (error) {
          skippedCount++
          continue
        }

        // Extract first app open time (nested under first subscription time)
        let firstAppOpenTime: string | null = null
        const firstSubscriptionData = (userIdData as Record<string, any>)[firstSubscriptionTime]

        if (firstSubscriptionData && typeof firstSubscriptionData === 'object') {
          const appOpenTimestamps = Object.keys(firstSubscriptionData).filter(k => k !== '$overall')
          if (appOpenTimestamps.length > 0) {
            const appOpenTimeStr = appOpenTimestamps[0]
            try {
              const appOpenDate = new Date(appOpenTimeStr)
              if (!isNaN(appOpenDate.getTime())) {
                firstAppOpenTime = appOpenDate.toISOString()
              }
            } catch (error) {
              // Keep as null if invalid
            }
          }
        }

        subscriptionRows.push({
          user_id: userId,
          first_subscription_time: subscriptionDate.toISOString(),
          first_app_open_time: firstAppOpenTime
        })
        processedCount++
      }

      const rowsWithBothTimestamps = subscriptionRows.filter(row => row.first_app_open_time !== null).length
      console.log(`✅ Processed ${processedCount} subscription records (${skippedCount} skipped)`)
      console.log(`✓ ${rowsWithBothTimestamps} users have both first_subscription_time and first_app_open_time`)

      if (subscriptionRows.length === 0) {
        throw new Error('No valid subscription records found in chart data')
      }

      // Batch upsert to avoid timeout (1000 rows per batch)
      const BATCH_SIZE = 1000
      let totalUpserted = 0
      let totalBatches = Math.ceil(subscriptionRows.length / BATCH_SIZE)

      console.log(`Upserting ${subscriptionRows.length} rows in ${totalBatches} batches...`)

      for (let i = 0; i < subscriptionRows.length; i += BATCH_SIZE) {
        const batch = subscriptionRows.slice(i, i + BATCH_SIZE)
        const batchNum = Math.floor(i / BATCH_SIZE) + 1

        const { error: upsertError } = await supabase
          .from('user_first_subscriptions')
          .upsert(batch, {
            onConflict: 'user_id',
            ignoreDuplicates: false,
          })

        if (upsertError) {
          console.error(`❌ Batch ${batchNum} failed:`, upsertError)
          throw upsertError
        }

        totalUpserted += batch.length
        console.log(`✅ Batch ${batchNum}/${totalBatches}: Upserted ${batch.length} rows (total: ${totalUpserted})`)
      }

      console.log(`✅ All batches complete - upserted ${totalUpserted} user subscription records`)

      // Update sync log with success
      await updateSyncLogSuccess(supabase, syncLogId, {
        subscribers_fetched: totalUpserted,
        total_records_inserted: totalUpserted,
      }, syncStartTime)

      return createSuccessResponse(
        'First subscription users sync completed successfully',
        {
          total_users: totalUpserted,
          skipped: skippedCount,
        }
      )
    } catch (error) {
      // Update sync log with failure
      await updateSyncLogFailure(supabase, syncLogId, error)
      throw error
    }
  } catch (error) {
    return createErrorResponse(error, 'sync-first-subscription-users')
  }
})
