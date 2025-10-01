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
}

interface MixpanelCredentials {
  username: string
  secret: string
}

interface SyncStats {
  subscribersFetched: number
  timeFunnelsFetched: number
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

      // Fetch all data in parallel
      const [subscribersData, timeToFirstCopyData, timeToFundedData, timeToLinkedData] =
        await Promise.all([
          fetchInsightsData(credentials, CHART_IDS.subscribersInsights, 'Subscribers Insights'),
          fetchFunnelData(
            credentials,
            CHART_IDS.timeToFirstCopy,
            'Time to First Copy',
            fromDate,
            toDate
          ),
          fetchFunnelData(
            credentials,
            CHART_IDS.timeToFundedAccount,
            'Time to Funded Account',
            fromDate,
            toDate
          ),
          fetchFunnelData(
            credentials,
            CHART_IDS.timeToLinkedBank,
            'Time to Linked Bank',
            fromDate,
            toDate
          ),
        ])

      console.log('All data fetched successfully')

      // Process and insert data into database
      const stats: SyncStats = {
        subscribersFetched: 0,
        timeFunnelsFetched: 0,
        totalRecordsInserted: 0,
      }

      const currentSyncTime = new Date().toISOString()

      // Process subscribers insights
      const subscribersRows = processInsightsData(subscribersData)
      if (subscribersRows.length > 0) {
        // Use upsert to handle duplicates (insert or update based on unique constraint)
        const { error: insertError } = await supabase
          .from('subscribers_insights')
          .upsert(subscribersRows, {
            onConflict: 'distinct_id,synced_at',
            ignoreDuplicates: false
          })

        if (insertError) {
          console.error('Error upserting subscribers:', insertError)
          throw insertError
        }

        stats.subscribersFetched = subscribersRows.length
        stats.totalRecordsInserted += subscribersRows.length
        console.log(`Upserted ${subscribersRows.length} subscriber records`)
      }

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
  name: string
) {
  console.log(`Fetching ${name} insights data (ID: ${chartId})...`)

  const params = new URLSearchParams({
    project_id: PROJECT_ID,
    bookmark_id: chartId,
    limit: '100000',
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
  return data
}

// ============================================================================
// Helper Functions - Data Processing
// ============================================================================

function processInsightsData(data: any): any[] {
  if (!data || !data.headers || !data.series) {
    console.log('No valid insights data to process')
    return []
  }

  const rows: any[] = []

  // Handle Query API tabular format
  if (Array.isArray(data.headers) && Array.isArray(data.series)) {
    console.log(`Processing ${data.series.length} subscriber rows`)

    const distinctIdIndex = data.headers.indexOf('$distinct_id')
    if (distinctIdIndex === -1) {
      console.error('$distinct_id column not found in headers')
      return []
    }

    data.series.forEach((rowData: any[]) => {
      if (!Array.isArray(rowData)) return

      const row: any = {}

      // Map headers to values
      data.headers.forEach((header: string, idx: number) => {
        if (idx < rowData.length) {
          row[header] = rowData[idx]
        }
      })

      // Convert to database column format
      const dbRow = {
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
      }

      if (dbRow.distinct_id) {
        rows.push(dbRow)
      }
    })
  }

  console.log(`Processed ${rows.length} subscriber records`)
  return rows
}

function processFunnelData(data: any, funnelType: string): any[] {
  if (!data || !data.headers || !data.series) {
    console.log(`No valid funnel data for ${funnelType}`)
    return []
  }

  const rows: any[] = []

  // Handle Query API tabular format
  if (Array.isArray(data.headers) && Array.isArray(data.series)) {
    console.log(`Processing ${data.series.length} ${funnelType} rows`)

    const distinctIdIndex = data.headers.indexOf('$distinct_id')
    if (distinctIdIndex === -1) {
      console.error('$distinct_id column not found in headers')
      return []
    }

    // Find the time column (usually the 3rd column)
    const timeColumnIndex = data.headers.length > 2 ? 2 : -1

    data.series.forEach((rowData: any[]) => {
      if (!Array.isArray(rowData)) return

      const distinctId = rowData[distinctIdIndex]
      const timeInSeconds = timeColumnIndex !== -1 ? parseFloat(rowData[timeColumnIndex] || 0) : 0

      if (distinctId && timeInSeconds > 0) {
        rows.push({
          distinct_id: distinctId,
          funnel_type: funnelType,
          time_in_seconds: timeInSeconds,
          time_in_days: timeInSeconds / 86400, // Convert seconds to days
        })
      }
    })
  }

  console.log(`Processed ${rows.length} ${funnelType} records`)
  return rows
}
