/**
 * Mixpanel Event Processing Module
 * Processes raw events from Export API into user profiles for subscribers_insights_v2
 *
 * Key differences from Insights API:
 * - Metrics are counted from events (not pre-aggregated)
 * - User properties extracted from event properties
 * - No premium/regular distinction (simplified)
 */

export interface MixpanelEvent {
  event: string
  properties: {
    $distinct_id: string
    time: number  // Unix timestamp (seconds)
    [key: string]: any  // User properties and event-specific properties
  }
}

export interface UserProfile {
  distinct_id: string

  // User properties (from event properties)
  income?: string
  net_worth?: string
  investing_activity?: string
  investing_experience_years?: number
  investing_objective?: string
  investment_type?: string
  acquisition_survey?: string

  // Account properties (from event properties)
  linked_bank_account: boolean
  available_copy_credits: number
  buying_power: number

  // Financial metrics (from event properties - may not be available)
  total_deposits: number
  total_deposit_count: number
  total_withdrawals: number
  total_withdrawal_count: number

  // Portfolio metrics (from event properties - may not be available)
  active_created_portfolios: number
  lifetime_created_portfolios: number

  // Event-counted metrics (12 tracked events)
  total_copies: number
  total_pdp_views: number
  total_creator_profile_views: number
  total_ach_transfers: number
  paywall_views: number
  total_subscriptions: number
  app_sessions: number
  discover_tab_views: number
  stripe_modal_views: number
  creator_card_taps: number
  portfolio_card_taps: number

  // Metrics not available (no events)
  leaderboard_tab_views: number
  premium_tab_views: number

  // Metadata
  updated_at: string
  events_processed: number
  first_event_time: string
  last_event_time: string
}

/**
 * Main processing function: Convert raw events into user profiles
 * @param events - Array of raw Mixpanel events from Export API
 * @returns Array of user profiles ready for database upsert
 */
export function processEventsToUserProfiles(events: MixpanelEvent[]): UserProfile[] {
  console.log(`Processing ${events.length} events into user profiles...`)

  // Step 1: Group events by distinct_id, user_id, or identified_id
  const userEventsMap = new Map<string, MixpanelEvent[]>()

  for (const event of events) {
    // Check for any of the three user identifiers
    const distinctId = event.properties.distinct_id
      || event.properties.$distinct_id
      || event.properties.user_id
      || event.properties.$user_id
      || event.properties.identified_id
      || event.properties.$identified_id

    if (!distinctId) {
      continue  // Skip events without any identifier
    }

    // Skip device-only IDs (starting with $device:)
    if (typeof distinctId === 'string' && distinctId.startsWith('$device:')) {
      continue
    }

    if (!userEventsMap.has(distinctId)) {
      userEventsMap.set(distinctId, [])
    }
    userEventsMap.get(distinctId)!.push(event)
  }

  console.log(`Found ${userEventsMap.size} unique users`)

  // Step 2: Process each user's events into a profile
  const profiles: UserProfile[] = []

  for (const [distinctId, userEvents] of userEventsMap) {
    const profile = buildUserProfile(distinctId, userEvents)
    profiles.push(profile)
  }

  console.log(`Built ${profiles.length} user profiles`)
  return profiles
}

/**
 * Build a single user profile from their events
 */
function buildUserProfile(distinctId: string, events: MixpanelEvent[]): UserProfile {
  // Sort events by time (most recent first for property extraction)
  const sortedEvents = [...events].sort((a, b) => b.properties.time - a.properties.time)

  // Extract user properties (take most recent non-null value)
  const userProperties = extractUserProperties(sortedEvents)

  // Count events for metrics
  const eventMetrics = countEventMetrics(events)

  // Calculate metadata
  const timestamps = events.map(e => e.properties.time).sort((a, b) => a - b)
  const firstEventTime = new Date(timestamps[0] * 1000).toISOString()
  const lastEventTime = new Date(timestamps[timestamps.length - 1] * 1000).toISOString()

  return {
    distinct_id: distinctId,
    ...userProperties,
    ...eventMetrics,
    updated_at: new Date().toISOString(),
    events_processed: events.length,
    first_event_time: firstEventTime,
    last_event_time: lastEventTime,
  }
}

/**
 * Extract user properties from events
 * Takes the most recent non-null value for each property
 */
function extractUserProperties(sortedEvents: MixpanelEvent[]): Partial<UserProfile> {
  const properties: Partial<UserProfile> = {
    // Initialize account properties to defaults
    linked_bank_account: false,
    available_copy_credits: 0,
    buying_power: 0,
    total_deposits: 0,
    total_deposit_count: 0,
    total_withdrawals: 0,
    total_withdrawal_count: 0,
    active_created_portfolios: 0,
    lifetime_created_portfolios: 0,
    leaderboard_tab_views: 0,
    premium_tab_views: 0,
  }

  // Iterate through events (most recent first) and take first non-null value
  for (const event of sortedEvents) {
    const props = event.properties

    // User profile properties
    if (!properties.income && props.income) {
      properties.income = props.income
    }
    if (!properties.net_worth && (props.netWorth || props.net_worth)) {
      properties.net_worth = props.netWorth || props.net_worth
    }
    if (!properties.investing_activity && (props.investingActivity || props.investing_activity)) {
      properties.investing_activity = props.investingActivity || props.investing_activity
    }
    if (!properties.investing_experience_years && (props.investingExperienceYears || props.investing_experience_years)) {
      properties.investing_experience_years = parseInt(props.investingExperienceYears || props.investing_experience_years || 0)
    }
    if (!properties.investing_objective && (props.investingObjective || props.investing_objective)) {
      properties.investing_objective = props.investingObjective || props.investing_objective
    }
    if (!properties.investment_type && (props.investmentType || props.investment_type)) {
      properties.investment_type = props.investmentType || props.investment_type
    }
    if (!properties.acquisition_survey && (props.acquisitionSurvey || props.acquisition_survey)) {
      properties.acquisition_survey = props.acquisitionSurvey || props.acquisition_survey
    }

    // Account properties (if available in events)
    if (props.availableCopyCredits !== undefined || props.available_copy_credits !== undefined) {
      properties.available_copy_credits = parseFloat(props.availableCopyCredits || props.available_copy_credits || 0)
    }
    if (props.buyingPower !== undefined || props.buying_power !== undefined) {
      properties.buying_power = parseFloat(props.buyingPower || props.buying_power || 0)
    }

    // Portfolio properties (if available)
    if (props.activeCreatedPortfolios !== undefined || props.active_created_portfolios !== undefined) {
      properties.active_created_portfolios = parseInt(props.activeCreatedPortfolios || props.active_created_portfolios || 0)
    }
    if (props.lifetimeCreatedPortfolios !== undefined || props.lifetime_created_portfolios !== undefined) {
      properties.lifetime_created_portfolios = parseInt(props.lifetimeCreatedPortfolios || props.lifetime_created_portfolios || 0)
    }
  }

  return properties
}

/**
 * Count events to calculate metrics
 * Maps event names to metric columns
 */
function countEventMetrics(events: MixpanelEvent[]): Partial<UserProfile> {
  const metrics: Partial<UserProfile> = {
    total_copies: 0,
    total_pdp_views: 0,
    total_creator_profile_views: 0,
    total_ach_transfers: 0,
    paywall_views: 0,
    total_subscriptions: 0,
    app_sessions: 0,
    discover_tab_views: 0,
    stripe_modal_views: 0,
    creator_card_taps: 0,
    portfolio_card_taps: 0,
    linked_bank_account: false,
  }

  // Count each event type
  for (const event of events) {
    switch (event.event) {
      case 'DubAutoCopyInitiated':
        metrics.total_copies!++
        break

      case 'Viewed Portfolio Details':
        metrics.total_pdp_views!++
        break

      case 'Viewed Creator Profile':
        metrics.total_creator_profile_views!++
        break

      case 'AchTransferInitiated':
        metrics.total_ach_transfers!++
        break

      case 'Viewed Creator Paywall':
        metrics.paywall_views!++
        break

      case 'SubscriptionCreated':
        metrics.total_subscriptions!++
        break

      case '$ae_session':
        metrics.app_sessions!++
        break

      case 'Viewed Discover Tab':
        metrics.discover_tab_views!++
        break

      case 'Viewed Stripe Modal':
        metrics.stripe_modal_views!++
        break

      case 'Tapped Creator Card':
        metrics.creator_card_taps!++
        break

      case 'Tapped Portfolio Card':
        metrics.portfolio_card_taps!++
        break

      case 'BankAccountLinked':
        metrics.linked_bank_account = true
        break

      default:
        // Unknown event type - skip
        break
    }
  }

  return metrics
}

/**
 * Format user profiles for database insertion
 * Ensures all required fields are present and properly typed
 */
export function formatProfilesForDB(profiles: UserProfile[], syncedAt: string): any[] {
  return profiles.map(profile => ({
    distinct_id: profile.distinct_id,

    // User properties
    income: profile.income || null,
    net_worth: profile.net_worth || null,
    investing_activity: profile.investing_activity || null,
    investing_experience_years: profile.investing_experience_years || null,
    investing_objective: profile.investing_objective || null,
    investment_type: profile.investment_type || null,
    acquisition_survey: profile.acquisition_survey || null,

    // Account properties
    linked_bank_account: profile.linked_bank_account || false,
    available_copy_credits: profile.available_copy_credits || 0,
    buying_power: profile.buying_power || 0,

    // Financial metrics
    total_deposits: profile.total_deposits || 0,
    total_deposit_count: profile.total_deposit_count || 0,
    total_withdrawals: profile.total_withdrawals || 0,
    total_withdrawal_count: profile.total_withdrawal_count || 0,

    // Portfolio metrics
    active_created_portfolios: profile.active_created_portfolios || 0,
    lifetime_created_portfolios: profile.lifetime_created_portfolios || 0,

    // Event-counted metrics
    total_copies: profile.total_copies || 0,
    total_pdp_views: profile.total_pdp_views || 0,
    total_creator_profile_views: profile.total_creator_profile_views || 0,
    total_ach_transfers: profile.total_ach_transfers || 0,
    paywall_views: profile.paywall_views || 0,
    total_subscriptions: profile.total_subscriptions || 0,
    app_sessions: profile.app_sessions || 0,
    discover_tab_views: profile.discover_tab_views || 0,
    stripe_modal_views: profile.stripe_modal_views || 0,
    creator_card_taps: profile.creator_card_taps || 0,
    portfolio_card_taps: profile.portfolio_card_taps || 0,

    // Unavailable metrics
    leaderboard_tab_views: profile.leaderboard_tab_views || 0,
    premium_tab_views: profile.premium_tab_views || 0,

    // Metadata
    updated_at: syncedAt,
    events_processed: profile.events_processed || 0,
    first_event_time: profile.first_event_time,
    last_event_time: profile.last_event_time,
  }))
}
