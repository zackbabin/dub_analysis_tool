// Supabase Edge Function: analyze-subscription-price
// Fetches subscription pricing data from Mixpanel and stores in Supabase database
// Analyzes price distribution across different subscription intervals

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { fetchInsightsData, CORS_HEADERS, type MixpanelCredentials } from '../_shared/mixpanel-api.ts'

// Configuration
const SUBSCRIPTION_PRICING_CHART_ID = '85154450'

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
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
        tool_type: 'user',
        sync_started_at: syncStartTime.toISOString(),
        sync_status: 'in_progress',
        source: 'mixpanel_subscription_price',
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
                onConflict: 'creator_id,subscription_price,subscription_interval',
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
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
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
    console.error('Error stack:', error.stack)
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Unknown error occurred',
        details: error.stack || 'No stack trace available',
      }),
      {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        status: 500,
      }
    )
  }
})

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

  // Build a map for each creator (one row per creator, not aggregated by price)
  const creatorDataMap = new Map<string, any>()

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
      if (creatorId === '$overall' || creatorId === 'undefined') return

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

            if (value === 0) return // Skip if no data

            // Normalize interval: treat "Annual" and "Annually" the same
            const normalizedInterval = interval === 'Annual' ? 'Annually' : interval

            // Create unique key matching database constraint: creator_id, price, interval, synced_at
            // Note: We use syncedAt (not username) because that's the DB constraint
            const key = `${creatorId}|${price}|${normalizedInterval}|${syncedAt}`

            if (!creatorDataMap.has(key)) {
              creatorDataMap.set(key, {
                creator_id: creatorId,
                creator_username: normalizedUsername,
                subscription_price: Math.round(parseFloat(price) * 100) / 100, // Round to 2 decimals
                subscription_interval: normalizedInterval,
                total_subscriptions: 0,
                total_paywall_views: 0,
                synced_at: syncedAt,
              })
            }

            const existing = creatorDataMap.get(key)!
            existing[fieldName] = (existing[fieldName] || 0) + value
          })
        })
      })
    })
  })

  // Filter out any rows with undefined creator_id (safety check)
  const validRows = Array.from(creatorDataMap.values()).filter(row =>
    row.creator_id && row.creator_id !== 'undefined' && row.creator_id !== 'null'
  )

  console.log(`Processed ${validRows.length} creator subscription pricing rows (filtered out ${creatorDataMap.size - validRows.length} invalid rows)`)

  // Check for duplicates in the batch itself
  const uniqueKeys = new Set<string>()
  const duplicates: string[] = []

  validRows.forEach(row => {
    const key = `${row.creator_id}|${row.subscription_price}|${row.subscription_interval}|${row.synced_at}`
    if (uniqueKeys.has(key)) {
      duplicates.push(key)
    }
    uniqueKeys.add(key)
  })

  if (duplicates.length > 0) {
    console.warn(`⚠️ Found ${duplicates.length} duplicate keys in batch!`)
    console.warn('Sample duplicates:', duplicates.slice(0, 5))
  }

  const rows = validRows

  // Debug: Show sample rows
  if (rows.length > 0) {
    console.log('Sample creator subscription pricing rows:', rows.slice(0, 3).map(r => ({
      creatorId: r.creator_id,
      username: r.creator_username,
      price: r.subscription_price,
      interval: r.subscription_interval,
      totalSubs: r.total_subscriptions,
      totalViews: r.total_paywall_views,
    })))
  } else {
    console.warn('⚠️ No subscription pricing rows were processed!')
  }

  return rows
}
