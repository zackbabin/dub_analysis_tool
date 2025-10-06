// Supabase Edge Function: sync-mixpanel
// Fetches data from Mixpanel API and stores in Supabase database
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
  timeToFirstCopy: '84999271',
  timeToFundedAccount: '84999267',
  timeToLinkedBank: '84999265',
  // User engagement analysis for subscriptions/copies
  profileViewsByCreator: '85165851',  // Total Profile Views
  pdpViewsByPortfolio: '85165580',     // Total PDP Views by creatorId, portfolioTicker, distinctId
  subscriptionsByCreator: '85165590',  // Total Subscriptions
  copiesByCreator: '85172578',  // Total Copies
}

interface MixpanelCredentials {
  username: string
  secret: string
}

interface SyncStats {
  subscribersFetched: number
  timeFunnelsFetched: number
  engagementRecordsFetched: number
  totalRecordsInserted: number
}

/**
 * Simple concurrency limiter (p-limit pattern)
 * Ensures max N promises run concurrently
 */
function pLimit(concurrency: number) {
  const queue: Array<() => void> = []
  let activeCount = 0

  const next = () => {
    activeCount--
    if (queue.length > 0) {
      const resolve = queue.shift()!
      resolve()
    }
  }

  const run = async <T>(fn: () => Promise<T>): Promise<T> => {
    return new Promise((resolve) => {
      const execute = () => {
        activeCount++
        fn().then(
          (result) => {
            next()
            resolve(result)
          },
          (error) => {
            next()
            throw error
          }
        )
      }

      if (activeCount < concurrency) {
        execute()
      } else {
        queue.push(execute)
      }
    })
  }

  return run
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
        source: 'mixpanel',
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
      // Date range (last 30 days)
      const today = new Date()
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(today.getDate() - 30)

      const toDate = today.toISOString().split('T')[0]
      const fromDate = thirtyDaysAgo.toISOString().split('T')[0]

      console.log(`Fetching data from ${fromDate} to ${toDate}`)

      const credentials: MixpanelCredentials = {
        username: mixpanelUsername,
        secret: mixpanelSecret,
      }

      // Fetch data with controlled concurrency to respect Mixpanel rate limits
      // Max 5 concurrent queries allowed by Mixpanel - we use 4 for safety
      console.log('Fetching all 8 charts with max 4 concurrent requests...')
      const CONCURRENCY_LIMIT = 4
      const limit = pLimit(CONCURRENCY_LIMIT)

      const [
        timeToFirstCopyData,
        timeToFundedData,
        timeToLinkedData,
        subscribersData,
        profileViewsData,
        pdpViewsData,
        subscriptionsData,
        copiesData,
      ] = await Promise.all([
        limit(() =>
          fetchFunnelData(
            credentials,
            CHART_IDS.timeToFirstCopy,
            'Time to First Copy',
            fromDate,
            toDate
          )
        ),
        limit(() =>
          fetchFunnelData(
            credentials,
            CHART_IDS.timeToFundedAccount,
            'Time to Funded Account',
            fromDate,
            toDate
          )
        ),
        limit(() =>
          fetchFunnelData(
            credentials,
            CHART_IDS.timeToLinkedBank,
            'Time to Linked Bank',
            fromDate,
            toDate
          )
        ),
        limit(() =>
          fetchInsightsData(credentials, CHART_IDS.subscribersInsights, 'Subscribers Insights')
        ),
        limit(() =>
          fetchInsightsData(
            credentials,
            CHART_IDS.profileViewsByCreator,
            'Profile Views by Creator'
          )
        ),
        limit(() =>
          fetchInsightsData(credentials, CHART_IDS.pdpViewsByPortfolio, 'PDP Views by Portfolio')
        ),
        limit(() =>
          fetchInsightsData(
            credentials,
            CHART_IDS.subscriptionsByCreator,
            'Subscriptions by Creator'
          )
        ),
        limit(() =>
          fetchInsightsData(credentials, CHART_IDS.copiesByCreator, 'Copies by Creator')
        ),
      ])

      console.log('✓ All 8 charts fetched successfully with controlled concurrency')

      // Process and insert data into database
      const stats: SyncStats = {
        subscribersFetched: 0,
        timeFunnelsFetched: 0,
        engagementRecordsFetched: 0,
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
              onConflict: 'distinct_id,synced_at',
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

      // Process time funnels
      const timeFunnelRows = [
        ...processFunnelData(timeToFirstCopyData, 'time_to_first_copy'),
        ...processFunnelData(timeToFundedData, 'time_to_funded_account'),
        ...processFunnelData(timeToLinkedData, 'time_to_linked_bank'),
      ]

      if (timeFunnelRows.length > 0) {
        // Use upsert to handle duplicates
        const { error: insertError } = await supabase
          .from('time_funnels')
          .upsert(timeFunnelRows, {
            onConflict: 'distinct_id,funnel_type,synced_at',
            ignoreDuplicates: false
          })

        if (insertError) {
          console.error('Error upserting time funnels:', insertError)
          throw insertError
        }

        stats.timeFunnelsFetched = timeFunnelRows.length
        stats.totalRecordsInserted += timeFunnelRows.length
        console.log(`Upserted ${timeFunnelRows.length} time funnel records`)
      }

      // Process and store portfolio-creator engagement pairs
      console.log('Processing portfolio-creator engagement pairs...')
      const [subscriptionPairs, copyPairs] = processPortfolioCreatorPairs(
        profileViewsData,
        pdpViewsData,
        subscriptionsData,
        copiesData,
        syncStartTime.toISOString()
      )

      // Upsert subscription pairs in batches
      if (subscriptionPairs.length > 0) {
        console.log(`Upserting ${subscriptionPairs.length} subscription pairs...`)
        for (let i = 0; i < subscriptionPairs.length; i += batchSize) {
          const batch = subscriptionPairs.slice(i, i + batchSize)
          const { error: insertError } = await supabase
            .from('user_portfolio_creator_views')
            .upsert(batch, {
              onConflict: 'distinct_id,portfolio_ticker,creator_id',
              ignoreDuplicates: false
            })

          if (insertError) {
            console.error('Error upserting subscription pairs batch:', insertError)
            throw insertError
          }
          console.log(`Upserted batch: ${i + batch.length}/${subscriptionPairs.length} subscription pairs`)
        }
        console.log('✓ Subscription pairs upserted successfully')
        stats.engagementRecordsFetched += subscriptionPairs.length
        stats.totalRecordsInserted += subscriptionPairs.length
      }

      // Upsert copy pairs in batches
      if (copyPairs.length > 0) {
        console.log(`Upserting ${copyPairs.length} copy pairs...`)
        for (let i = 0; i < copyPairs.length; i += batchSize) {
          const batch = copyPairs.slice(i, i + batchSize)
          const { error: insertError } = await supabase
            .from('user_portfolio_creator_copies')
            .upsert(batch, {
              onConflict: 'distinct_id,portfolio_ticker,creator_id',
              ignoreDuplicates: false
            })

          if (insertError) {
            console.error('Error upserting copy pairs batch:', insertError)
            throw insertError
          }
          console.log(`Upserted batch: ${i + batch.length}/${copyPairs.length} copy pairs`)
        }
        console.log('✓ Copy pairs upserted successfully')
      }

      // Trigger pattern analysis (NOW USES STORED DATA - no Mixpanel calls)
      // Fire and forget - don't wait for completion to avoid timeout
      console.log('Triggering pattern analysis (using stored data)...')

      // Trigger all three analyses and keep promises alive but don't await
      const analysisPromises = [
        fetch(`${supabaseUrl}/functions/v1/analyze-subscription-patterns`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'apikey': supabaseServiceKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({})
        }).then(() => console.log('✓ Subscription analysis invoked'))
          .catch((err) => console.warn('⚠️ Subscription analysis failed:', err)),

        fetch(`${supabaseUrl}/functions/v1/analyze-copy-patterns`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'apikey': supabaseServiceKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({})
        }).then(() => console.log('✓ Copy analysis invoked'))
          .catch((err) => console.warn('⚠️ Copy analysis failed:', err)),

        fetch(`${supabaseUrl}/functions/v1/analyze-portfolio-sequences`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'apikey': supabaseServiceKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({})
        }).then(() => console.log('✓ Portfolio sequence analysis invoked'))
          .catch((err) => console.warn('⚠️ Portfolio sequence analysis failed:', err))
      ]

      // Keep promises referenced but don't await (fire-and-forget that survives function return)
      Promise.allSettled(analysisPromises)

      console.log('✓ Pattern analysis functions triggered (running in background)')

      // Note: Pattern analysis uses exhaustive search + logistic regression
      // Results stored in conversion_pattern_combinations table
      console.log('Pattern analysis functions use stored engagement data (no duplicate Mixpanel calls)')

      // Refresh materialized view
      console.log('Refreshing main_analysis materialized view...')
      const { error: refreshError } = await supabase.rpc('refresh_main_analysis')
      if (refreshError) {
        console.error('Error refreshing materialized view:', refreshError)
        // Don't throw - this is not critical
      }

      // Update sync log with success
      const syncEndTime = new Date()
      await supabase
        .from('sync_logs')
        .update({
          sync_completed_at: syncEndTime.toISOString(),
          sync_status: 'completed',
          subscribers_fetched: stats.subscribersFetched,
          time_funnels_fetched: stats.timeFunnelsFetched,
          total_records_inserted: stats.totalRecordsInserted,
        })
        .eq('id', syncLogId)

      console.log('Sync completed successfully')

      // Refresh materialized view for subscription engagement summary
      console.log('Refreshing subscription_engagement_summary materialized view...')
      try {
        const { error: refreshError } = await supabase.rpc('refresh_subscription_engagement_summary')
        if (refreshError) {
          // If the function doesn't exist, try direct SQL
          await supabase.from('subscription_engagement_summary').select('count').limit(1)
          console.log('Note: Materialized view may need manual refresh. Run: REFRESH MATERIALIZED VIEW subscription_engagement_summary;')
        } else {
          console.log('✓ Materialized view refreshed successfully')
        }
      } catch (refreshErr) {
        console.warn('Could not refresh materialized view automatically:', refreshErr)
      }

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

async function fetchFunnelData(
  credentials: MixpanelCredentials,
  funnelId: string,
  name: string,
  fromDate: string,
  toDate: string
) {
  console.log(`Fetching ${name} funnel data (ID: ${funnelId})...`)

  const params = new URLSearchParams({
    project_id: PROJECT_ID,
    funnel_id: funnelId,
    from_date: fromDate,
    to_date: toDate,
    users: 'true', // Request user-level data
  })

  const authString = `${credentials.username}:${credentials.secret}`
  const authHeader = `Basic ${btoa(authString)}`

  const response = await fetch(`${MIXPANEL_API_BASE}/query/funnels?${params}`, {
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
  console.log(`Response structure:`, JSON.stringify(Object.keys(data), null, 2))
  if (data.data) {
    console.log(`Data keys:`, JSON.stringify(Object.keys(data.data), null, 2))
  }
  return data
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
  })).filter(row => row.distinct_id)
}

function processFunnelData(data: any, funnelType: string): any[] {
  if (!data || !data.data) {
    console.log(`No funnel data for ${funnelType}`)
    return []
  }

  const rows: any[] = []

  // Funnels API returns data grouped by date, then by distinct_id
  // Structure: { data: { "2025-09-29": { "$overall": [...], "distinct_id_1": [...], ... } } }

  Object.entries(data.data).forEach(([date, dateData]: [string, any]) => {
    if (!dateData || typeof dateData !== 'object') return

    Object.entries(dateData).forEach(([key, steps]: [string, any]) => {
      // Skip $overall aggregate
      if (key === '$overall') return

      // Key can be distinct_id or $device:xxx format
      let distinctId = key

      // If it's a device ID format, extract just the device ID part
      if (key.startsWith('$device:')) {
        distinctId = key.replace('$device:', '')
      }

      // steps is an array of funnel steps
      if (!Array.isArray(steps) || steps.length === 0) return

      // Get the last step (final conversion step)
      const finalStep = steps[steps.length - 1]

      // Only include if user completed the funnel (count > 0 on final step)
      // and we have a time value
      if (finalStep.count > 0 && finalStep.avg_time_from_start) {
        const timeInSeconds = parseFloat(finalStep.avg_time_from_start)

        if (timeInSeconds > 0) {
          rows.push({
            distinct_id: distinctId,
            funnel_type: funnelType,
            time_in_seconds: timeInSeconds,
            time_in_days: timeInSeconds / 86400,
            synced_at: new Date().toISOString(),
          })
        }
      }
    })
  })

  console.log(`Processed ${rows.length} ${funnelType} records`)
  return rows
}

/**
 * Process user-level engagement summary
 * Returns rows for user_engagement_for_subscriptions table
 */
function processUserLevelEngagement(profileViewsData: any, pdpViewsData: any, subscriptionsData: any): any[] {
  if (!profileViewsData?.series || !pdpViewsData?.series || !subscriptionsData?.series) {
    console.log('Missing required data for user engagement processing')
    return []
  }

  const syncedAt = new Date().toISOString()

  // Build maps for each data source
  const userProfileViewsMap = new Map<string, { total: number, uniqueCreators: Set<string>, topCreator: { username: string, count: number } }>()
  const userPdpViewsMap = new Map<string, { total: number, uniquePortfolios: Set<string>, topPortfolio: { ticker: string, count: number } }>()
  const userSubscriptionsMap = new Map<string, boolean>()

  // Process Profile Views (distinct_id -> creatorId -> creatorUsername -> count)
  const profileMetric = profileViewsData.series['Total Profile Views']
  if (profileMetric) {
    Object.keys(profileMetric).forEach(distinctId => {
      if (distinctId === '$overall') return

      const userData = profileMetric[distinctId]
      let totalViews = 0
      const creatorsViewed = new Set<string>()
      const creatorCounts = new Map<string, number>()

      Object.keys(userData).forEach(creatorId => {
        if (creatorId === '$overall') return

        const creatorData = userData[creatorId]
        Object.keys(creatorData).forEach(username => {
          if (username === '$overall') return

          const count = creatorData[username]?.all || 0
          totalViews += count
          creatorsViewed.add(username)
          creatorCounts.set(username, (creatorCounts.get(username) || 0) + count)
        })
      })

      // Find top creator
      let topCreator = { username: '', count: 0 }
      creatorCounts.forEach((count, username) => {
        if (count > topCreator.count) {
          topCreator = { username, count }
        }
      })

      userProfileViewsMap.set(distinctId, {
        total: totalViews,
        uniqueCreators: creatorsViewed,
        topCreator
      })
    })
  }

  // Process PDP Views (distinct_id -> portfolioTicker -> creatorId -> count)
  const pdpMetric = pdpViewsData.series['Total PDP Views']
  if (pdpMetric) {
    Object.keys(pdpMetric).forEach(distinctId => {
      if (distinctId === '$overall') return

      const userData = pdpMetric[distinctId]
      let totalViews = 0
      const portfoliosViewed = new Set<string>()
      const portfolioCounts = new Map<string, number>()

      Object.keys(userData).forEach(ticker => {
        if (ticker === '$overall') return

        const tickerData = userData[ticker]
        Object.keys(tickerData).forEach(creatorId => {
          if (creatorId === '$overall') return

          const count = tickerData[creatorId]?.all || 0
          totalViews += count
          portfoliosViewed.add(ticker)
          portfolioCounts.set(ticker, (portfolioCounts.get(ticker) || 0) + count)
        })
      })

      // Find top portfolio
      let topPortfolio = { ticker: '', count: 0 }
      portfolioCounts.forEach((count, ticker) => {
        if (count > topPortfolio.count) {
          topPortfolio = { ticker, count }
        }
      })

      userPdpViewsMap.set(distinctId, {
        total: totalViews,
        uniquePortfolios: portfoliosViewed,
        topPortfolio
      })
    })
  }

  // Process Subscriptions (distinct_id -> creatorId -> creatorUsername -> count)
  console.log('Subscriptions data structure:', {
    hasSeries: !!subscriptionsData?.series,
    seriesType: typeof subscriptionsData?.series,
    seriesKeys: subscriptionsData?.series ? Object.keys(subscriptionsData.series) : [],
    isArray: Array.isArray(subscriptionsData?.series)
  })

  const subsMetric = subscriptionsData.series['Total Subscriptions']
  if (subsMetric) {
    const allKeys = Object.keys(subsMetric)
    console.log(`Subscription data has ${allKeys.length} keys (including $overall)`)

    Object.keys(subsMetric).forEach(distinctId => {
      if (distinctId === '$overall') return

      // User has subscription if they appear in this metric at all
      userSubscriptionsMap.set(distinctId, true)
    })

    console.log(`Identified ${userSubscriptionsMap.size} users with subscriptions`)
  } else {
    console.warn('Total Subscriptions metric not found in subscriptionsData.series')
  }

  // Combine all data at user level
  const allUserIds = new Set<string>([
    ...userProfileViewsMap.keys(),
    ...userPdpViewsMap.keys(),
    ...userSubscriptionsMap.keys()
  ])

  console.log(`Total unique users across all metrics: ${allUserIds.size}`)

  const rows: any[] = []
  let subscriberCount = 0
  let nonSubscriberCount = 0

  allUserIds.forEach(distinctId => {
    const profileData = userProfileViewsMap.get(distinctId)
    const pdpData = userPdpViewsMap.get(distinctId)
    const didSubscribe = userSubscriptionsMap.has(distinctId)

    if (didSubscribe) subscriberCount++
    else nonSubscriberCount++

    rows.push({
      distinct_id: distinctId,
      did_subscribe: didSubscribe,
      total_profile_views: profileData?.total || 0,
      total_pdp_views: pdpData?.total || 0,
      unique_creators_viewed: profileData?.uniqueCreators.size || 0,
      unique_portfolios_viewed: pdpData?.uniquePortfolios.size || 0,
      top_creator_username: profileData?.topCreator.username || null,
      top_portfolio_ticker: pdpData?.topPortfolio.ticker || null,
      synced_at: syncedAt,
    })
  })

  console.log(`Processed ${rows.length} user engagement records`)
  console.log(`  - Subscribers: ${subscriberCount}`)
  console.log(`  - Non-subscribers: ${nonSubscriberCount}`)
  return rows
}

/**
 * Process portfolio-creator pairs for BOTH subscriptions AND copies
 * Returns two arrays: [subscriptionPairs, copyPairs]
 */
function processPortfolioCreatorPairs(
  profileViewsData: any,
  pdpViewsData: any,
  subscriptionsData: any,
  copiesData: any,
  syncedAt: string
): [any[], any[]] {
  const subscriptionPairs: any[] = []
  const copyPairs: any[] = []

  // Build creator username map
  const creatorIdToUsername = new Map<string, string>()
  const profileMetric = profileViewsData?.series?.['Total Profile Views']
  if (profileMetric) {
    Object.entries(profileMetric).forEach(([distinctId, creatorData]: [string, any]) => {
      if (distinctId === '$overall' || typeof creatorData !== 'object' || creatorData === null) return

      Object.entries(creatorData).forEach(([creatorId, usernameData]: [string, any]) => {
        if (creatorId === '$overall' || typeof usernameData !== 'object' || usernameData === null) return

        Object.entries(usernameData).forEach(([username, viewCount]: [string, any]) => {
          if (username && username !== '$overall' && username !== 'undefined') {
            if (!creatorIdToUsername.has(creatorId)) {
              creatorIdToUsername.set(creatorId, username)
            }
          }
        })
      })
    })
  }

  // Build profile view counts map
  const profileViewCounts = new Map<string, Map<string, number>>()
  if (profileMetric) {
    Object.entries(profileMetric).forEach(([distinctId, creatorData]: [string, any]) => {
      if (distinctId === '$overall' || typeof creatorData !== 'object' || creatorData === null) return

      Object.entries(creatorData).forEach(([creatorId, usernameData]: [string, any]) => {
        if (creatorId === '$overall' || typeof usernameData !== 'object' || usernameData === null) return

        Object.entries(usernameData).forEach(([username, viewCount]: [string, any]) => {
          if (username && username !== '$overall' && username !== 'undefined') {
            const count = typeof viewCount === 'object' && viewCount !== null && 'all' in viewCount
              ? parseInt(String((viewCount as any).all))
              : parseInt(String(viewCount)) || 0

            if (count > 0) {
              if (!profileViewCounts.has(distinctId)) {
                profileViewCounts.set(distinctId, new Map())
              }
              const userCounts = profileViewCounts.get(distinctId)!
              userCounts.set(creatorId, (userCounts.get(creatorId) || 0) + count)
            }
          }
        })
      })
    })
  }

  // Build subscription users and counts
  const subscribedUsers = new Set<string>()
  const subscriptionCounts = new Map<string, number>()
  const subsMetric = subscriptionsData?.series?.['Total Subscriptions']
  if (subsMetric) {
    Object.entries(subsMetric).forEach(([distinctId, data]: [string, any]) => {
      if (distinctId !== '$overall') {
        subscribedUsers.add(distinctId)
        const count = typeof data === 'object' && data !== null && '$overall' in data
          ? parseInt(String(data['$overall'])) || 1
          : parseInt(String(data)) || 1
        subscriptionCounts.set(distinctId, count)
      }
    })
  }

  // Build copied users and counts
  const copiedUsers = new Set<string>()
  const copyCounts = new Map<string, number>()
  const copiesMetric = copiesData?.series?.['Total Copies']
  if (copiesMetric) {
    Object.entries(copiesMetric).forEach(([distinctId, data]: [string, any]) => {
      if (distinctId !== '$overall') {
        copiedUsers.add(distinctId)
        const count = typeof data === 'object' && data !== null && '$overall' in data
          ? parseInt(String(data['$overall'])) || 1
          : parseInt(String(data)) || 1
        copyCounts.set(distinctId, count)
      }
    })
  }

  // Process PDP views to create pairs
  const pdpMetric = pdpViewsData?.series?.['Total PDP Views']
  if (pdpMetric) {
    Object.entries(pdpMetric).forEach(([distinctId, portfolioData]: [string, any]) => {
      if (distinctId === '$overall' || typeof portfolioData !== 'object' || portfolioData === null) return

      const didSubscribe = subscribedUsers.has(distinctId)
      const subCount = subscriptionCounts.get(distinctId) || 0
      const didCopy = copiedUsers.has(distinctId)
      const copyCount = copyCounts.get(distinctId) || 0

      Object.entries(portfolioData).forEach(([portfolioTicker, creatorData]: [string, any]) => {
        if (portfolioTicker === '$overall' || typeof creatorData !== 'object' || creatorData === null) return

        Object.entries(creatorData).forEach(([creatorId, viewCount]: [string, any]) => {
          if (creatorId === '$overall') return

          const pdpCount = typeof viewCount === 'object' && viewCount !== null && 'all' in viewCount
            ? parseInt(String((viewCount as any).all))
            : parseInt(String(viewCount)) || 0
          const creatorUsername = creatorIdToUsername.get(creatorId) || null
          const profileViewCount = profileViewCounts.get(distinctId)?.get(creatorId) || 0

          if (pdpCount > 0) {
            // Add to subscription pairs
            subscriptionPairs.push({
              distinct_id: distinctId,
              portfolio_ticker: portfolioTicker,
              creator_id: creatorId,
              creator_username: creatorUsername,
              pdp_view_count: pdpCount,
              profile_view_count: profileViewCount,
              did_subscribe: didSubscribe,
              subscription_count: subCount,
              synced_at: syncedAt,
            })

            // Add to copy pairs
            copyPairs.push({
              distinct_id: distinctId,
              portfolio_ticker: portfolioTicker,
              creator_id: creatorId,
              creator_username: creatorUsername,
              pdp_view_count: pdpCount,
              profile_view_count: profileViewCount,
              did_copy: didCopy,
              copy_count: copyCount,
              synced_at: syncedAt,
            })
          }
        })
      })
    })
  }

  console.log(`Processed ${subscriptionPairs.length} subscription pairs and ${copyPairs.length} copy pairs`)
  return [subscriptionPairs, copyPairs]
}
