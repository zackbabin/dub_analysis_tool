// Supabase Edge Function: sync-creator-data
// Fetches creator data from Mixpanel API and stores in Supabase database
// Triggered manually by user clicking "Sync Creator Data" button

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Configuration
const PROJECT_ID = '2599235'
const MIXPANEL_API_BASE = 'https://mixpanel.com/api'

// Mixpanel Chart IDs
const CHART_IDS = {
  creatorInsights: '85130412',      // Insights: All 11 metrics from Insights by Creators chart
}

interface MixpanelCredentials {
  username: string
  secret: string
}

interface CreatorSyncStats {
  creatorsFetched: number
  totalRecordsInserted: number
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Get Mixpanel credentials from Supabase secrets
    const mixpanelUsername = Deno.env.get('MIXPANEL_SERVICE_USERNAME')
    const mixpanelSecret = Deno.env.get('MIXPANEL_SERVICE_SECRET')

    if (!mixpanelUsername || !mixpanelSecret) {
      throw new Error('Mixpanel credentials not configured in Supabase secrets')
    }

    console.log('Mixpanel credentials loaded from secrets')

    // Initialize Supabase client with service role key
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    console.log('Starting Creator data sync...')

    const syncStartTime = new Date()
    const credentials: MixpanelCredentials = {
      username: mixpanelUsername,
      secret: mixpanelSecret,
    }

    // Create sync log entry
    const { data: syncLog, error: syncLogError } = await supabase
      .from('sync_logs')
      .insert({
        tool_type: 'creator',
        sync_started_at: syncStartTime.toISOString(),
        sync_status: 'in_progress',
        source: 'mixpanel',
        triggered_by: 'manual',
      })
      .select()
      .single()

    if (syncLogError) {
      console.error('Failed to create sync log:', syncLogError)
      throw syncLogError
    }

    console.log(`Created sync log with ID: ${syncLog.id}`)

    try {
      // Date range configured in Mixpanel chart settings
      console.log(`Fetching data from Mixpanel charts (date range configured in each chart)`)

      // Fetch creator insights data
      const creatorInsightsData = await fetchInsightsData(credentials, CHART_IDS.creatorInsights, 'Creator Insights')

      console.log('Creator insights data fetched successfully')

      // Process and insert data into database
      const stats: CreatorSyncStats = {
        creatorsFetched: 0,
        totalRecordsInserted: 0,
      }

      // Process creators insights
      const creatorRows = processCreatorInsightsData(creatorInsightsData)
      console.log(`Processed ${creatorRows.length} creator rows, inserting...`)

      if (creatorRows.length > 0) {
        const batchSize = 500
        let totalProcessed = 0

        for (let i = 0; i < creatorRows.length; i += batchSize) {
          const batch = creatorRows.slice(i, i + batchSize)

          if (batch.length > 0) {
            const { error: insertError } = await supabase
              .from('creators_insights')
              .upsert(batch, {
                onConflict: 'creator_id,synced_at',
                ignoreDuplicates: false,
              })

            if (insertError) {
              console.error('Error upserting creators batch:', insertError)
              throw insertError
            }

            totalProcessed += batch.length
            console.log(`Upserted batch: ${totalProcessed}/${creatorRows.length} records`)
          }
        }

        stats.creatorsFetched = totalProcessed
        stats.totalRecordsInserted += totalProcessed
      }

      // Refresh materialized view
      console.log('Refreshing creator_analysis materialized view...')
      const { error: refreshError } = await supabase.rpc('refresh_creator_analysis')
      if (refreshError) {
        console.error('Error refreshing materialized view:', refreshError)
        // Don't throw - this is not critical
      }

      console.log('Creator sync completed successfully')

      // Update sync log with success
      const syncEndTime = new Date()
      const durationSeconds = Math.round((syncEndTime.getTime() - syncStartTime.getTime()) / 1000)

      await supabase
        .from('sync_logs')
        .update({
          sync_completed_at: syncEndTime.toISOString(),
          sync_status: 'completed',
          subscribers_fetched: stats.creatorsFetched,
          total_records_inserted: stats.totalRecordsInserted,
          duration_seconds: durationSeconds,
        })
        .eq('id', syncLog.id)

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Creator data sync completed successfully',
          stats,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      )
    } catch (error) {
      console.error('Error during creator sync:', error)

      // Update sync log with failure
      await supabase
        .from('sync_logs')
        .update({
          sync_completed_at: new Date().toISOString(),
          sync_status: 'failed',
          error_message: error.message,
        })
        .eq('id', syncLog.id)

      throw error
    }
  } catch (error) {
    console.error('Error in sync-creator-data function:', error)

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    )
  }
})

// ============================================================================
// Helper Functions - Mixpanel API
// ============================================================================

async function fetchInsightsData(
  credentials: MixpanelCredentials,
  chartId: string,
  name: string
) {
  console.log(`Fetching ${name} insights data (ID: ${chartId})...`)

  const params = new URLSearchParams({
    project_id: PROJECT_ID,
    bookmark_id: chartId,
    limit: '50000',
  })

  const authString = `${credentials.username}:${credentials.secret}`
  const authHeader = `Basic ${btoa(authString)}`

  const response = await fetch(`${MIXPANEL_API_BASE}/query/insights?${params}`, {
    method: 'GET',
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Mixpanel API error (${response.status}): ${errorText}`)
  }

  const data = await response.json()
  console.log(`✓ ${name} fetch successful`)
  return data
}

// ============================================================================
// Helper Functions - Data Processing
// ============================================================================

function processCreatorInsightsData(data: any): any[] {
  if (!data) {
    console.log('No creator insights data')
    return []
  }

  const rows: any[] = []

  console.log('Creator insights data structure:', {
    hasHeaders: !!data.headers,
    headers: data.headers,
    metricsCount: Object.keys(data.series || {}).length,
  })

  if (!data.series) {
    console.log('No series data found')
    return []
  }

  // Structure based on actual Mixpanel response:
  // series: {
  //   "A. Total Profile Views": {
  //     "creatorId": {
  //       "$overall": { all: count },
  //       "@username": {
  //         "$overall": { all: count },
  //         "Regular": { all: count },
  //         "Premium": { all: count }
  //       }
  //     }
  //   }
  // }

  const metrics = Object.keys(data.series)
  console.log(`Processing ${metrics.length} metrics`)

  // First pass: collect all creatorTypes per creator to determine final type
  const creatorTypesMap = new Map<string, Set<string>>()
  const creatorUsernameMap = new Map<string, string>()

  // Second pass: aggregate metrics per creator
  const creatorDataMap = new Map<string, any>()

  metrics.forEach(metricName => {
    const metricData = data.series[metricName]

    Object.keys(metricData).forEach(creatorId => {
      if (creatorId === '$overall') return

      const creatorMetrics = metricData[creatorId]

      // Navigate through nested structure
      Object.keys(creatorMetrics).forEach(key => {
        if (key.startsWith('@')) {
          // This is the username level
          const username = key
          const usernameData = creatorMetrics[key]

          // Store username
          if (!creatorUsernameMap.has(creatorId)) {
            creatorUsernameMap.set(creatorId, username)
          }

          // Look for creatorType keys (anything that's not "$overall")
          Object.keys(usernameData).forEach(typeKey => {
            if (typeKey !== '$overall' && typeKey !== 'all') {
              // This is a creatorType (Regular, Premium, Copier, etc.)
              if (!creatorTypesMap.has(creatorId)) {
                creatorTypesMap.set(creatorId, new Set())
              }
              creatorTypesMap.get(creatorId)!.add(typeKey)

              const count = usernameData[typeKey]?.all || 0

              // Initialize creator data if needed
              if (!creatorDataMap.has(creatorId)) {
                creatorDataMap.set(creatorId, {
                  creator_id: creatorId,
                  creator_username: username,
                  total_profile_views: 0,
                  total_pdp_views: 0,
                  total_paywall_views: 0,
                  total_stripe_views: 0,
                  total_subscriptions: 0,
                  total_subscription_revenue: 0,
                  total_cancelled_subscriptions: 0,
                  total_expired_subscriptions: 0,
                  total_copies: 0,
                  total_investment_count: 0,
                  total_investments: 0,
                })
              }

              const creatorData = creatorDataMap.get(creatorId)

              // Aggregate all 11 metrics from Insights by Creators
              if (metricName === 'A. Total Profile Views') {
                creatorData.total_profile_views += count
              } else if (metricName === 'B. Total PDP Views') {
                creatorData.total_pdp_views += count
              } else if (metricName === 'C. Total Paywall Views') {
                creatorData.total_paywall_views += count
              } else if (metricName === 'D. Total Stripe Views') {
                creatorData.total_stripe_views += count
              } else if (metricName === 'E. Total Subscriptions') {
                creatorData.total_subscriptions += count
              } else if (metricName === 'F. Total Subscription Revenue') {
                creatorData.total_subscription_revenue += count
              } else if (metricName === 'G. Total Cancelled Subscriptions') {
                creatorData.total_cancelled_subscriptions += count
              } else if (metricName === 'H. Total Expired Subscriptions') {
                creatorData.total_expired_subscriptions += count
              } else if (metricName === 'I. Total Copies') {
                creatorData.total_copies += count
              } else if (metricName === 'J. Total Investment Count') {
                creatorData.total_investment_count += count
              } else if (metricName === 'K. Total Investments ($)') {
                creatorData.total_investments += count
              }
            }
          })
        }
      })
    })
  })

  // Determine final creatorType: Premium if they have any Premium, otherwise Regular
  creatorDataMap.forEach((creatorData, creatorId) => {
    const types = creatorTypesMap.get(creatorId)
    let finalType = 'Regular'

    if (types) {
      if (types.has('Premium')) {
        finalType = 'Premium'
      } else if (types.has('Regular')) {
        finalType = 'Regular'
      } else if (types.has('Copier')) {
        finalType = 'Regular' // Treat Copier as Regular
      }
    }

    rows.push({
      creator_id: String(creatorData.creator_id),
      creator_username: creatorData.creator_username,
      creator_type: finalType,
      total_profile_views: creatorData.total_profile_views || 0,
      total_pdp_views: creatorData.total_pdp_views || 0,
      total_paywall_views: creatorData.total_paywall_views || 0,
      total_stripe_views: creatorData.total_stripe_views || 0,
      total_subscriptions: creatorData.total_subscriptions || 0,
      total_subscription_revenue: creatorData.total_subscription_revenue || 0,
      total_cancelled_subscriptions: creatorData.total_cancelled_subscriptions || 0,
      total_expired_subscriptions: creatorData.total_expired_subscriptions || 0,
      total_copies: creatorData.total_copies || 0,
      total_investment_count: creatorData.total_investment_count || 0,
      total_investments: creatorData.total_investments || 0,
    })
  })

  console.log(`Processed ${rows.length} creator insights rows`)
  return rows
}


