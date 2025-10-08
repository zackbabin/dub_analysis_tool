// Supabase Edge Function: analyze-subscription-price
// Fetches subscription pricing data from Mixpanel and stores in Supabase database
// Analyzes price distribution across different subscription intervals

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Configuration
const PROJECT_ID = '2599235'
const MIXPANEL_API_BASE = 'https://mixpanel.com/api'
const SUBSCRIPTION_PRICING_CHART_ID = '85154450'

interface MixpanelCredentials {
  username: string
  secret: string
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

    console.log('Starting subscription price analysis...')

    const syncStartTime = new Date()
    const credentials: MixpanelCredentials = {
      username: mixpanelUsername,
      secret: mixpanelSecret,
    }

    // Create sync log entry
    const { data: syncLog, error: syncLogError } = await supabase
      .from('sync_logs')
      .insert({
        tool_type: 'subscription_price',
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
      // Fetch subscription pricing data from Mixpanel
      console.log('Fetching subscription pricing data from Mixpanel...')
      const subscriptionPricingData = await fetchInsightsData(
        credentials,
        SUBSCRIPTION_PRICING_CHART_ID,
        'Subscription Pricing'
      )

      console.log('Data fetched successfully')

      // Process and insert data
      const subscriptionRows = processSubscriptionPricingData(subscriptionPricingData)
      console.log(`Processed ${subscriptionRows.length} subscription pricing rows, inserting...`)

      // Debug: Log what we're about to insert
      if (subscriptionRows.length > 0) {
        console.log('Sample subscription row to be inserted:', subscriptionRows[0])
      } else {
        console.warn('⚠️ No subscription pricing rows to insert!')
      }

      let totalProcessed = 0

      if (subscriptionRows.length > 0) {
        const batchSize = 500

        for (let i = 0; i < subscriptionRows.length; i += batchSize) {
          const batch = subscriptionRows.slice(i, i + batchSize)

          if (batch.length > 0) {
            const { error: insertError } = await supabase
              .from('creator_subscriptions_by_price')
              .upsert(batch, {
                onConflict: 'subscription_price,subscription_interval,synced_at',
                ignoreDuplicates: false,
              })

            if (insertError) {
              console.error('Error upserting subscriptions batch:', insertError)
              throw insertError
            }

            totalProcessed += batch.length
            console.log(`Upserted subscriptions batch: ${totalProcessed}/${subscriptionRows.length} records`)
          }
        }
      }

      console.log('Subscription price analysis completed successfully')

      // Update sync log with success
      const syncEndTime = new Date()
      const durationSeconds = Math.round((syncEndTime.getTime() - syncStartTime.getTime()) / 1000)

      await supabase
        .from('sync_logs')
        .update({
          sync_completed_at: syncEndTime.toISOString(),
          sync_status: 'completed',
          total_records_inserted: totalProcessed,
          duration_seconds: durationSeconds,
        })
        .eq('id', syncLog.id)

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Subscription price analysis completed successfully',
          stats: {
            pricePointsProcessed: subscriptionRows.length,
            recordsInserted: totalProcessed,
          },
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      )
    } catch (error) {
      console.error('Error during subscription price analysis:', error)

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
    console.error('Error in subscription price analysis:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Unknown error occurred',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    )
  }
})

// ============================================================================
// Helper Functions - Data Fetching
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

function processSubscriptionPricingData(data: any): any[] {
  if (!data || !data.series) {
    console.log('No subscription pricing data')
    return []
  }

  const syncedAt = new Date().toISOString()

  console.log('Subscription pricing data structure:', {
    hasHeaders: !!data.headers,
    headers: data.headers,
    metricsCount: Object.keys(data.series || {}).length,
    seriesKeys: Object.keys(data.series || {}),
  })

  // Debug: Show sample of series structure
  if (data.series && data.series['A. Total Subscriptions']) {
    const sampleCreatorIds = Object.keys(data.series['A. Total Subscriptions']).slice(0, 3)
    console.log('Sample creator IDs from A. Total Subscriptions:', sampleCreatorIds)
  }

  // Build a map to aggregate metrics for each price+interval combination
  const dataMap = new Map<string, any>()

  // Process both Total Subscriptions and Total Paywall Views metrics
  const metrics = {
    'A. Total Subscriptions': 'total_subscriptions',
    'B. Total Paywall Views': 'total_paywall_views',
  }

  Object.entries(metrics).forEach(([metricName, fieldName]) => {
    const metric = data.series[metricName]
    if (!metric) {
      console.log(`No "${metricName}" metric found`)
      return
    }

    // Structure: creatorId -> username -> price -> interval -> count
    Object.keys(metric).forEach(creatorId => {
      if (creatorId === '$overall') return

      const creatorData = metric[creatorId]

      // Iterate through usernames
      Object.keys(creatorData).forEach(username => {
        if (username === '$overall') return

        const usernameData = creatorData[username]

        // Normalize username by removing @ prefix
        const normalizedUsername = username.startsWith('@') ? username.substring(1) : username

        // Iterate through price levels
        Object.keys(usernameData).forEach(price => {
          if (price === '$overall' || price === '$non_numeric_values') return

          const priceData = usernameData[price]

          // Iterate through interval levels
          Object.keys(priceData).forEach(interval => {
            if (interval === '$overall' || interval === 'undefined') return

            const intervalData = priceData[interval]
            const value = intervalData?.all || 0

            // Normalize interval: treat "Annual" and "Annually" the same
            const normalizedInterval = interval === 'Annual' ? 'Annually' : interval

            const key = `${price}|${normalizedInterval}`

            if (!dataMap.has(key)) {
              dataMap.set(key, {
                subscription_price: parseFloat(price),
                subscription_interval: normalizedInterval,
                total_subscriptions: 0,
                total_paywall_views: 0,
                creator_usernames: new Set<string>(),
                synced_at: syncedAt,
              })
            }

            const existing = dataMap.get(key)!
            existing[fieldName] = (existing[fieldName] || 0) + value

            // Add username if not undefined
            if (normalizedUsername && normalizedUsername !== 'undefined') {
              existing.creator_usernames.add(normalizedUsername)
            }
          })
        })
      })
    })
  })

  // Convert Set to Array for creator_usernames
  const rows = Array.from(dataMap.values()).map(row => ({
    ...row,
    creator_usernames: Array.from(row.creator_usernames),
  }))

  console.log(`Processed ${rows.length} subscription pricing rows`)

  // Debug: Show sample rows
  if (rows.length > 0) {
    console.log('Sample subscription pricing rows:', rows.slice(0, 3).map(r => ({
      price: r.subscription_price,
      interval: r.subscription_interval,
      totalSubs: r.total_subscriptions,
      totalViews: r.total_paywall_views,
      creatorCount: r.creator_usernames.length
    })))
  } else {
    console.warn('⚠️ No subscription pricing rows were processed!')
  }

  return rows
}
