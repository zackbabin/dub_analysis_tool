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
// Mixpanel API - Event Export
// ============================================================================

/**
 * Fetch raw events from Mixpanel Event Export API
 * @param credentials - Mixpanel service account credentials
 * @param fromDate - Start date (YYYY-MM-DD)
 * @param toDate - End date (YYYY-MM-DD)
 * @param eventName - Name of the event to export
 * @param whereClause - Optional filter clause (e.g., 'defined(user["$email"])')
 */
export async function fetchPortfolioViewEvents(
  credentials: MixpanelCredentials,
  fromDate: string,
  toDate: string,
  eventName = 'Viewed Portfolio Details',
  whereClause?: string
) {
  console.log(`Fetching ${eventName} events from Event Export API...`)

  const params: Record<string, string> = {
    project_id: MIXPANEL_CONFIG.PROJECT_ID,
    from_date: fromDate,
    to_date: toDate,
    event: JSON.stringify([eventName]),
  }

  if (whereClause) {
    params.where = whereClause
  }

  const searchParams = new URLSearchParams(params)
  const authString = `${credentials.username}:${credentials.secret}`
  const authHeader = `Basic ${btoa(authString)}`

  const filterMsg = whereClause ? ` (filtering: ${whereClause})` : ''
  console.log(`Fetching portfolio events from ${fromDate} to ${toDate}${filterMsg}`)
  console.log(`API URL: ${MIXPANEL_CONFIG.EXPORT_API_BASE}/export?${searchParams}`)

  const response = await fetch(`${MIXPANEL_CONFIG.EXPORT_API_BASE}/export?${searchParams}`, {
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
  console.log(`Response length: ${text.length} characters`)

  const events: any[] = []
  let skippedLines = 0
  let totalLines = 0

  for (const line of text.trim().split('\n')) {
    if (line.trim()) {
      totalLines++
      try {
        const event = JSON.parse(line)

        // Log first event for debugging
        if (totalLines === 1) {
          console.log(`First event sample:`, JSON.stringify(event).substring(0, 500))
        }

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

  console.log(`Total lines in response: ${totalLines}`)
  if (skippedLines > 0) {
    console.log(`Skipped ${skippedLines} invalid portfolio view events`)
  }
  console.log(`✓ Fetched ${events.length} valid ${eventName} events`)
  return events
}
