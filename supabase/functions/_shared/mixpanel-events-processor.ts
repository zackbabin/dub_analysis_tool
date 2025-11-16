/**
 * Mixpanel Event Processing Module
 * Processes raw events from Export API into user profiles for subscribers_insights
 *
 * Key differences from Insights API:
 * - Metrics are counted from events (not pre-aggregated)
 * - User properties NOT available in Export API (events only have distinct_id)
 * - Premium/regular splits determined by creatorType property in events
 */

export interface MixpanelEvent {
  event: string
  properties: {
    $distinct_id: string
    distinct_id?: string
    time: number  // Unix timestamp (seconds)
    creatorType?: string  // Used to determine premium vs regular
    [key: string]: any  // Event-specific properties
  }
}

export interface UserProfile {
  distinct_id: string

  // User properties (placeholder for future implementation - not in Export API)
  income?: string
  net_worth?: string
  investing_activity?: string
  investing_experience_years?: number
  investing_objective?: string
  investment_type?: string
  acquisition_survey?: string

  // Account properties (from specific events)
  linked_bank_account: boolean
  available_copy_credits?: number
  buying_power?: number

  // Financial metrics (placeholder for future implementation)
  total_deposits?: number
  total_deposit_count?: number
  total_withdrawals?: number
  total_withdrawal_count?: number

  // Portfolio metrics (placeholder for future implementation)
  active_created_portfolios?: number
  lifetime_created_portfolios?: number

  // Event-counted metrics - matching subscribers_insights schema
  total_copies: number
  total_regular_copies: number
  total_premium_copies: number
  regular_pdp_views: number
  premium_pdp_views: number
  regular_creator_profile_views: number
  premium_creator_profile_views: number

  // Event-counted metrics - No premium/regular split
  total_ach_transfers: number
  paywall_views: number
  total_subscriptions: number
  app_sessions: number
  stripe_modal_views: number
  creator_card_taps: number
  portfolio_card_taps: number

  // Metadata
  updated_at: string
  events_processed: number
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
  // Count events for metrics
  const eventMetrics = countEventMetrics(events)

  return {
    distinct_id: distinctId,
    ...eventMetrics,
    updated_at: new Date().toISOString(),
    events_processed: events.length,
  }
}

/**
 * Helper function to check if an event is related to a premium creator
 * Checks creatorType property for "premiumCreator" or contains "premium"
 */
function isPremiumEvent(event: MixpanelEvent): boolean {
  const creatorType = event.properties.creatorType
  if (!creatorType) return false

  const typeStr = String(creatorType).toLowerCase()
  return typeStr === 'premiumcreator' || typeStr.includes('premium')
}

/**
 * Count events to calculate metrics
 * Maps event names to metric columns
 * Categorizes portfolio/creator views and copies as premium vs regular
 */
function countEventMetrics(events: MixpanelEvent[]): Partial<UserProfile> {
  const metrics: Partial<UserProfile> = {
    // Event metrics matching subscribers_insights schema
    total_copies: 0,
    total_regular_copies: 0,
    total_premium_copies: 0,
    regular_pdp_views: 0,
    premium_pdp_views: 0,
    regular_creator_profile_views: 0,
    premium_creator_profile_views: 0,

    // No split metrics
    total_ach_transfers: 0,
    paywall_views: 0,
    total_subscriptions: 0,
    app_sessions: 0,
    stripe_modal_views: 0,
    creator_card_taps: 0,
    portfolio_card_taps: 0,
    linked_bank_account: false,
  }

  // Count each event type
  for (const event of events) {
    const isPremium = isPremiumEvent(event)

    switch (event.event) {
      case 'DubAutoCopyInitiated':
        // Map to total_copies AND split by creatorType
        metrics.total_copies!++
        if (isPremium) {
          metrics.total_premium_copies!++
        } else {
          metrics.total_regular_copies!++
        }
        break

      case 'Viewed Portfolio Details':
        // Check creatorType for premium/regular split
        if (isPremium) {
          metrics.premium_pdp_views!++
        } else {
          metrics.regular_pdp_views!++
        }
        break

      case 'Viewed Creator Profile':
        // Check creatorType for premium/regular split
        if (isPremium) {
          metrics.premium_creator_profile_views!++
        } else {
          metrics.regular_creator_profile_views!++
        }
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

    // Account properties
    linked_bank_account: profile.linked_bank_account || false,

    // Event-counted metrics - matching subscribers_insights schema
    total_copies: profile.total_copies || 0,
    total_regular_copies: profile.total_regular_copies || 0,
    total_premium_copies: profile.total_premium_copies || 0,
    regular_pdp_views: profile.regular_pdp_views || 0,
    premium_pdp_views: profile.premium_pdp_views || 0,
    regular_creator_profile_views: profile.regular_creator_profile_views || 0,
    premium_creator_profile_views: profile.premium_creator_profile_views || 0,

    // Event-counted metrics - No split
    total_ach_transfers: profile.total_ach_transfers || 0,
    paywall_views: profile.paywall_views || 0,
    total_subscriptions: profile.total_subscriptions || 0,
    app_sessions: profile.app_sessions || 0,
    stripe_modal_views: profile.stripe_modal_views || 0,
    creator_card_taps: profile.creator_card_taps || 0,
    portfolio_card_taps: profile.portfolio_card_taps || 0,

    // Metadata
    updated_at: syncedAt,
    events_processed: profile.events_processed || 0,
  }))
}
