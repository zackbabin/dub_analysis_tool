/**
 * Shared Mixpanel API utilities
 * Used by: sync-mixpanel-users, sync-mixpanel-funnels, sync-mixpanel-engagement,
 *          sync-mixpanel-portfolio-events, sync-creator-data
 */

// ============================================================================
// Constants
// ============================================================================

export const MIXPANEL_CONFIG = {
  PROJECT_ID: '2599235',
  API_BASE: 'https://mixpanel.com/api',
  EXPORT_API_BASE: 'https://data.mixpanel.com/api/2.0',
}

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ============================================================================
// Types
// ============================================================================

export interface MixpanelCredentials {
  username: string
  secret: string
}

// ============================================================================
// Concurrency Control
// ============================================================================

/**
 * Simple concurrency limiter (p-limit pattern)
 * Ensures max N promises run concurrently to respect Mixpanel rate limits
 */
export function pLimit(concurrency: number) {
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

// ============================================================================
// Mixpanel API - Insights
// ============================================================================

/**
 * Fetch data from Mixpanel Insights API (saved reports)
 * @param credentials - Mixpanel service account credentials
 * @param chartId - Bookmark ID of the saved report
 * @param name - Human-readable name for logging
 * @param retries - Number of retry attempts (default: 2)
 */
export async function fetchInsightsData(
  credentials: MixpanelCredentials,
  chartId: string,
  name: string,
  retries = 2
) {
  console.log(`Fetching ${name} insights data (ID: ${chartId})...`)

  const params = new URLSearchParams({
    project_id: MIXPANEL_CONFIG.PROJECT_ID,
    bookmark_id: chartId,
    limit: '50000',
  })

  const authString = `${credentials.username}:${credentials.secret}`
  const authHeader = `Basic ${btoa(authString)}`

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(`${MIXPANEL_CONFIG.API_BASE}/query/insights?${params}`, {
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
// Mixpanel API - Funnels
// ============================================================================

/**
 * Fetch data from Mixpanel Funnels API
 * @param credentials - Mixpanel service account credentials
 * @param funnelId - ID of the funnel
 * @param name - Human-readable name for logging
 * @param fromDate - Start date (YYYY-MM-DD)
 * @param toDate - End date (YYYY-MM-DD)
 */
export async function fetchFunnelData(
  credentials: MixpanelCredentials,
  funnelId: string,
  name: string,
  fromDate: string,
  toDate: string
) {
  console.log(`Fetching ${name} funnel data (ID: ${funnelId})...`)

  const params = new URLSearchParams({
    project_id: MIXPANEL_CONFIG.PROJECT_ID,
    funnel_id: funnelId,
    from_date: fromDate,
    to_date: toDate,
    users: 'true', // Request user-level data
  })

  const authString = `${credentials.username}:${credentials.secret}`
  const authHeader = `Basic ${btoa(authString)}`

  const response = await fetch(`${MIXPANEL_CONFIG.API_BASE}/query/funnels?${params}`, {
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
// Mixpanel API - Portfolio View Events (Insights API)
// ============================================================================

/**
 * Fetch portfolio view events from Mixpanel Insights API
 * Uses saved Insights chart (ID: 85246485) instead of Event Export API
 * @param credentials - Mixpanel service account credentials
 * @param chartId - Bookmark ID of the saved portfolio views report (default: 85246485)
 * @param name - Human-readable name for logging
 * @returns Array of events in format: { distinct_id, portfolio_ticker, event_time }
 */
export async function fetchPortfolioViewEvents(
  credentials: MixpanelCredentials,
  chartId = '85246485',
  name = 'Portfolio Views'
) {
  console.log(`Fetching ${name} from Insights API (Chart ID: ${chartId})...`)

  const data = await fetchInsightsData(credentials, chartId, name)

  // Parse nested Insights API response structure
  // Response format: series["metric_key"][$distinct_id][portfolioTicker][$time]["all"] = count
  const events: Array<{ distinct_id: string; portfolio_ticker: string; event_time: number }> = []
  let skippedEvents = 0

  if (!data.series) {
    console.warn('No series data in Insights API response')
    return events
  }

  // Get the first (and only) metric key
  const metricKeys = Object.keys(data.series)
  if (metricKeys.length === 0) {
    console.warn('No metrics found in series')
    return events
  }

  const metricKey = metricKeys[0]
  const seriesData = data.series[metricKey]

  // Iterate through distinct_ids (top level)
  for (const [distinctId, distinctIdData] of Object.entries(seriesData)) {
    if (distinctId === '$overall' || typeof distinctIdData !== 'object') continue

    // Iterate through portfolio tickers (second level)
    for (const [portfolioTicker, tickerData] of Object.entries(distinctIdData as Record<string, any>)) {
      if (portfolioTicker === '$overall' || typeof tickerData !== 'object') continue

      // Iterate through timestamps (third level)
      for (const [timestamp, timestampData] of Object.entries(tickerData as Record<string, any>)) {
        if (timestamp === '$overall' || typeof timestampData !== 'object') continue

        // Parse ISO timestamp to Unix timestamp (seconds)
        try {
          const eventTime = Math.floor(new Date(timestamp).getTime() / 1000)

          // Validate all required fields exist
          if (distinctId && portfolioTicker && eventTime) {
            // Get event count from timestampData.all
            const count = (timestampData as any).all || 1

            // Create one event per count (since each view should be a separate row)
            for (let i = 0; i < count; i++) {
              events.push({
                distinct_id: distinctId,
                portfolio_ticker: portfolioTicker,
                event_time: eventTime
              })
            }
          } else {
            skippedEvents++
          }
        } catch (e) {
          console.warn(`Failed to parse timestamp: ${timestamp}`, e)
          skippedEvents++
        }
      }
    }
  }

  if (skippedEvents > 0) {
    console.log(`Skipped ${skippedEvents} invalid events`)
  }

  console.log(`✓ Fetched ${events.length} portfolio view events from Insights API`)
  return events
}
