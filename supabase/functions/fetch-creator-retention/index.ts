// Supabase Edge Function: fetch-creator-retention
// Fetches creator subscription retention data from Mixpanel Insights Chart 85857452
// Stores subscription and renewal events by user, creator, and time cohort
// Calculates retention metrics by querying stored data

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { CORS_HEADERS, fetchInsightsData, type MixpanelCredentials } from '../_shared/mixpanel-api.ts'
import {
  initializeMixpanelCredentials,
  initializeSupabaseClient,
  handleCorsRequest,
  checkAndHandleSkipSync,
} from '../_shared/sync-helpers.ts'

const SUBSCRIBED_CHART_ID = '85857452'  // "Total Subscriptions (net refunds)" metric - now uses $user_id
const RENEWED_CHART_ID = '86188712'      // "Renewed Subscription" metric - now uses $user_id

serve(async (req) => {
  // Handle CORS preflight requests
  const corsResponse = handleCorsRequest(req)
  if (corsResponse) return corsResponse

  try {
    // Initialize Mixpanel credentials and Supabase client
    const credentials = initializeMixpanelCredentials()
    const supabase = initializeSupabaseClient()

    console.log('Starting creator retention sync...')

    // Check if sync should be skipped (within 1-hour window)
    const skipResponse = await checkAndHandleSkipSync(supabase, 'creator_retention', 1)
    if (skipResponse) {
      // Return skip response - frontend will query DB directly
      return skipResponse
    }

    // Create sync log entry
    const syncStartTime = new Date()
    const { data: syncLog, error: syncLogError } = await supabase
      .from('sync_logs')
      .insert({
        tool_type: 'creator',
        sync_started_at: syncStartTime.toISOString(),
        sync_status: 'in_progress',
        source: 'creator_retention',
        triggered_by: 'manual',
      })
      .select()
      .single()

    if (syncLogError) {
      console.error('Failed to create sync log:', syncLogError)
      throw syncLogError
    }

    const syncLogId = syncLog.id

    try {
      // Fetch retention data from TWO Mixpanel Insights Charts
      console.log(`Fetching subscribed data from Mixpanel Chart ${SUBSCRIBED_CHART_ID}...`)
      const subscribedChartData = await fetchInsightsData(
        credentials,
        SUBSCRIBED_CHART_ID,
        'Total Subscriptions (net refunds)'
      )

      console.log(`✅ Received subscribed chart data`)

      console.log(`Fetching renewal data from Mixpanel Chart ${RENEWED_CHART_ID}...`)
      const renewedChartData = await fetchInsightsData(
        credentials,
        RENEWED_CHART_ID,
        'Renewed Subscription'
      )

      console.log('✅ Received renewal chart data')

      // Process and store data
      const processedEvents = processRetentionChartData(subscribedChartData, renewedChartData)
      console.log(`Processed ${processedEvents.length} retention event records`)

      // Store in database (upsert)
      if (processedEvents.length > 0) {
        const { error: upsertError } = await supabase
          .from('premium_creator_retention_events')
          .upsert(processedEvents, {
            onConflict: 'user_id,creator_username,cohort_month',
            ignoreDuplicates: false
          })

        if (upsertError) {
          console.error('Error upserting retention events:', upsertError)
          throw upsertError
        }

        console.log(`✅ Stored ${processedEvents.length} retention events`)
      }

      // Refresh the materialized view
      console.log('Refreshing premium_creator_retention_analysis materialized view...')
      const { error: refreshError } = await supabase.rpc('refresh_premium_creator_retention_analysis')

      if (refreshError) {
        console.error('Failed to refresh retention view:', refreshError)
        // Don't throw - sync was successful, just view refresh failed
        console.warn('⚠️ Retention data synced but view refresh failed')
      } else {
        console.log('✅ Retention view refreshed')
      }

      // Update sync log with success
      const syncEndTime = new Date()
      await supabase
        .from('sync_logs')
        .update({
          sync_completed_at: syncEndTime.toISOString(),
          sync_status: 'completed',
          total_records_inserted: processedEvents.length
        })
        .eq('id', syncLogId)

      // Return success without querying data - frontend will query DB directly
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Creator retention data synced and stored successfully',
          stats: {
            eventsProcessed: processedEvents.length
          }
        }),
        {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          status: 200
        }
      )
    } catch (error) {
      // Update sync log with failure
      await supabase
        .from('sync_logs')
        .update({
          sync_completed_at: new Date().toISOString(),
          sync_status: 'failed',
          error_message: error.message,
          error_details: { stack: error.stack }
        })
        .eq('id', syncLogId)

      throw error
    }
  } catch (error) {
    console.error('Error in fetch-creator-retention function:', error)

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }),
      {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        status: 500
      }
    )
  }
})

/**
 * Process TWO Mixpanel Insights Charts into retention event records
 *
 * Input:
 * - subscribedChartData: Chart 85857452 with series["Total Subscriptions (net refunds)"] - uses $user_id
 * - renewedChartData: Chart 86188712 with series["Renewed Subscription"] - uses $user_id
 *
 * Structure: series[metric][$user_id][creatorUsername]["Month Year"] = { all: count }
 * Note: Charts return $user_id, which maps to user_id column in DB
 */
function processRetentionChartData(subscribedChartData: any, renewedChartData: any): any[] {
  const events: any[] = []
  const eventMap = new Map<string, any>()

  // Validate subscribed data
  if (!subscribedChartData.series) {
    console.warn('No series data in subscribed chart response')
    return []
  }

  // Validate renewed data
  if (!renewedChartData.series) {
    console.warn('No series data in renewed chart response')
    return []
  }

  // Extract the actual metric data from each chart
  const subscribedData = subscribedChartData.series['Total Subscriptions (net refunds)'] || {}
  const renewedData = renewedChartData.series['Renewed Subscription'] || {}

  console.log(`Subscribed data has ${Object.keys(subscribedData).length} user_ids`)
  console.log(`Renewed data has ${Object.keys(renewedData).length} user_ids`)

  // Process subscribed events
  processMetric(subscribedData, eventMap, 'subscribed')

  // Process renewed events
  processMetric(renewedData, eventMap, 'renewed')

  // Convert map to array
  eventMap.forEach((value) => {
    events.push(value)
  })

  console.log(`Processed ${events.length} events from ${eventMap.size} unique combinations`)
  if (events.length > 0) {
    console.log(`Sample event:`, JSON.stringify(events[0]))
  }

  return events
}

function processMetric(metricData: any, eventMap: Map<string, any>, metricType: 'subscribed' | 'renewed') {
  let totalProcessed = 0
  let skippedZero = 0
  let skippedOverall = 0

  for (const [userId, userIdData] of Object.entries(metricData)) {
    if (userId === '$overall') {
      skippedOverall++
      continue
    }

    // userId is the $user_id from Mixpanel
    if (!userId) continue

    if (typeof userIdData !== 'object') continue

    for (const [creatorUsername, creatorData] of Object.entries(userIdData as Record<string, any>)) {
      if (creatorUsername === '$overall') {
        skippedOverall++
        continue
      }
      if (typeof creatorData !== 'object') continue

      for (const [cohortMonth, monthData] of Object.entries(creatorData as Record<string, any>)) {
        if (cohortMonth === '$overall') {
          skippedOverall++
          continue
        }
        if (typeof monthData !== 'object') continue

        const count = (monthData as any).all || 0
        if (count === 0) {
          skippedZero++
          continue
        }

        // Create unique key
        const key = `${userId}|${creatorUsername}|${cohortMonth}`
        const cohortDate = parseCohortMonth(cohortMonth)

        if (!eventMap.has(key)) {
          eventMap.set(key, {
            user_id: userId,  // Mixpanel $user_id
            creator_username: creatorUsername,
            cohort_month: cohortMonth,
            cohort_date: cohortDate,  // Already parsed and validated
            subscribed_count: 0,
            renewed_count: 0
          })
        }

        const event = eventMap.get(key)
        if (metricType === 'subscribed') {
          event.subscribed_count += count
        } else {
          event.renewed_count += count
        }
        totalProcessed++
      }
    }
  }

  console.log(`  ${metricType}: processed ${totalProcessed} records, skipped ${skippedZero} zero-count, ${skippedOverall} $overall`)
}

/**
 * Parse cohort month string to date
 * Input: "Aug 2025", "Sep 2025"
 * Output: "2025-08-01", "2025-09-01"
 */
function parseCohortMonth(cohortMonth: string): string {
  const monthMap: Record<string, string> = {
    'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
    'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
    'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
  }

  const parts = cohortMonth.split(' ')
  if (parts.length !== 2) return cohortMonth

  const month = monthMap[parts[0]]
  const year = parts[1]

  return month && year ? `${year}-${month}-01` : cohortMonth
}

// queryRetentionData function removed - frontend now queries DB directly
