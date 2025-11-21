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
  private rateLimitDelay = 6000 // 6 seconds between requests = 10 requests/min (Incremental API limit, not general API limit)
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
   * @param onBatch - Optional callback to process each batch (enables streaming)
   * @returns Array of ticket objects
   */
  async fetchTicketsSince(
    unixTimestamp: number,
    onBatch?: (tickets: any[]) => Promise<void>
  ): Promise<any[]> {
    const tickets: any[] = []
    let url: string | null = `${this.baseUrl}/incremental/tickets.json?start_time=${unixTimestamp}`

    console.log(`Fetching Zendesk tickets since ${new Date(unixTimestamp * 1000).toISOString()}`)

    while (url) {
      const response = await this.fetchWithRetry(url)
      const data = await response.json()

      // Process batch immediately if callback provided (streaming mode)
      if (onBatch && data.tickets.length > 0) {
        await onBatch(data.tickets)
        console.log(`  Processed batch of ${data.tickets.length} tickets`)
      } else {
        tickets.push(...data.tickets)
        console.log(`  Fetched ${tickets.length} tickets so far...`)
      }

      // Log rate limit status
      this.logRateLimitStatus(response, 'tickets')

      url = data.next_page
      if (url) {
        await this.sleep(this.rateLimitDelay)
      }
    }

    console.log(`✓ Fetched ${tickets.length || 'all'} Zendesk tickets total`)
    return tickets
  }

  /**
   * Fetch ticket comments for a specific ticket
   * Uses the Ticket Comments API endpoint
   * @param ticketId - Zendesk ticket ID
   * @returns Array of comment objects
   */
  async fetchTicketComments(ticketId: string): Promise<any[]> {
    const comments: any[] = []
    let url: string | null = `${this.baseUrl}/tickets/${ticketId}/comments.json`

    while (url) {
      const response = await this.fetchWithRetry(url)
      const data = await response.json()

      comments.push(...(data.comments || []))

      // Check for next page (pagination for tickets with >100 comments)
      url = data.next_page || null

      if (url) {
        await this.sleep(this.rateLimitDelay)
      }
    }

    return comments
  }

  /**
   * Fetch comment events since a given timestamp using Incremental Ticket Events API
   * Uses the comment_events sideload to get full comment details in child_events
   * This is much more efficient than fetching comments per ticket
   * @param unixTimestamp - Unix timestamp in seconds
   * @returns Array of comment objects with ticket_id
   * @see https://developer.zendesk.com/api-reference/ticketing/ticket-management/incremental_exports/
   */
  async fetchCommentsSince(unixTimestamp: number): Promise<any[]> {
    console.log(`Fetching Zendesk comments since ${new Date(unixTimestamp * 1000).toISOString()}`)

    const comments: any[] = []
    let url: string | null = `${this.baseUrl}/incremental/ticket_events.json?start_time=${unixTimestamp}&include=comment_events`

    while (url) {
      const response = await this.fetchWithRetry(url)
      const data = await response.json()

      // Process each ticket event
      for (const event of data.ticket_events || []) {
        // Check if this event has comment child_events
        if (event.child_events && Array.isArray(event.child_events)) {
          // Each child_event is a comment
          for (const childEvent of event.child_events) {
            // child_event should have comment data when comment_events sideload is used
            if (childEvent.id) {
              comments.push({
                ...childEvent,
                ticket_id: event.ticket_id, // Add ticket_id from parent event
              })
            }
          }
        }
      }

      if (comments.length % 1000 === 0 && comments.length > 0) {
        console.log(`  Fetched ${comments.length} comments so far...`)
      }

      // Log rate limit status
      this.logRateLimitStatus(response, 'comment_events')

      url = data.next_page
      if (url) {
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
