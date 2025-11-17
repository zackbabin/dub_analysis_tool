/**
 * Support API Clients
 *
 * Client libraries for fetching data from Zendesk and Instabug APIs
 * with rate limiting and pagination support.
 *
 * Used by: sync-support-conversations edge function
 */

/**
 * Zendesk API Client
 * Fetches tickets and comments using Zendesk's incremental API
 * Adheres to Zendesk rate limits: 10 requests/minute for Incremental Exports
 */
export class ZendeskClient {
  private baseUrl: string
  private auth: string
  private rateLimitDelay = 7000 // 7 seconds between requests = ~8.5 requests/minute (safe margin under 10/min limit)
  private maxRetries = 3

  constructor(subdomain: string, email: string, apiToken: string) {
    // Clean up subdomain in case it contains full domain or URL
    let cleanSubdomain = subdomain
      .replace(/^https?:\/\//i, '') // Remove protocol if present
      .replace(/\.zendesk\.com.*/i, '') // Remove .zendesk.com and anything after
      .replace(/\/.*$/, '') // Remove any trailing path
      .trim()

    this.baseUrl = `https://${cleanSubdomain}.zendesk.com/api/v2`
    this.auth = btoa(`${email}/token:${apiToken}`)

    console.log(`Zendesk client initialized for subdomain: ${cleanSubdomain}`)
  }

  /**
   * Fetch tickets created/updated since a given Unix timestamp
   * Uses incremental tickets API for efficient syncing
   * @param unixTimestamp - Unix timestamp in seconds
   * @returns Array of ticket objects
   */
  async fetchTicketsSince(unixTimestamp: number): Promise<any[]> {
    const tickets: any[] = []
    let url: string | null = `${this.baseUrl}/incremental/tickets.json?start_time=${unixTimestamp}`

    console.log(`Fetching Zendesk tickets since ${new Date(unixTimestamp * 1000).toISOString()}`)

    while (url) {
      const response = await this.fetchWithRetry(url)
      const data = await response.json()

      tickets.push(...data.tickets)

      // Log rate limit status
      this.logRateLimitStatus(response, 'tickets')

      url = data.next_page
      if (url) {
        console.log(`  Fetched ${tickets.length} tickets so far, fetching next page...`)
        await this.sleep(this.rateLimitDelay)
      }
    }

    console.log(`✓ Fetched ${tickets.length} Zendesk tickets total`)
    return tickets
  }

  /**
   * Fetch ticket comments/events created/updated since a given Unix timestamp
   * Filters for Comment events only
   * @param unixTimestamp - Unix timestamp in seconds
   * @returns Array of comment event objects
   */
  async fetchCommentsSince(unixTimestamp: number): Promise<any[]> {
    const comments: any[] = []
    let url: string | null = `${this.baseUrl}/incremental/ticket_events.json?start_time=${unixTimestamp}`

    console.log(`Fetching Zendesk comments since ${new Date(unixTimestamp * 1000).toISOString()}`)

    while (url) {
      const response = await this.fetchWithRetry(url)
      const data = await response.json()

      // Filter for Comment events only
      const commentEvents = data.ticket_events.filter(
        (event: any) => event.event_type === 'Comment' && event.body
      )

      comments.push(...commentEvents)

      // Log rate limit status
      this.logRateLimitStatus(response, 'comments')

      url = data.next_page
      if (url) {
        console.log(`  Fetched ${comments.length} comments so far, fetching next page...`)
        await this.sleep(this.rateLimitDelay)
      }
    }

    console.log(`✓ Fetched ${comments.length} Zendesk comments total`)
    return comments
  }

  /**
   * Fetch with automatic retry on rate limit (429) errors
   * Respects Retry-After header and implements exponential backoff
   */
  private async fetchWithRetry(url: string, attempt = 1): Promise<Response> {
    const response = await fetch(url, {
      headers: { Authorization: `Basic ${this.auth}` },
    })

    // Handle rate limiting (429)
    if (response.status === 429) {
      if (attempt >= this.maxRetries) {
        throw new Error(`Zendesk rate limit exceeded after ${this.maxRetries} retries`)
      }

      // Get retry delay from Retry-After header (in seconds) or use exponential backoff
      const retryAfter = response.headers.get('Retry-After')
      const delaySeconds = retryAfter ? parseInt(retryAfter) : Math.pow(2, attempt) * 5
      const delayMs = delaySeconds * 1000

      console.warn(`⚠️ Zendesk rate limit hit (429). Retrying after ${delaySeconds}s (attempt ${attempt}/${this.maxRetries})`)
      await this.sleep(delayMs)

      return this.fetchWithRetry(url, attempt + 1)
    }

    // Handle other errors
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Zendesk API error (${response.status}): ${errorText}`)
    }

    return response
  }

  /**
   * Log rate limit status from response headers
   * Helps monitor API usage and detect approaching limits
   */
  private logRateLimitStatus(response: Response, context: string): void {
    const limit = response.headers.get('X-Rate-Limit')
    const remaining = response.headers.get('X-Rate-Limit-Remaining')

    if (limit && remaining) {
      const usage = ((parseInt(limit) - parseInt(remaining)) / parseInt(limit) * 100).toFixed(1)
      console.log(`  Rate limit [${context}]: ${remaining}/${limit} remaining (${usage}% used)`)

      // Warn if approaching limit
      if (parseInt(remaining) < 2) {
        console.warn(`  ⚠️ Approaching Zendesk rate limit: only ${remaining} requests remaining`)
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

/**
 * Instabug API Client
 * Fetches bug reports and comments using Instabug's SDK v3 API
 */
export class InstabugClient {
  private baseUrl = 'https://api.instabug.com/api/sdk/v3'
  private apiToken: string
  private rateLimitDelay = 200 // milliseconds between requests

  constructor(apiToken: string) {
    this.apiToken = apiToken
  }

  /**
   * Fetch bugs created since a given ISO timestamp
   * Uses pagination with 100 bugs per page
   * @param isoTimestamp - ISO 8601 timestamp string
   * @returns Array of bug objects
   */
  async fetchBugsSince(isoTimestamp: string): Promise<any[]> {
    const bugs: any[] = []
    let page = 1
    let hasMore = true

    console.log(`Fetching Instabug bugs since ${isoTimestamp}`)

    while (hasMore) {
      const url = `${this.baseUrl}/bugs?created_at_from=${isoTimestamp}&limit=100&page=${page}`

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Instabug API error (${response.status}): ${errorText}`)
      }

      const data = await response.json()
      bugs.push(...data.data)

      hasMore = data.data.length === 100
      page++

      if (hasMore) {
        console.log(`  Fetched ${bugs.length} bugs so far, fetching page ${page}...`)
        await this.sleep(this.rateLimitDelay)
      }
    }

    console.log(`✓ Fetched ${bugs.length} Instabug bugs total`)
    return bugs
  }

  /**
   * Fetch comments for a specific bug
   * @param bugId - Bug ID from Instabug
   * @returns Array of comment objects
   */
  async fetchBugComments(bugId: string): Promise<any[]> {
    const url = `${this.baseUrl}/bugs/${bugId}/comments`

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      // Log error but don't throw - some bugs may not have comments accessible
      console.warn(`Failed to fetch comments for bug ${bugId}: ${response.status}`)
      return []
    }

    const data = await response.json()
    return data.data || []
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
