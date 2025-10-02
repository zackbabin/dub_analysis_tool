import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const MIXPANEL_PROJECT_ID = '2599235'
const MIXPANEL_USERNAME = Deno.env.get('MIXPANEL_SERVICE_USERNAME') || ''
const MIXPANEL_PASSWORD = Deno.env.get('MIXPANEL_SERVICE_SECRET') || ''

const CHART_IDS = {
  profileViewsByCreator: '85165851',  // Total Profile Views
  pdpViewsByPortfolio: '85165580',     // Total PDP Views by creatorId, portfolioTicker, distinctId
  subscriptionsByCreator: '85165590',  // Total Subscriptions
}

interface PortfolioCreatorPair {
  distinct_id: string
  portfolio_ticker: string
  creator_id: string
  creator_username: string | null
  pdp_view_count: number
  profile_view_count: number
  did_subscribe: boolean
  synced_at: string
}

/**
 * Fetch Mixpanel insights data
 */
async function fetchMixpanelChart(chartId: string, name: string): Promise<any> {
  console.log(`Fetching ${name} (ID: ${chartId})...`)

  const params = new URLSearchParams({
    project_id: MIXPANEL_PROJECT_ID,
    bookmark_id: chartId,
    limit: '50000',
  })

  const authString = `${MIXPANEL_USERNAME}:${MIXPANEL_PASSWORD}`
  const authHeader = `Basic ${btoa(authString)}`

  const response = await fetch(`https://mixpanel.com/api/query/insights?${params}`, {
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

/**
 * Process portfolio-creator pairs from Mixpanel data
 */
function processPortfolioCreatorPairs(
  profileViewsData: any,
  pdpViewsData: any,
  subscriptionsData: any,
  syncedAt: string
): PortfolioCreatorPair[] {
  const pairs: PortfolioCreatorPair[] = []

  // Build creator ID to username mapping and profile view counts
  const creatorIdToUsername = new Map<string, string>()
  // Map: distinctId -> creatorId -> profile_view_count
  const profileViewCounts = new Map<string, Map<string, number>>()

  const profileMetric = profileViewsData?.series?.['Total Profile Views']
  if (profileMetric) {
    console.log(`Building creator ID to username mapping from ${Object.keys(profileMetric).length} users`)

    Object.entries(profileMetric).forEach(([distinctId, creatorData]: [string, any]) => {
      if (distinctId === '$overall' || typeof creatorData !== 'object' || creatorData === null) return

      Object.entries(creatorData).forEach(([creatorId, usernameData]: [string, any]) => {
        if (creatorId === '$overall' || typeof usernameData !== 'object' || usernameData === null) return

        Object.entries(usernameData).forEach(([username, viewCount]: [string, any]) => {
          if (username && username !== '$overall' && username !== 'undefined') {
            // Store username mapping
            if (!creatorIdToUsername.has(creatorId)) {
              creatorIdToUsername.set(creatorId, username)
            }

            // Store profile view count
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

    console.log(`Mapped ${creatorIdToUsername.size} creator IDs to usernames`)
  } else {
    console.warn('Profile Views data not available or has unexpected structure')
  }

  // Build set of users who subscribed
  const subscribedUsers = new Set<string>()
  const subsMetric = subscriptionsData?.series?.['Total Subscriptions']
  if (subsMetric) {
    Object.keys(subsMetric).forEach((distinctId: string) => {
      if (distinctId !== '$overall') {
        subscribedUsers.add(distinctId)
      }
    })
  }

  // Process PDP views: distinct_id -> portfolioTicker -> creatorId -> count
  const pdpMetric = pdpViewsData?.series?.['Total PDP Views']
  if (pdpMetric) {
    Object.entries(pdpMetric).forEach(([distinctId, portfolioData]: [string, any]) => {
      if (distinctId === '$overall' || typeof portfolioData !== 'object' || portfolioData === null) return

      const didSubscribe = subscribedUsers.has(distinctId)

      Object.entries(portfolioData).forEach(([portfolioTicker, creatorData]: [string, any]) => {
        if (portfolioTicker === '$overall' || typeof creatorData !== 'object' || creatorData === null) return

        Object.entries(creatorData).forEach(([creatorId, viewCount]: [string, any]) => {
          if (creatorId === '$overall') return

          const count = typeof viewCount === 'object' && viewCount !== null && 'all' in viewCount
            ? parseInt(String((viewCount as any).all))
            : parseInt(String(viewCount)) || 0
          const creatorUsername = creatorIdToUsername.get(creatorId) || null

          // Get profile view count for this user-creator pair
          const profileViewCount = profileViewCounts.get(distinctId)?.get(creatorId) || 0

          if (count > 0) {
            pairs.push({
              distinct_id: distinctId,
              portfolio_ticker: portfolioTicker,
              creator_id: creatorId,
              creator_username: creatorUsername,
              pdp_view_count: count,
              profile_view_count: profileViewCount,
              did_subscribe: didSubscribe,
              synced_at: syncedAt,
            })
          }
        })
      })
    })
  }

  return pairs
}

/**
 * Main handler
 */
serve(async (_req) => {
  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const syncedAt = new Date().toISOString()

    console.log('Fetching engagement charts from Mixpanel...')

    // Fetch all 3 charts (under rate limit since only 3 concurrent calls)
    const [profileViewsData, pdpViewsData, subscriptionsData] = await Promise.all([
      fetchMixpanelChart(CHART_IDS.profileViewsByCreator, 'Profile Views by Creator'),
      fetchMixpanelChart(CHART_IDS.pdpViewsByPortfolio, 'PDP Views by Portfolio'),
      fetchMixpanelChart(CHART_IDS.subscriptionsByCreator, 'Subscriptions by Creator'),
    ])

    console.log('Processing portfolio-creator pairs...')
    const pairRows = processPortfolioCreatorPairs(
      profileViewsData,
      pdpViewsData,
      subscriptionsData,
      syncedAt
    )

    console.log(`Processed ${pairRows.length} portfolio-creator pairs`)
    const pairsWithUsername = pairRows.filter(p => p.creator_username !== null).length
    const pairsWithoutUsername = pairRows.filter(p => p.creator_username === null).length
    console.log(`  - With username: ${pairsWithUsername}`)
    console.log(`  - Without username: ${pairsWithoutUsername}`)

    // Insert pairs in batches of 500
    const batchSize = 500
    let insertedCount = 0

    for (let i = 0; i < pairRows.length; i += batchSize) {
      const batch = pairRows.slice(i, i + batchSize)
      const { error: insertError } = await supabaseClient
        .from('user_portfolio_creator_views')
        .insert(batch)

      if (insertError) {
        console.error(`Error inserting pair batch ${i / batchSize + 1}:`, insertError)
        throw insertError
      }

      insertedCount += batch.length
      console.log(`Inserted ${insertedCount}/${pairRows.length} pairs`)
    }

    return new Response(
      JSON.stringify({
        success: true,
        stats: {
          pairs_processed: pairRows.length,
        },
      }),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error: any) {
    console.error('Error in sync-engagement-pairs:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message || String(error),
      }),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 500,
      }
    )
  }
})
