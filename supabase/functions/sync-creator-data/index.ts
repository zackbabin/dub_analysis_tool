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
  creatorInsights: '85130412',      // Insights: Creator profile and engagement metrics
  funnel1: '85146028',              // Funnel 1
  funnel2: '85146063',              // Funnel 2
  funnel3: '85146051',              // Funnel 3
  funnel4: '85146064',              // Funnel 4
}

interface MixpanelCredentials {
  username: string
  secret: string
}

interface CreatorSyncStats {
  creatorsFetched: number
  portfoliosFetched: number
  conversionsFetched: number
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

    try {
      // Date range (last 30 days) - for funnels
      const today = new Date()
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(today.getDate() - 30)

      const toDate = today.toISOString().split('T')[0]
      const fromDate = thirtyDaysAgo.toISOString().split('T')[0]

      console.log(`Fetching data from ${fromDate} to ${toDate}`)

      // Fetch all creator data in parallel (1 Insights + 4 Funnels)
      const [creatorInsightsData, funnel1Data, funnel2Data, funnel3Data, funnel4Data] =
        await Promise.all([
          fetchInsightsData(credentials, CHART_IDS.creatorInsights, 'Creator Insights'),
          fetchFunnelData(credentials, CHART_IDS.funnel1, 'Funnel 1', fromDate, toDate),
          fetchFunnelData(credentials, CHART_IDS.funnel2, 'Funnel 2', fromDate, toDate),
          fetchFunnelData(credentials, CHART_IDS.funnel3, 'Funnel 3', fromDate, toDate),
          fetchFunnelData(credentials, CHART_IDS.funnel4, 'Funnel 4', fromDate, toDate),
        ])

      console.log('All creator data fetched successfully')

      // Process and insert data into database
      const stats: CreatorSyncStats = {
        creatorsFetched: 0,
        portfoliosFetched: 0,
        conversionsFetched: 0,
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

      // Process all funnels
      console.log('Processing funnel data...')

      const funnel1Results = processFunnelData(funnel1Data, 'Funnel 1')
      const funnel2Results = processFunnelData(funnel2Data, 'Funnel 2')
      const funnel3Results = processFunnelData(funnel3Data, 'Funnel 3')
      const funnel4Results = processFunnelData(funnel4Data, 'Funnel 4')

      // Combine all portfolio and profile records from all funnels
      const allPortfolioRows = [
        ...funnel1Results.portfolios,
        ...funnel2Results.portfolios,
        ...funnel3Results.portfolios,
        ...funnel4Results.portfolios,
      ]

      const allProfileRows = [
        ...funnel1Results.profiles,
        ...funnel2Results.profiles,
        ...funnel3Results.profiles,
        ...funnel4Results.profiles,
      ]

      // Insert portfolio data
      if (allPortfolioRows.length > 0) {
        console.log(`Inserting ${allPortfolioRows.length} portfolio records...`)

        const { error: portfolioError } = await supabase
          .from('creator_portfolios')
          .upsert(allPortfolioRows, {
            onConflict: 'portfolio_name,creator_username,synced_at',
            ignoreDuplicates: false,
          })

        if (portfolioError) {
          console.error('Error upserting portfolios:', portfolioError)
          throw portfolioError
        }

        stats.portfoliosFetched = allPortfolioRows.length
        stats.totalRecordsInserted += allPortfolioRows.length
        console.log(`✅ Inserted ${allPortfolioRows.length} portfolio records`)
      }

      // Insert profile conversion data
      if (allProfileRows.length > 0) {
        console.log(`Inserting ${allProfileRows.length} profile conversion records...`)

        // Deduplicate by creator_username (sum up views and subscriptions)
        const profileMap = new Map<string, any>()
        allProfileRows.forEach(row => {
          if (profileMap.has(row.creator_username)) {
            const existing = profileMap.get(row.creator_username)
            existing.profile_views += row.profile_views
            existing.subscriptions += row.subscriptions
          } else {
            profileMap.set(row.creator_username, { ...row })
          }
        })

        const deduplicatedProfiles = Array.from(profileMap.values())

        const { error: profileError } = await supabase
          .from('creator_profile_conversions')
          .upsert(deduplicatedProfiles, {
            onConflict: 'creator_username,synced_at',
            ignoreDuplicates: false,
          })

        if (profileError) {
          console.error('Error upserting profile conversions:', profileError)
          throw profileError
        }

        stats.conversionsFetched = deduplicatedProfiles.length
        stats.totalRecordsInserted += deduplicatedProfiles.length
        console.log(`✅ Inserted ${deduplicatedProfiles.length} profile conversion records`)
      }

      // Refresh materialized view
      console.log('Refreshing creator_analysis materialized view...')
      const { error: refreshError } = await supabase.rpc('refresh_creator_analysis')
      if (refreshError) {
        console.error('Error refreshing materialized view:', refreshError)
        // Don't throw - this is not critical
      }

      console.log('Creator sync completed successfully')

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

function processCreatorInsightsData(data: any): any[] {
  if (!data || !data.series) {
    console.log('No creator insights data')
    return []
  }

  const rows: any[] = []

  console.log('Creator insights data structure:', {
    hasHeaders: !!data.headers,
    headers: data.headers,
    metricsCount: Object.keys(data.series || {}).length,
  })

  // The structure is:
  // series: {
  //   "A. Total Profile Views": { "creatorId": { "$overall": {all: count}, "@username": {all: count} } }
  //   "B. Total PDP Views": { ... }
  // }

  const metrics = Object.keys(data.series)
  const creatorDataMap = new Map<string, any>()

  // Extract data for each metric
  metrics.forEach(metricName => {
    const metricData = data.series[metricName]

    // Iterate through creator IDs
    Object.keys(metricData).forEach(creatorId => {
      if (creatorId === '$overall') return // Skip overall

      const creatorMetrics = metricData[creatorId]

      // Find the username (it's the key that's not "$overall")
      const username = Object.keys(creatorMetrics).find(k => k !== '$overall')

      if (!username) return

      // Get the count value
      const count = creatorMetrics[username]?.all || 0

      // Initialize or update creator data
      if (!creatorDataMap.has(creatorId)) {
        creatorDataMap.set(creatorId, {
          creator_id: creatorId,
          creator_username: username,
        })
      }

      const creatorData = creatorDataMap.get(creatorId)

      // Map metric name to database field
      if (metricName === 'A. Total Profile Views') {
        creatorData.total_profile_views = count
      } else if (metricName === 'B. Total PDP Views') {
        creatorData.total_pdp_views = count
      } else if (metricName === 'C. Total Paywall Views') {
        creatorData.total_paywall_views = count
      } else if (metricName === 'D. Total Stripe Views') {
        creatorData.total_stripe_views = count
      } else if (metricName === 'E. Total Subscriptions') {
        creatorData.total_subscriptions = count
      }
    })
  })

  // Convert map to array
  creatorDataMap.forEach(creatorData => {
    rows.push({
      creator_id: String(creatorData.creator_id),
      creator_username: creatorData.creator_username,
      total_profile_views: creatorData.total_profile_views || 0,
      total_pdp_views: creatorData.total_pdp_views || 0,
      total_paywall_views: creatorData.total_paywall_views || 0,
      total_stripe_views: creatorData.total_stripe_views || 0,
      total_subscriptions: creatorData.total_subscriptions || 0,
    })
  })

  console.log(`Processed ${rows.length} creator insights rows`)
  return rows
}

function processFunnelData(data: any, funnelName: string): any {
  if (!data || !data.data) {
    console.log(`No funnel data for ${funnelName}`)
    return { portfolios: [], profiles: [] }
  }

  console.log(`Processing ${funnelName}...`)

  const portfolioRows: any[] = []
  const profileRows: any[] = []

  // Funnel structure:
  // data: {
  //   "2025-10-01": {
  //     "$overall": [...],
  //     "Portfolio Name": {
  //       "$overall": [...steps],
  //       "@username": [...steps]
  //     }
  //   }
  // }

  // Get the date keys (usually just one date)
  const dateKeys = Object.keys(data.data)

  dateKeys.forEach(dateKey => {
    const dateData = data.data[dateKey]

    Object.keys(dateData).forEach(key => {
      if (key === '$overall') return // Skip overall

      // This is a portfolio name or other grouping
      const portfolioName = key
      const portfolioData = dateData[key]

      // Check if there's creator username data
      Object.keys(portfolioData).forEach(usernameKey => {
        if (usernameKey === '$overall') {
          // Get the overall stats for this portfolio
          const steps = portfolioData[usernameKey]
          if (Array.isArray(steps) && steps.length >= 2) {
            const step1 = steps[0] // First step (views)
            const step2 = steps[1] // Second step (conversion)

            // Determine what kind of funnel this is based on step labels
            const step1Label = step1.step_label || step1.goal
            const step2Label = step2.step_label || step2.goal

            // If it's about portfolios and copies
            if (step1Label?.includes('Portfolio') && step2Label?.includes('Copy')) {
              // This goes to creator_portfolios table
              // We need to find the username
              const username = Object.keys(portfolioData).find(k => k !== '$overall' && k.startsWith('@'))

              if (username) {
                portfolioRows.push({
                  portfolio_name: portfolioName,
                  creator_username: username,
                  pdp_views: step1.count || 0,
                  copies: step2.count || 0,
                })
              }
            }
            // If it's about creator profiles and subscriptions
            else if (step1Label?.includes('Profile') && step2Label?.includes('Subscrib')) {
              // This goes to creator_profile_conversions table
              // In this case, the "portfolioName" might actually be a creator username or we need to extract it
              const username = Object.keys(portfolioData).find(k => k !== '$overall' && k.startsWith('@'))

              if (username) {
                profileRows.push({
                  creator_username: username,
                  profile_views: step1.count || 0,
                  subscriptions: step2.count || 0,
                })
              }
            }
          }
        } else if (usernameKey.startsWith('@')) {
          // Process username-specific data
          const username = usernameKey
          const steps = portfolioData[username]

          if (Array.isArray(steps) && steps.length >= 2) {
            const step1 = steps[0]
            const step2 = steps[1]

            const step1Label = step1.step_label || step1.goal
            const step2Label = step2.step_label || step2.goal

            // Portfolio copies funnel
            if (step1Label?.includes('Portfolio') && step2Label?.includes('Copy')) {
              portfolioRows.push({
                portfolio_name: portfolioName,
                creator_username: username,
                pdp_views: step1.count || 0,
                copies: step2.count || 0,
              })
            }
            // Creator profile subscriptions funnel
            else if (step1Label?.includes('Profile') && step2Label?.includes('Subscrib')) {
              profileRows.push({
                creator_username: username,
                profile_views: step1.count || 0,
                subscriptions: step2.count || 0,
              })
            }
          }
        }
      })
    })
  })

  console.log(`${funnelName}: Found ${portfolioRows.length} portfolio records, ${profileRows.length} profile records`)

  return { portfolios: portfolioRows, profiles: profileRows }
}
