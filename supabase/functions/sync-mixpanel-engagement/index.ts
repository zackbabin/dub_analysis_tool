// Supabase Edge Function: sync-mixpanel-engagement
// Fetches engagement data (views, subscriptions, copies) from Mixpanel
// Part 3 of 4: Handles user_portfolio_creator_views, user_portfolio_creator_copies
// Triggers pattern analysis and refreshes materialized views
// Triggered manually by user clicking "Sync Live Data" button after sync-mixpanel-funnels completes

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
    const { data: syncLog, error: syncLogError} = await supabase
      .from('sync_logs')
      .insert({
        tool_type: 'user',
        sync_started_at: syncStartTime.toISOString(),
        sync_status: 'in_progress',
        source: 'mixpanel_engagement',
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
      // Date range (last 14 days) - reduced from 30 to avoid timeout
      const today = new Date()
      const fourteenDaysAgo = new Date()
      fourteenDaysAgo.setDate(today.getDate() - 14)

      const toDate = today.toISOString().split('T')[0]
      const fromDate = fourteenDaysAgo.toISOString().split('T')[0]

      console.log(`Fetching data from ${fromDate} to ${toDate} (14-day window)`)

      const credentials: MixpanelCredentials = {
        username: mixpanelUsername,
        secret: mixpanelSecret,
      }

      // Fetch engagement data with controlled concurrency to respect Mixpanel rate limits
      // Max 5 concurrent queries allowed by Mixpanel - we use 4 for safety
      console.log('Fetching engagement charts with max 4 concurrent requests...')
      const CONCURRENCY_LIMIT = 4
      const limit = pLimit(CONCURRENCY_LIMIT)

      const [
        profileViewsData,
        pdpViewsData,
        subscriptionsData,
        copiesData,
      ]: [any, any, any, any] = await Promise.all([
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

      console.log('✓ Engagement data fetched successfully with controlled concurrency')

      // Process and insert data into database
      const stats: SyncStats = {
        engagementRecordsFetched: 0,
        totalRecordsInserted: 0,
      }

      const batchSize = 500

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

      // Portfolio events are now handled by separate sync-mixpanel-portfolio-events function

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
          total_records_inserted: stats.totalRecordsInserted,
        })
        .eq('id', syncLogId)

      console.log('Engagement sync completed successfully')
      console.log('Note: subscription_engagement_summary will be refreshed by analyze-subscription-patterns after pattern analysis completes')

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Mixpanel engagement sync completed successfully',
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
    console.error('Error in sync-mixpanel-engagement function:', error)

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

async function fetchPortfolioViewEvents(
  credentials: MixpanelCredentials,
  fromDate: string,
  toDate: string
) {
  console.log(`Fetching Portfolio View Events from Event Export API...`)

  const params = new URLSearchParams({
    project_id: PROJECT_ID,
    from_date: fromDate,
    to_date: toDate,
    event: '["Viewed Portfolio Details"]',
  })

  const authString = `${credentials.username}:${credentials.secret}`
  const authHeader = `Basic ${btoa(authString)}`

  console.log(`Fetching portfolio events from ${fromDate} to ${toDate}`)

  const response = await fetch(`https://data.mixpanel.com/api/2.0/export?${params}`, {
    method: 'GET',
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Mixpanel Event Export API error (${response.status}): ${errorText}`)
  }

  // Parse JSONL response (one JSON object per line)
  const text = await response.text()
  const events: any[] = []
  let skippedLines = 0

  for (const line of text.trim().split('\n')) {
    if (line.trim()) {
      try {
        const event = JSON.parse(line)

        // Validate required properties
        if (event.properties?.distinct_id &&
            event.properties?.portfolioTicker &&
            event.properties?.time) {
          events.push(event)
        } else {
          skippedLines++
        }
      } catch (e) {
        skippedLines++
      }
    }
  }

  if (skippedLines > 0) {
    console.log(`Skipped ${skippedLines} invalid portfolio view events`)
  }
  console.log(`✓ Fetched ${events.length} valid Portfolio View events`)
  return events
}

// ============================================================================
// Helper Functions - Data Processing
// ============================================================================

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
