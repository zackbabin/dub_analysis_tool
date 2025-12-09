// Supabase Edge Function: fetch-creator-retention
// Fetches creator subscription retention data from TWO Mixpanel Insights Charts:
//   - Chart 85857452: Subscription cohorts (first subscription date per user+creator)
//   - Chart 86188712: Renewal events (renewal occurrence dates)
// Calculates which renewal month (1-12) each renewal occurred relative to cohort
// Stores one row per user+creator with cohort and boolean flags for each renewal month

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
            onConflict: 'user_id,creator_username',
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
 * Chart 85857452 provides COHORTS (first subscription date per user+creator)
 * Chart 86188712 provides RENEWALS (renewal event dates)
 * We calculate which renewal month (1, 2, 3...) based on time since cohort
 *
 * Input:
 * - subscribedChartData: Chart 85857452 - structure: series[metric][$user_id][creatorUsername]["Month Year"] = { all: count }
 *   - Time dimension: first subscription date (COHORT)
 * - renewedChartData: Chart 86188712 - structure: series[metric][$user_id][creatorUsername]["Month Year"] = { all: count }
 *   - Time dimension: renewal event date
 *
 * Output: Array of records with one row per user+creator with their cohort and renewal flags
 */
function processRetentionChartData(subscribedChartData: any, renewedChartData: any): any[] {
  // Validate data
  if (!subscribedChartData.series) {
    console.warn('No series data in subscribed chart response')
    return []
  }
  if (!renewedChartData.series) {
    console.warn('No series data in renewed chart response')
    return []
  }

  // Extract the actual metric data from each chart
  const subscribedData = subscribedChartData.series['Total Subscriptions (net refunds)'] || {}
  const renewedData = renewedChartData.series['Renewed Subscription'] || {}

  console.log(`Subscribed data has ${Object.keys(subscribedData).length} user_ids`)
  console.log(`Renewed data has ${Object.keys(renewedData).length} user_ids`)

  // STEP 1: Build cohort map from subscribed chart
  // Key: `${userId}|${creatorUsername}`, Value: { cohortMonth, cohortDate }
  const cohortMap = new Map<string, { cohortMonth: string; cohortDate: Date }>()

  console.log('Step 1: Building cohort map from subscription data...')
  let subscribedCount = 0

  for (const [userId, userIdData] of Object.entries(subscribedData)) {
    if (userId === '$overall' || !userId || typeof userIdData !== 'object') continue

    for (const [creatorUsername, creatorData] of Object.entries(userIdData as Record<string, any>)) {
      if (creatorUsername === '$overall' || typeof creatorData !== 'object') continue

      for (const [cohortMonth, monthData] of Object.entries(creatorData as Record<string, any>)) {
        if (cohortMonth === '$overall' || typeof monthData !== 'object') continue

        const count = (monthData as any).all || 0
        if (count === 0) continue

        const key = `${userId}|${creatorUsername}`
        const cohortDate = parseCohortMonthToDate(cohortMonth)

        // Store the cohort (first subscription date)
        if (!cohortMap.has(key)) {
          cohortMap.set(key, { cohortMonth, cohortDate })
          subscribedCount++
        } else {
          // If multiple subscription records exist, use the earliest
          const existing = cohortMap.get(key)!
          if (cohortDate < existing.cohortDate) {
            cohortMap.set(key, { cohortMonth, cohortDate })
          }
        }
      }
    }
  }

  console.log(`  Found ${subscribedCount} unique user+creator subscriptions`)

  // STEP 2: Process renewals and calculate month number from cohort
  console.log('Step 2: Processing renewal data and calculating renewal months...')

  // Build event records: Map<userId|creatorUsername, eventRecord>
  const eventMap = new Map<string, any>()

  // Initialize all cohorts with subscribed=true
  for (const [key, cohort] of cohortMap.entries()) {
    const [userId, creatorUsername] = key.split('|')
    eventMap.set(key, {
      user_id: userId,
      creator_username: creatorUsername,
      cohort_month: cohort.cohortMonth,
      cohort_date: formatDateForDB(cohort.cohortDate),
      subscribed: true,
      month_1_renewed: false,
      month_2_renewed: false,
      month_3_renewed: false,
      month_4_renewed: false,
      month_5_renewed: false,
      month_6_renewed: false,
      month_7_renewed: false,
      month_8_renewed: false,
      month_9_renewed: false,
      month_10_renewed: false,
      month_11_renewed: false,
      month_12_renewed: false,
    })
  }

  let renewalsProcessed = 0
  let renewalsOutOfRange = 0
  let renewalsNoCohort = 0

  // Process renewals
  for (const [userId, userIdData] of Object.entries(renewedData)) {
    if (userId === '$overall' || !userId || typeof userIdData !== 'object') continue

    for (const [creatorUsername, creatorData] of Object.entries(userIdData as Record<string, any>)) {
      if (creatorUsername === '$overall' || typeof creatorData !== 'object') continue

      const key = `${userId}|${creatorUsername}`
      const cohort = cohortMap.get(key)

      if (!cohort) {
        // User has renewals but no subscription cohort - skip
        renewalsNoCohort++
        continue
      }

      const event = eventMap.get(key)!

      for (const [renewalMonth, monthData] of Object.entries(creatorData as Record<string, any>)) {
        if (renewalMonth === '$overall' || typeof monthData !== 'object') continue

        const count = (monthData as any).all || 0
        if (count === 0) continue

        const renewalDate = parseCohortMonthToDate(renewalMonth)

        // Calculate month number: how many months after cohort
        const monthNumber = calculateMonthsBetween(cohort.cohortDate, renewalDate)

        if (monthNumber >= 1 && monthNumber <= 12) {
          // Set the appropriate month flag
          const monthKey = `month_${monthNumber}_renewed` as keyof typeof event
          event[monthKey] = true
          renewalsProcessed++
        } else if (monthNumber > 12) {
          renewalsOutOfRange++
        }
        // monthNumber < 1 means renewal before subscription (shouldn't happen, ignore)
      }
    }
  }

  console.log(`  Processed ${renewalsProcessed} renewals (${renewalsOutOfRange} beyond month 12, ${renewalsNoCohort} without cohort)`)

  // Convert map to array
  const events = Array.from(eventMap.values())

  console.log(`Final: ${events.length} retention records`)
  if (events.length > 0) {
    console.log(`Sample event:`, JSON.stringify(events[0]))
  }

  return events
}

/**
 * Parse cohort month string to Date object
 * Input: "Nov 2025", "Dec 2025"
 * Output: Date object (2025-11-01, 2025-12-01)
 */
function parseCohortMonthToDate(cohortMonth: string): Date {
  const monthMap: Record<string, number> = {
    'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3,
    'May': 4, 'Jun': 5, 'Jul': 6, 'Aug': 7,
    'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
  }

  const parts = cohortMonth.split(' ')
  if (parts.length !== 2) {
    console.warn(`Invalid cohort month format: ${cohortMonth}`)
    return new Date()
  }

  const month = monthMap[parts[0]]
  const year = parseInt(parts[1])

  if (month === undefined || isNaN(year)) {
    console.warn(`Could not parse cohort month: ${cohortMonth}`)
    return new Date()
  }

  return new Date(year, month, 1)
}

/**
 * Format Date object for database storage
 * Input: Date object
 * Output: "YYYY-MM-DD"
 */
function formatDateForDB(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Calculate the number of months between two dates
 * Returns: positive integer representing months after cohortDate
 */
function calculateMonthsBetween(cohortDate: Date, renewalDate: Date): number {
  const yearDiff = renewalDate.getFullYear() - cohortDate.getFullYear()
  const monthDiff = renewalDate.getMonth() - cohortDate.getMonth()
  return yearDiff * 12 + monthDiff
}

// queryRetentionData function removed - frontend now queries DB directly
