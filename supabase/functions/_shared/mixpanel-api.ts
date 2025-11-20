/**
 * Shared Mixpanel API utilities
 * Used by: sync-mixpanel-user-events, sync-mixpanel-funnels, sync-mixpanel-engagement,
 *          sync-mixpanel-portfolio-events, sync-creator-data
 */

// ============================================================================
// Constants
// ============================================================================

// Get project ID from environment variable (Supabase secret)
const getProjectId = () => {
  const projectId = Deno.env.get('MIXPANEL_PROJECT_ID')
  if (!projectId) {
    throw new Error('MIXPANEL_PROJECT_ID not configured in Supabase secrets')
  }
  return projectId
}

export const MIXPANEL_CONFIG = {
  get PROJECT_ID() {
    return getProjectId()
  },
  API_BASE: 'https://mixpanel.com/api',
  EXPORT_API_BASE: 'https://data.mixpanel.com/api/2.0',
}

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
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

        // Don't retry rate limit errors - fail fast so caller can handle gracefully
        if (response.status === 429) {
          const error: any = new Error(`Mixpanel API error (${response.status}): ${errorText}`)
          error.isRateLimited = true
          error.statusCode = 429
          throw error
        }

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

/**
 * Fetch PDP view events with properties from Mixpanel Insights API
 * Chart 85312972: Viewed Premium PDP and Viewed Regular PDP broken down by portfolioTicker and creatorUsername
 * Structure: series[event_name][distinct_id][timestamp][portfolioTicker][creatorId][creatorUsername][all]
 * @param credentials - Mixpanel service account credentials
 * @returns Array of events with properties: { distinct_id, event, time, portfolioTicker, creatorUsername }
 */
export async function fetchPDPViewEventsWithProperties(credentials: MixpanelCredentials) {
  const chartId = '85312972'
  console.log(`Fetching PDP views with properties from Insights API (Chart ${chartId})...`)

  const data = await fetchInsightsData(credentials, chartId, 'PDP Views with Properties')

  const events: Array<{ distinct_id: string; event: string; time: string; portfolioTicker?: string; creatorUsername?: string }> = []

  if (!data.series) {
    console.warn('No series data in PDP views response')
    return events
  }

  // Parse structure: series[event_name][distinct_id][timestamp][portfolioTicker][creatorId][creatorUsername][all]
  for (const [eventName, eventData] of Object.entries(data.series)) {
    if (typeof eventData !== 'object' || eventData === null) continue

    // Clean up event name (remove prefix like "A. ", "B. ")
    const cleanEventName = eventName.replace(/^[A-Z]\.\s*/, '')

    for (const [distinctId, distinctIdData] of Object.entries(eventData as Record<string, any>)) {
      if (distinctId === '$overall' || typeof distinctIdData !== 'object') continue

      for (const [timestamp, timestampData] of Object.entries(distinctIdData)) {
        if (timestamp === '$overall' || typeof timestampData !== 'object') continue

        for (const [portfolioTicker, portfolioData] of Object.entries(timestampData)) {
          if (portfolioTicker === '$overall' || typeof portfolioData !== 'object') continue

          for (const [creatorId, creatorIdData] of Object.entries(portfolioData)) {
            if (creatorId === '$overall' || typeof creatorIdData !== 'object') continue

            for (const [creatorUsername, creatorData] of Object.entries(creatorIdData)) {
              if (creatorUsername === '$overall' || typeof creatorData !== 'object') continue

              const count = (creatorData as any).all || 1
              for (let i = 0; i < count; i++) {
                events.push({
                  distinct_id: distinctId,
                  event: cleanEventName,
                  time: timestamp,
                  portfolioTicker: portfolioTicker,
                  creatorUsername: creatorUsername
                })
              }
            }
          }
        }
      }
    }
  }

  console.log(`✓ Fetched ${events.length} PDP view events with properties`)
  return events
}

/**
 * Fetch Creator Profile view events with properties from Mixpanel Insights API
 * Chart 85312975: Viewed Premium Creator Profile and Viewed Regular Creator Profile broken down by creatorUsername
 * Structure: series[event_name][distinct_id][timestamp][creatorId][creatorUsername][all]
 * @param credentials - Mixpanel service account credentials
 * @returns Array of events with properties: { distinct_id, event, time, creatorUsername }
 */
export async function fetchCreatorProfileViewEventsWithProperties(credentials: MixpanelCredentials) {
  const chartId = '85312975'
  console.log(`Fetching Creator Profile views with properties from Insights API (Chart ${chartId})...`)

  const data = await fetchInsightsData(credentials, chartId, 'Creator Profile Views with Properties')

  const events: Array<{ distinct_id: string; event: string; time: string; creatorUsername?: string }> = []

  if (!data.series) {
    console.warn('No series data in Creator Profile views response')
    return events
  }

  // Parse structure: series[event_name][distinct_id][timestamp][creatorId][creatorUsername][all]
  for (const [eventName, eventData] of Object.entries(data.series)) {
    if (typeof eventData !== 'object' || eventData === null) continue

    // Clean up event name (remove prefix like "A. ", "B. ")
    const cleanEventName = eventName.replace(/^[A-Z]\.\s*/, '')

    for (const [distinctId, distinctIdData] of Object.entries(eventData as Record<string, any>)) {
      if (distinctId === '$overall' || typeof distinctIdData !== 'object') continue

      for (const [timestamp, timestampData] of Object.entries(distinctIdData)) {
        if (timestamp === '$overall' || typeof timestampData !== 'object') continue

        for (const [creatorId, creatorIdData] of Object.entries(timestampData)) {
          if (creatorId === '$overall' || typeof creatorIdData !== 'object') continue

          for (const [creatorUsername, creatorData] of Object.entries(creatorIdData)) {
            if (creatorUsername === '$overall' || typeof creatorData !== 'object') continue

            const count = (creatorData as any).all || 1
            for (let i = 0; i < count; i++) {
              events.push({
                distinct_id: distinctId,
                event: cleanEventName,
                time: timestamp,
                creatorUsername: creatorUsername
              })
            }
          }
        }
      }
    }
  }

  console.log(`✓ Fetched ${events.length} Creator Profile view events with properties`)
  return events
}

// ============================================================================
// Mixpanel API - Engage (User Profiles with Pagination)
// ============================================================================

export interface EngageUserProfile {
  $distinct_id: string
  $properties: {
    [key: string]: any
  }
}

export interface EngageResponse {
  results: EngageUserProfile[]
  session_id?: string
  page?: number
  total?: number
}

/**
 * Fetch user profiles from Mixpanel Engage API (with pagination support)
 * Much better than Insights API - returns flat properties, supports pagination
 *
 * @param credentials - Mixpanel service account credentials
 * @param options - Query options
 * @returns Engage API response with results and pagination info
 */
export async function fetchEngageProfiles(
  credentials: MixpanelCredentials,
  options: {
    cohortId?: number
    cohortIds?: number[]
    outputProperties?: string[]
    where?: string
    page?: number
    sessionId?: string
    pageSize?: number
  } = {}
): Promise<EngageResponse> {
  const params = new URLSearchParams({
    project_id: MIXPANEL_CONFIG.PROJECT_ID,
    include_all_users: 'false',
  })

  // Add cohort filter if specified (supports single or multiple cohorts)
  if (options.cohortIds && options.cohortIds.length > 0) {
    // Multiple cohorts - append each as separate filter_by_cohort param (OR logic)
    for (const cohortId of options.cohortIds) {
      params.append('filter_by_cohort', JSON.stringify({ id: cohortId }))
    }
  } else if (options.cohortId) {
    // Single cohort (backward compatibility)
    params.append('filter_by_cohort', JSON.stringify({ id: options.cohortId }))
  }

  // Add where filter if specified (segmentation expression)
  if (options.where) {
    params.append('where', options.where)
  }

  // Add output properties if specified
  if (options.outputProperties && options.outputProperties.length > 0) {
    params.append('output_properties', JSON.stringify(options.outputProperties))
  }

  // Add page size if specified (default: 1000, max: 2000)
  if (options.pageSize) {
    params.append('page_size', options.pageSize.toString())
  }

  // Add pagination params if specified
  if (options.page !== undefined) {
    params.append('page', options.page.toString())
  }
  if (options.sessionId) {
    params.append('session_id', options.sessionId)
  }

  const authString = `${credentials.username}:${credentials.secret}`
  const authHeader = `Basic ${btoa(authString)}`

  const url = `${MIXPANEL_CONFIG.API_BASE}/2.0/engage?${params}`

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Mixpanel Engage API error (${response.status}): ${errorText}`)
  }

  const data = await response.json()
  return data
}

// ============================================================================
// Skip Sync Logic
// ============================================================================

/**
 * Check if sync should be skipped based on last sync timestamp
 * Uses Supabase sync_logs table to track last successful sync per source
 * @param supabase - Supabase client
 * @param source - Sync source identifier (e.g., 'mixpanel_users', 'mixpanel_engagement')
 * @param lookbackHours - Hours to look back (default: 6)
 * @returns Promise<{ shouldSkip: boolean, lastSyncTime: Date | null }>
 */
export async function shouldSkipSync(
  supabase: any,
  source: string,
  lookbackHours = 6
): Promise<{ shouldSkip: boolean; lastSyncTime: Date | null }> {
  try {
    // Query sync_logs for most recent successful sync
    const { data, error } = await supabase
      .from('sync_logs')
      .select('sync_completed_at')
      .eq('source', source)
      .eq('sync_status', 'completed')
      .order('sync_completed_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error || !data || !data.sync_completed_at) {
      // No previous sync found, proceed with sync
      console.log(`No previous ${source} sync found, proceeding with sync`)
      return { shouldSkip: false, lastSyncTime: null }
    }

    const lastSyncTime = new Date(data.sync_completed_at)
    const lookbackMs = lookbackHours * 60 * 60 * 1000
    const cutoffTime = new Date(Date.now() - lookbackMs)

    const shouldSkip = lastSyncTime > cutoffTime

    if (shouldSkip) {
      console.log(`⏭️ Skipping ${source} sync (last synced: ${lastSyncTime.toISOString()}, within ${lookbackHours}h window)`)
    }

    return { shouldSkip, lastSyncTime }
  } catch (error) {
    console.warn(`Failed to check skip sync for ${source}:`, error)
    // On error, don't skip - proceed with sync
    return { shouldSkip: false, lastSyncTime: null }
  }
}

// ============================================================================
// Mixpanel API - Event Export (Raw Events)
// ============================================================================

export interface MixpanelExportEvent {
  event: string
  properties: {
    $distinct_id: string
    time: number
    [key: string]: any
  }
}

/**
 * Fetch raw events from Mixpanel Event Export API
 * Returns NDJSON stream - each line is a separate JSON event
 * Much faster than Insights API for large datasets
 *
 * @param credentials - Mixpanel service account credentials
 * @param fromDate - Start date (YYYY-MM-DD)
 * @param toDate - End date (YYYY-MM-DD)
 * @param events - Optional array of event names to filter
 * @returns Array of parsed event objects
 */
export async function fetchEventsExport(
  credentials: MixpanelCredentials,
  fromDate: string,
  toDate: string,
  events?: string[]
): Promise<MixpanelExportEvent[]> {
  console.log(`Fetching events from Export API: ${fromDate} to ${toDate}`)
  if (events && events.length > 0) {
    console.log(`Filtering ${events.length} event types`)
  }

  // Build query parameters
  const params = new URLSearchParams({
    project_id: MIXPANEL_CONFIG.PROJECT_ID,
    from_date: fromDate,
    to_date: toDate,
  })

  // Add event filter if specified
  if (events && events.length > 0) {
    params.append('event', JSON.stringify(events))
  }

  const authString = `${credentials.username}:${credentials.secret}`
  const authHeader = `Basic ${btoa(authString)}`

  const url = `${MIXPANEL_CONFIG.EXPORT_API_BASE}/export?${params}`

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: authHeader,
      Accept: 'text/plain',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Mixpanel Export API error (${response.status}): ${errorText}`)
  }

  // Parse NDJSON response (each line is a JSON object)
  const text = await response.text()
  const lines = text.trim().split('\n')

  console.log(`Received ${lines.length} event lines from Export API`)

  const parsedEvents: MixpanelExportEvent[] = []
  let parseErrors = 0

  for (const line of lines) {
    if (!line.trim()) continue

    try {
      const event = JSON.parse(line)
      parsedEvents.push(event)
    } catch (error) {
      parseErrors++
      if (parseErrors <= 5) {
        console.warn(`Failed to parse event line: ${line.substring(0, 100)}`)
      }
    }
  }

  if (parseErrors > 0) {
    console.warn(`⚠️ Failed to parse ${parseErrors} events`)
  }

  console.log(`✓ Parsed ${parsedEvents.length} events successfully`)
  return parsedEvents
}
