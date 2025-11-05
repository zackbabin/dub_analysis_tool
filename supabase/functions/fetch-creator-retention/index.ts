// Supabase Edge Function: fetch-creator-retention
// Fetches creator subscription retention data from Mixpanel Insights Chart 85857452
// Stores subscription and renewal events by user, creator, and time cohort
// Calculates retention metrics by querying stored data

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4'
import { CORS_HEADERS, fetchInsightsData, type MixpanelCredentials, shouldSkipSync } from '../_shared/mixpanel-api.ts'

const RETENTION_CHART_ID = '85857452'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    const mixpanelUsername = Deno.env.get('MIXPANEL_SERVICE_USERNAME')
    const mixpanelSecret = Deno.env.get('MIXPANEL_SERVICE_SECRET')

    if (!mixpanelUsername || !mixpanelSecret) {
      throw new Error('Mixpanel credentials not configured in Supabase secrets')
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    console.log('Starting creator retention sync...')

    // Check if sync should be skipped (within 1-hour window)
    const { shouldSkip, lastSyncTime } = await shouldSkipSync(supabase, 'creator_retention', 1)

    if (shouldSkip) {
      console.log('⏭️ Skipping retention sync, using cached data')
      // Return data from database
      const retentionData = await queryRetentionData(supabase)
      return new Response(
        JSON.stringify({
          success: true,
          skipped: true,
          lastSyncTime: lastSyncTime?.toISOString(),
          rawData: retentionData
        }),
        {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          status: 200
        }
      )
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
      const credentials: MixpanelCredentials = {
        username: mixpanelUsername,
        secret: mixpanelSecret
      }

      // Fetch retention data from Mixpanel Insights Chart
      console.log(`Fetching retention data from Mixpanel Chart ${RETENTION_CHART_ID}...`)
      const chartData = await fetchInsightsData(
        credentials,
        RETENTION_CHART_ID,
        'Creator Retention Events'
      )

      console.log('✅ Received retention chart data')

      // Process and store data
      const processedEvents = processRetentionChartData(chartData)
      console.log(`Processed ${processedEvents.length} retention event records`)

      // Store in database (upsert)
      if (processedEvents.length > 0) {
        const { error: upsertError } = await supabase
          .from('premium_creator_retention_events')
          .upsert(processedEvents, {
            onConflict: 'distinct_id,creator_username,cohort_month',
            ignoreDuplicates: false
          })

        if (upsertError) {
          console.error('Error upserting retention events:', upsertError)
          throw upsertError
        }

        console.log(`✅ Stored ${processedEvents.length} retention events`)
      }

      // Refresh materialized view
      await supabase.rpc('refresh_materialized_view', {
        view_name: 'premium_creator_retention_analysis'
      })

      console.log('✅ Refreshed retention analysis view')

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

      // Query and return retention data
      const retentionData = await queryRetentionData(supabase)

      return new Response(
        JSON.stringify({
          success: true,
          rawData: retentionData,
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
 * Process Mixpanel Insights Chart data into retention event records
 *
 * Input: Mixpanel Chart 85857452 response with nested structure:
 * series["A. Subscribed to Creator"][$distinct_id][creatorUsername]["Month Year"] = { all: count }
 * series["B. Renewed Subscription"][$distinct_id][creatorUsername]["Month Year"] = { all: count }
 */
function processRetentionChartData(chartData: any): any[] {
  const events: any[] = []
  const eventMap = new Map<string, any>()

  if (!chartData.series) {
    console.warn('No series data in chart response')
    return []
  }

  // Process both metrics
  const subscribedData = chartData.series['A. Subscribed to Creator'] || {}
  const renewedData = chartData.series['B. Renewed Subscription'] || {}

  // Process subscribed events
  processMetric(subscribedData, eventMap, 'subscribed')

  // Process renewed events
  processMetric(renewedData, eventMap, 'renewed')

  // Convert map to array
  eventMap.forEach((value) => {
    events.push(value)
  })

  return events
}

function processMetric(metricData: any, eventMap: Map<string, any>, metricType: 'subscribed' | 'renewed') {
  for (const [distinctId, distinctIdData] of Object.entries(metricData)) {
    if (distinctId === '$overall' || typeof distinctIdData !== 'object') continue

    for (const [creatorUsername, creatorData] of Object.entries(distinctIdData as Record<string, any>)) {
      if (creatorUsername === '$overall' || typeof creatorData !== 'object') continue

      for (const [cohortMonth, monthData] of Object.entries(creatorData as Record<string, any>)) {
        if (cohortMonth === '$overall' || typeof monthData !== 'object') continue

        const count = (monthData as any).all || 0
        if (count === 0) continue

        // Create unique key
        const key = `${distinctId}|${creatorUsername}|${cohortMonth}`

        if (!eventMap.has(key)) {
          eventMap.set(key, {
            distinct_id: distinctId,
            creator_username: creatorUsername,
            cohort_month: cohortMonth,
            cohort_date: parseCohortMonth(cohortMonth),
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
      }
    }
  }
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

/**
 * Query retention data from materialized view
 * Returns data in format expected by frontend
 */
async function queryRetentionData(supabase: any): Promise<any> {
  const { data, error } = await supabase
    .from('premium_creator_retention_analysis')
    .select('*')
    .order('creator_username', { ascending: true })
    .order('cohort_date', { ascending: true })

  if (error) {
    console.error('Error querying retention data:', error)
    throw error
  }

  // Transform to expected format: { "cohort_date": { "username": { first, counts } } }
  const formattedData: any = {}

  data.forEach((row: any) => {
    const cohortDate = row.cohort_date
    if (!formattedData[cohortDate]) {
      formattedData[cohortDate] = {}
    }

    formattedData[cohortDate][row.creator_username] = {
      first: row.first,
      counts: row.counts
    }
  })

  return formattedData
}
