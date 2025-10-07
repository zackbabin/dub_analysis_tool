// Supabase Edge Function: sync-mixpanel-users
// Fetches user/subscriber data from Mixpanel API and stores in Supabase database
// Part 1 of 4: Handles only subscribers_insights table (isolated due to large dataset)
// Triggered manually by user clicking "Sync Live Data" button

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Configuration
const PROJECT_ID = '2599235'
const MIXPANEL_API_BASE = 'https://mixpanel.com/api'

const CHART_IDS = {
  subscribersInsights: '84933160',
}

interface MixpanelCredentials {
  username: string
  secret: string
}

interface SyncStats {
  subscribersFetched: number
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

    console.log('Starting Mixpanel sync...')

    // Create sync log entry
    const syncStartTime = new Date()
    const { data: syncLog, error: syncLogError } = await supabase
      .from('sync_logs')
      .insert({
        tool_type: 'user',
        sync_started_at: syncStartTime.toISOString(),
        sync_status: 'in_progress',
        source: 'mixpanel_users',
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
      // Date range configured in Mixpanel chart settings
      console.log(`Fetching data from Mixpanel chart (date range configured in chart)`)
      console.log(`Mixpanel username: ${mixpanelUsername?.substring(0, 10)}...`)

      const credentials: MixpanelCredentials = {
        username: mixpanelUsername,
        secret: mixpanelSecret,
      }

      // Fetch subscribers data only
      console.log('Fetching Subscribers Insights data...')

      const subscribersData = await fetchInsightsData(
        credentials,
        CHART_IDS.subscribersInsights,
        'Subscribers Insights'
      )

      console.log('✓ Subscribers data fetched successfully')

      // Process and insert data into database
      const stats: SyncStats = {
        subscribersFetched: 0,
        totalRecordsInserted: 0,
      }

      // Process subscribers insights in batches to avoid memory issues
      const batchSize = 500
      let totalProcessed = 0

      const allSubscribersRows = processInsightsData(subscribersData)
      console.log(`Processed ${allSubscribersRows.length} subscriber rows, inserting in batches...`)

      for (let i = 0; i < allSubscribersRows.length; i += batchSize) {
        const batch = allSubscribersRows.slice(i, i + batchSize)

        if (batch.length > 0) {
          const { error: insertError } = await supabase
            .from('subscribers_insights')
            .upsert(batch, {
              onConflict: 'distinct_id',
              ignoreDuplicates: false
            })

          if (insertError) {
            console.error('Error upserting subscribers batch:', insertError)
            throw insertError
          }

          totalProcessed += batch.length
          console.log(`Upserted batch: ${totalProcessed}/${allSubscribersRows.length} records`)
        }
      }

      stats.subscribersFetched = totalProcessed
      stats.totalRecordsInserted += totalProcessed

      // Update sync log with success
      const syncEndTime = new Date()
      await supabase
        .from('sync_logs')
        .update({
          sync_completed_at: syncEndTime.toISOString(),
          sync_status: 'completed',
          subscribers_fetched: stats.subscribersFetched,
          total_records_inserted: stats.totalRecordsInserted,
        })
        .eq('id', syncLogId)

      console.log('Users sync completed successfully')

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Mixpanel sync completed successfully',
          stats,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
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
          error_details: { stack: error.stack },
        })
        .eq('id', syncLogId)

      throw error
    }
  } catch (error) {
    console.error('Error in sync-mixpanel function:', error)

    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message || 'Unknown error occurred',
        details: error?.stack || String(error)
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
  name: string,
  retries = 2
) {
  console.log(`Fetching ${name} insights data (ID: ${chartId})...`)

  const params = new URLSearchParams({
    project_id: PROJECT_ID,
    bookmark_id: chartId,
    limit: '50000',
  })

  const authString = `${credentials.username}:${credentials.secret}`
  const authHeader = `Basic ${btoa(authString)}`

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(`${MIXPANEL_API_BASE}/query/insights?${params}`, {
        method: 'GET',
        headers: {
          Authorization: authHeader,
          Accept: 'application/json',
        },
      })

      if (!response.ok) {
        const errorText = await response.text()

        // Retry on 502/503/504 errors (server issues)
        if ((response.status === 502 || response.status === 503 || response.status === 504) && attempt < retries) {
          console.warn(`⚠️ ${name} returned ${response.status}, retrying (attempt ${attempt + 1}/${retries})...`)
          await new Promise(resolve => setTimeout(resolve, 2000)) // Wait 2s before retry
          continue
        }

        throw new Error(`Mixpanel API error (${response.status}): ${errorText}`)
      }

      const data = await response.json()
      console.log(`✓ ${name} fetch successful`)
      return data
    } catch (error) {
      if (attempt < retries) {
        console.warn(`⚠️ ${name} fetch failed, retrying (attempt ${attempt + 1}/${retries})...`)
        await new Promise(resolve => setTimeout(resolve, 2000))
        continue
      }
      throw error
    }
  }
}

// ============================================================================
// Helper Functions - Data Processing
// ============================================================================

function processInsightsData(data: any): any[] {
  if (!data) {
    console.log('No insights data')
    return []
  }

  const rows: any[] = []

  // Check if we have headers
  if (!data.headers) {
    console.log('No headers found in Insights data')
    return []
  }

  console.log('Insights data structure:', {
    hasHeaders: !!data.headers,
    headersCount: data.headers?.length,
    seriesType: Array.isArray(data.series) ? 'array' : typeof data.series,
  })

  // Handle Query API nested object format (PRIORITY CHECK - This is what Mixpanel returns!)
  if (data.headers && data.series && typeof data.series === 'object' && !Array.isArray(data.series)) {
    console.log('Processing Query API nested object format for user profiles')
    console.log(`Headers (${data.headers.length})`)
    console.log(`Series metrics (${Object.keys(data.series).length})`)

    const userDataMap = new Map()
    const propertyHeaders = data.headers.slice(2)
    const metricNames = Object.keys(data.series)

    function extractUserDataRecursive(obj: any, pathValues: string[], currentUserId: string | null, currentMetric: string | null, depth: number) {
      if (depth > 30 || !obj || typeof obj !== 'object') return

      for (const [key, value] of Object.entries(obj)) {
        if (key === '$overall') {
          if (typeof value === 'object') {
            extractUserDataRecursive(value, pathValues, currentUserId, currentMetric, depth + 1)
          }
          continue
        }

        if (key === 'all' && typeof value === 'number' && currentUserId && currentMetric) {
          const userData = userDataMap.get(currentUserId)
          if (userData) {
            userData[currentMetric] = value
          }
          continue
        }

        const isUserId = !currentUserId && key !== '$overall' && key !== 'all'

        if (isUserId) {
          if (!userDataMap.has(key)) {
            userDataMap.set(key, { '$distinct_id': key })
          }

          if (typeof value === 'object') {
            extractUserDataRecursive(value, pathValues, key, currentMetric, depth + 1)
          } else if (typeof value === 'number' && currentMetric) {
            const userData = userDataMap.get(key)
            if (userData) userData[currentMetric] = value
          }
        } else if (currentUserId) {
          // We're inside a user's data - collect property values
          // Handle $non_numeric_values as null/0
          const actualKey = key === '$non_numeric_values' ? null : key
          const newPath = actualKey !== null ? [...pathValues, actualKey] : pathValues

          // Map path values to property headers (dimensions)
          const userData = userDataMap.get(currentUserId)
          if (userData && actualKey !== null) {
            newPath.forEach((val, idx) => {
              if (idx < propertyHeaders.length) {
                const propName = propertyHeaders[idx]
                if (propName && !userData[propName]) {
                  userData[propName] = val
                }
              }
            })
          }

          // Continue recursing
          if (typeof value === 'object') {
            extractUserDataRecursive(value, newPath, currentUserId, currentMetric, depth + 1)
          }
        } else {
          if (typeof value === 'object') {
            extractUserDataRecursive(value, pathValues, currentUserId, currentMetric, depth + 1)
          }
        }
      }
    }

    console.log(`Processing ${metricNames.length} metrics...`)
    metricNames.forEach((metricName, idx) => {
      if (idx < 3) console.log(`  Processing metric: ${metricName}`)
      extractUserDataRecursive(data.series[metricName], [], null, metricName, 0)
    })

    console.log(`Extracted ${userDataMap.size} user profiles from nested structure`)

    const allColumns = new Set(['$distinct_id'])
    propertyHeaders.forEach((h: string) => allColumns.add(h))
    metricNames.forEach((m: string) => allColumns.add(m))

    userDataMap.forEach((userData) => {
      metricNames.forEach(metricName => {
        if (!(metricName in userData)) {
          userData[metricName] = undefined
        }
      })
      rows.push(userData)
    })
  }
  // Handle Query API tabular format (fallback)
  else if (Array.isArray(data.headers) && Array.isArray(data.series)) {
    console.log('Processing Query API tabular format')
    console.log(`Processing ${data.series.length} subscriber rows`)

    const distinctIdIndex = data.headers.indexOf('$distinct_id')
    if (distinctIdIndex === -1) {
      console.error('$distinct_id column not found in headers')
      return []
    }

    data.series.forEach((rowData: any[]) => {
      if (!Array.isArray(rowData)) return

      const row: any = {}
      data.headers.forEach((header: string, idx: number) => {
        if (idx < rowData.length) {
          row[header] = rowData[idx]
        }
      })

      rows.push(row)
    })
  }

  console.log(`Processed ${rows.length} insights rows, converting to DB format...`)

  // Convert to database format
  const now = new Date().toISOString()
  return rows.map(row => ({
    distinct_id: row['$distinct_id'] || row['distinct_id'],
    income: row['income'] || null,
    net_worth: row['netWorth'] || null,
    investing_activity: row['investingActivity'] || null,
    investing_experience_years: row['investingExperienceYears'] || null,
    investing_objective: row['investingObjective'] || null,
    investment_type: row['investmentType'] || null,
    acquisition_survey: row['acquisitionSurvey'] || null,
    linked_bank_account: row['A. Linked Bank Account'] === 1 || row['A. Linked Bank Account'] === '1',
    available_copy_credits: parseFloat(row['availableCopyCredits'] || 0),
    buying_power: parseFloat(row['buyingPower'] || 0),
    total_deposits: parseFloat(row['B. Total Deposits ($)'] || 0),
    total_deposit_count: parseInt(row['C. Total Deposit Count'] || 0),
    total_withdrawals: parseFloat(row['totalWithdrawals'] || 0),
    total_withdrawal_count: parseInt(row['totalWithdrawalCount'] || 0),
    active_created_portfolios: parseInt(row['activeCreatedPortfolios'] || 0),
    lifetime_created_portfolios: parseInt(row['lifetimeCreatedPortfolios'] || 0),
    total_copies: parseInt(row['E. Total Copies'] || 0),
    total_regular_copies: parseInt(row['F. Total Regular Copies'] || 0),
    total_premium_copies: parseInt(row['G. Total Premium Copies'] || 0),
    regular_pdp_views: parseInt(row['H. Regular PDP Views'] || 0),
    premium_pdp_views: parseInt(row['I. Premium PDP Views'] || 0),
    paywall_views: parseInt(row['J. Paywall Views'] || 0),
    regular_creator_profile_views: parseInt(row['K. Regular Creator Profile Views'] || 0),
    premium_creator_profile_views: parseInt(row['L. Premium Creator Profile Views'] || 0),
    stripe_modal_views: parseInt(row['R. Stripe Modal Views'] || 0),
    app_sessions: parseInt(row['N. App Sessions'] || 0),
    discover_tab_views: parseInt(row['O. Discover Tab Views'] || 0),
    leaderboard_tab_views: parseInt(row['P. Leaderboard Tab Views'] || 0),
    premium_tab_views: parseInt(row['Q. Premium Tab Views'] || 0),
    creator_card_taps: parseInt(row['S. Creator Card Taps'] || 0),
    portfolio_card_taps: parseInt(row['T. Portfolio Card Taps'] || 0),
    total_subscriptions: parseInt(row['M. Total Subscriptions'] || 0),
    subscribed_within_7_days: row['D. Subscribed within 7 days'] === 1 || row['D. Subscribed within 7 days'] === '1',
    updated_at: now,
  })).filter(row => row.distinct_id)
}
