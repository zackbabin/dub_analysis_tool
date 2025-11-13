// Supabase Edge Function: sync-creator-data
// Fetches user profile data from Mixpanel Insights API
// Enriches uploaded creators with Mixpanel user attributes
// Stores data in creators_insights table

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { fetchInsightsData, type MixpanelCredentials } from '../_shared/mixpanel-api.ts'
import { processPortfolioCreatorCopyMetrics } from '../_shared/data-processing.ts'
import {
  initializeMixpanelCredentials,
  initializeSupabaseClient,
  handleCorsRequest,
  checkAndHandleSkipSync,
  createSyncLog,
  updateSyncLogSuccess,
  updateSyncLogFailure,
  handleRateLimitError,
  createSuccessResponse,
  createErrorResponse,
} from '../_shared/sync-helpers.ts'

// Mixpanel Chart IDs
const CHART_IDS = {
  creatorProfiles: '85130412',  // User profile data for creators
  premiumCreators: '85725073',  // Premium Creators list (creators with subscription products)
  premiumCreatorSubscriptionMetrics: '85821646',  // Premium Creator Subscription Metrics (creator-level: subscriptions, paywall views, stripe modal views, cancellations)
  portfolioCreatorCopyMetrics: '86055000',  // Portfolio-Creator Copy/Liquidation aggregates (not user-level)
  // Note: Chart 85810770 (Portfolio Metrics) is no longer used - all portfolio metrics aggregated from user_portfolio_creator_engagement
}

interface SyncStats {
  totalMixpanelUsers: number
  matchedCreators: number
  enrichedCreators: number
  premiumCreatorsCount: number
  premiumPortfolioMetricsCount: number
}

serve(async (req) => {
  // Handle CORS preflight requests
  const corsResponse = handleCorsRequest(req)
  if (corsResponse) return corsResponse

  try {
    // Initialize Mixpanel credentials and Supabase client
    const credentials = initializeMixpanelCredentials()
    const supabase = initializeSupabaseClient()

    console.log('Starting Creator enrichment sync...')

    // Check if sync should be skipped (within 1-hour window)
    const skipResponse = await checkAndHandleSkipSync(supabase, 'mixpanel_user_profiles', 1)
    if (skipResponse) return skipResponse

    // Create sync log entry
    const { syncLog, syncStartTime } = await createSyncLog(supabase, 'creator', 'mixpanel_user_profiles')
    const syncLogId = syncLog.id

    try {
      let premiumCreatorsData, userProfileData, subscriptionMetricsData, portfolioCreatorCopyMetricsData

      try {
        // Fetch premium creators list from Mixpanel
        console.log(`Fetching premium creators from Mixpanel chart ${CHART_IDS.premiumCreators}...`)
        premiumCreatorsData = await fetchInsightsData(credentials, CHART_IDS.premiumCreators, 'Premium Creators')

        // Fetch user profile data from Mixpanel
        console.log(`Fetching user profile data from Mixpanel chart ${CHART_IDS.creatorProfiles}...`)
        userProfileData = await fetchInsightsData(credentials, CHART_IDS.creatorProfiles, 'User Profiles')

        // Note: Portfolio metrics (PDP views, copies, liquidations) are now aggregated from user-level data
        // No need to fetch chart 85810770 - premium_creator_portfolio_metrics table is deprecated

        // Fetch premium creator subscription metrics from Mixpanel (creator-level)
        console.log(`Fetching premium creator subscription metrics from Mixpanel chart ${CHART_IDS.premiumCreatorSubscriptionMetrics}...`)
        subscriptionMetricsData = await fetchInsightsData(credentials, CHART_IDS.premiumCreatorSubscriptionMetrics, 'Premium Creator Subscription Metrics')

        // Fetch portfolio-creator copy/liquidation metrics (aggregated, not user-level)
        console.log(`Fetching portfolio-creator copy metrics from Mixpanel chart ${CHART_IDS.portfolioCreatorCopyMetrics}...`)
        portfolioCreatorCopyMetricsData = await fetchInsightsData(credentials, CHART_IDS.portfolioCreatorCopyMetrics, 'Portfolio-Creator Copy/Liquidation Metrics')

        console.log('All Mixpanel data fetched successfully')
      } catch (error: any) {
        // Handle Mixpanel rate limit errors gracefully
        const rateLimitResponse = await handleRateLimitError(supabase, syncLogId, error, {
          totalMixpanelUsers: 0,
          matchedCreators: 0,
          enrichedCreators: 0,
          premiumCreatorsCount: 0,
          premiumPortfolioMetricsCount: 0,
        })
        if (rateLimitResponse) return rateLimitResponse
        throw error
      }

      // Process ALL Mixpanel data (no filtering)
      console.log('Processing all Mixpanel user profiles...')

      const stats: SyncStats = {
        totalMixpanelUsers: 0,
        matchedCreators: 0,
        enrichedCreators: 0,
        premiumCreatorsCount: 0,
        premiumPortfolioMetricsCount: 0, // Deprecated but keeping for backwards compatibility
      }

      // Process premium creators data
      const premiumCreatorRows = processPremiumCreatorsData(premiumCreatorsData)
      stats.premiumCreatorsCount = premiumCreatorRows.length
      console.log(`Processed ${premiumCreatorRows.length} premium creators`)

      // Store premium creators in database
      if (premiumCreatorRows.length > 0) {
        console.log('Upserting premium creators...')
        const { error: premiumError } = await supabase
          .from('premium_creators')
          .upsert(premiumCreatorRows, {
            onConflict: 'creator_id',
            ignoreDuplicates: false,
          })

        if (premiumError) {
          console.error('Error upserting premium creators:', premiumError)
          throw premiumError
        }
        console.log(`✅ Upserted ${premiumCreatorRows.length} premium creators`)
      }

      // Portfolio metrics are now aggregated from user_portfolio_creator_engagement
      // No longer syncing premium_creator_portfolio_metrics table
      console.log('ℹ️ Portfolio metrics (PDP views, copies, liquidations) aggregated from user-level data')

      // Process subscription metrics (creator-level: subscriptions, paywall views, stripe modal views, cancellations)
      const creatorMetricsRows = processSubscriptionMetrics(subscriptionMetricsData)
      console.log(`Processed subscription metrics for ${creatorMetricsRows.length} creators`)

      // Store creator-level metrics in separate table
      if (creatorMetricsRows.length > 0) {
        console.log('Upserting premium creator-level metrics...')
        const { error: creatorMetricsError } = await supabase
          .from('premium_creator_metrics')
          .upsert(creatorMetricsRows, {
            onConflict: 'creator_id,synced_at',
            ignoreDuplicates: false,
          })

        if (creatorMetricsError) {
          console.error('Error upserting creator metrics:', creatorMetricsError)
          throw creatorMetricsError
        }
        console.log(`✅ Upserted ${creatorMetricsRows.length} creator-level metrics rows`)
      }

      // Process and upsert portfolio-creator copy metrics
      if (portfolioCreatorCopyMetricsData) {
        console.log('Processing portfolio-creator copy metrics...')
        const copyMetricsRows = processPortfolioCreatorCopyMetrics(
          portfolioCreatorCopyMetricsData,
          syncStartTime.toISOString()
        )

        if (copyMetricsRows.length > 0) {
          const { error: copyMetricsError } = await supabase
            .from('portfolio_creator_copy_metrics')
            .upsert(copyMetricsRows, {
              onConflict: 'portfolio_ticker,creator_id',
              ignoreDuplicates: false,
            })

          if (copyMetricsError) {
            console.error('Error upserting portfolio-creator copy metrics:', copyMetricsError)
            throw copyMetricsError
          }
          console.log(`✅ Upserted ${copyMetricsRows.length} portfolio-creator copy metrics rows`)
        }
      }

      const enrichmentRows = processUserProfileData(userProfileData, null, stats)

      console.log(`Processed ${enrichmentRows.length} creator enrichment rows`)
      console.log(`Stats: ${stats.totalMixpanelUsers} total users, ${stats.matchedCreators} matched creators`)

      if (enrichmentRows.length > 0) {
        // Upsert enrichment data
        const batchSize = 500
        let totalProcessed = 0

        for (let i = 0; i < enrichmentRows.length; i += batchSize) {
          const batch = enrichmentRows.slice(i, i + batchSize)

          const { error: insertError } = await supabase
            .from('creators_insights')
            .upsert(batch, {
              onConflict: 'email',
              ignoreDuplicates: false,
            })

          if (insertError) {
            console.error('Error upserting enrichment batch:', insertError)
            throw insertError
          }

          totalProcessed += batch.length
          console.log(`Upserted batch: ${totalProcessed}/${enrichmentRows.length} records`)
        }

        stats.enrichedCreators = totalProcessed
      }

      console.log('Creator enrichment sync completed successfully')

      // Refresh materialized views to incorporate new portfolio metrics data
      console.log('Refreshing materialized views...')
      const { error: refreshError } = await supabase.rpc('refresh_portfolio_engagement_views')

      if (refreshError) {
        console.error('Error refreshing materialized views:', refreshError)
        // Don't throw - sync succeeded, just log the error
        console.log('⚠️ Materialized views may need manual refresh')
      } else {
        console.log('✅ Materialized views refreshed successfully')
      }

      // Note: Premium creator affinity is now computed via database views
      // See: premium_creator_affinity_display view
      console.log('✅ Premium creator affinity available via views')

      // Update sync log with success
      await updateSyncLogSuccess(supabase, syncLogId, {
        subscribers_fetched: stats.enrichedCreators,
        total_records_inserted: stats.enrichedCreators,
      }, syncStartTime)

      return createSuccessResponse(
        'Creator enrichment sync completed successfully',
        stats
      )
    } catch (error) {
      // Update sync log with failure
      await updateSyncLogFailure(supabase, syncLogId, error)
      throw error
    }
  } catch (error) {
    return createErrorResponse(error, 'sync-creator-data')
  }
})

// ============================================================================
// Helper Functions - Data Processing
// ============================================================================

function processUserProfileData(data: any, creatorEmails: Set<string> | null, stats: SyncStats): any[] {
  if (!data || !data.series) {
    console.log('No user profile data')
    return []
  }

  const rows: any[] = []

  console.log('Available series keys:', Object.keys(data.series))

  // Use one of the behavioral metrics to iterate through users and extract attributes from the nested keys
  // All metrics share the same grouping structure: Email -> totalDeposits -> activeCreatedPortfolios -> ...
  const rebalancesData = data.series['B. Total Rebalances'] || {}
  const sessionsData = data.series['C. Total Sessions'] || {}
  const leaderboardViewsData = data.series['D. Total Leaderboard Views'] || {}

  console.log('Behavioral metrics found:', {
    rebalances: Object.keys(rebalancesData).length - 1, // -1 for $overall
    sessions: Object.keys(sessionsData).length - 1,
    leaderboardViews: Object.keys(leaderboardViewsData).length - 1
  })

  // Use rebalances data as the source to iterate through all users
  for (const [email, emailData] of Object.entries(rebalancesData)) {
    if (email === '$overall') continue

    const normalizedEmail = email.toLowerCase().trim()
    stats.totalMixpanelUsers++

    // If creatorEmails filter is provided, check if email is in the list
    if (creatorEmails !== null && !creatorEmails.has(normalizedEmail)) {
      continue // Skip users not in uploaded creators
    }

    stats.matchedCreators++

    // Extract user attributes from nested grouping keys
    const attributes = extractUserAttributes(emailData as any)

    if (attributes) {
      // Extract behavioral metrics from $overall.all at email level
      const totalRebalances = extractBehavioralMetric(emailData)
      const totalSessions = extractBehavioralMetric(sessionsData[email])
      const totalLeaderboardViews = extractBehavioralMetric(leaderboardViewsData[email])

      rows.push({
        email: normalizedEmail,
        total_deposits: attributes.totalDeposits,
        active_created_portfolios: attributes.activeCreatedPortfolios,
        lifetime_created_portfolios: attributes.lifetimeCreatedPortfolios,
        total_trades: attributes.totalTrades,
        investing_activity: attributes.investingActivity,
        investing_experience_years: attributes.investingExperienceYears,
        investing_objective: attributes.investingObjective,
        investment_type: attributes.investmentType,
        // Behavioral metrics from $overall.all
        total_rebalances: totalRebalances,
        total_sessions: totalSessions,
        total_leaderboard_views: totalLeaderboardViews,
        synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
    }
  }

  console.log(`Processed ${rows.length} user profile rows`)
  return rows
}

function extractBehavioralMetric(emailData: any): number | null {
  // Extract numeric value from nested behavioral metric structure
  // The actual metric value is in the $overall.all field at the EMAIL level
  // Structure: email -> { "$overall": { "all": VALUE }, "nested_attributes": {...} }
  // We want the top-level $overall.all value for that email

  if (!emailData || typeof emailData !== 'object') {
    return null
  }

  try {
    // Check if this email has a top-level $overall.all value
    if (emailData.$overall && typeof emailData.$overall.all === 'number') {
      return emailData.$overall.all
    }

    return null
  } catch (error) {
    console.error('Error extracting behavioral metric:', error)
    return null
  }
}

function extractUserAttributes(data: any): any {
  // Navigate through the deeply nested structure
  // Structure: totalDeposits -> activeCreatedPortfolios -> lifetimeCreatedPortfolios -> totalTrades -> investingActivity -> investingExperienceYears -> investingObjective -> investmentType

  try {
    let current = data

    // Extract totalDeposits (key at level 1)
    const totalDepositsKeys = Object.keys(current).filter(k => k !== '$overall')
    if (totalDepositsKeys.length === 0) return null
    const totalDeposits = parseValue(totalDepositsKeys[0])
    current = current[totalDepositsKeys[0]]

    // Extract activeCreatedPortfolios (key at level 2)
    const activePortfoliosKeys = Object.keys(current).filter(k => k !== '$overall')
    if (activePortfoliosKeys.length === 0) return null
    const activeCreatedPortfolios = parseValue(activePortfoliosKeys[0])
    current = current[activePortfoliosKeys[0]]

    // Extract lifetimeCreatedPortfolios (key at level 3)
    const lifetimePortfoliosKeys = Object.keys(current).filter(k => k !== '$overall')
    if (lifetimePortfoliosKeys.length === 0) return null
    const lifetimeCreatedPortfolios = parseValue(lifetimePortfoliosKeys[0])
    current = current[lifetimePortfoliosKeys[0]]

    // Extract totalTrades (key at level 4)
    const totalTradesKeys = Object.keys(current).filter(k => k !== '$overall')
    if (totalTradesKeys.length === 0) return null
    const totalTrades = parseValue(totalTradesKeys[0])
    current = current[totalTradesKeys[0]]

    // Extract investingActivity (key at level 5)
    const investingActivityKeys = Object.keys(current).filter(k => k !== '$overall')
    if (investingActivityKeys.length === 0) return null
    const investingActivity = investingActivityKeys[0] === 'undefined' ? null : investingActivityKeys[0]
    current = current[investingActivityKeys[0]]

    // Extract investingExperienceYears (key at level 6)
    const experienceKeys = Object.keys(current).filter(k => k !== '$overall')
    if (experienceKeys.length === 0) return null
    const investingExperienceYears = experienceKeys[0] === 'undefined' ? null : experienceKeys[0]
    current = current[experienceKeys[0]]

    // Extract investingObjective (key at level 7)
    const objectiveKeys = Object.keys(current).filter(k => k !== '$overall')
    if (objectiveKeys.length === 0) return null
    const investingObjective = objectiveKeys[0] === 'undefined' ? null : objectiveKeys[0]
    current = current[objectiveKeys[0]]

    // Extract investmentType (key at level 8)
    const investmentTypeKeys = Object.keys(current).filter(k => k !== '$overall')
    if (investmentTypeKeys.length === 0) return null
    const investmentType = investmentTypeKeys[0] === 'undefined' ? null : investmentTypeKeys[0]

    return {
      totalDeposits,
      activeCreatedPortfolios,
      lifetimeCreatedPortfolios,
      totalTrades,
      investingActivity,
      investingExperienceYears,
      investingObjective,
      investmentType,
    }
  } catch (error) {
    console.error('Error extracting user attributes:', error)
    return null
  }
}

function parseValue(val: string): number | null {
  if (val === 'undefined' || val === 'null' || !val) return null
  const num = parseFloat(val)
  return isNaN(num) ? null : num
}

/**
 * Process premium creators data from Mixpanel
 * Extracts creator_id and creator_username from the nested chart response
 */
function processPremiumCreatorsData(data: any): any[] {
  if (!data || !data.series) {
    console.log('No premium creators data')
    return []
  }

  const rows: any[] = []
  const now = new Date().toISOString()

  // The data comes in nested format: series -> metric -> creatorUsername -> creatorId
  // Example: series["Uniques of Viewed Portfolio Details"]["@brettsimba"]["339489349854568448"]
  console.log('Processing premium creators from nested Mixpanel format...')

  // Get the metric data (should be the first/only metric)
  const metricKeys = Object.keys(data.series)
  if (metricKeys.length === 0) {
    console.log('No metrics found in series data')
    return []
  }

  const metricData = data.series[metricKeys[0]]
  console.log(`Found metric: ${metricKeys[0]}`)

  // DEBUG: Log all creator usernames found in the data
  const allUsernames = Object.keys(metricData).filter(k => k !== '$overall')
  console.log(`Found ${allUsernames.length} creator usernames in Mixpanel data:`, allUsernames)

  // Iterate through creator usernames (skip $overall)
  for (const [creatorUsername, usernameData] of Object.entries(metricData)) {
    if (creatorUsername === '$overall') continue
    if (typeof usernameData !== 'object') {
      console.log(`⚠️ Skipping ${creatorUsername}: usernameData is not an object`)
      continue
    }

    // DEBUG: Log the structure for this username
    const keys = Object.keys(usernameData as any)
    console.log(`Processing ${creatorUsername}, found keys:`, keys)

    // Find the creator_id (any numeric key, not just 18-digit)
    let foundCreatorId = false
    for (const [key, value] of Object.entries(usernameData as any)) {
      // Creator IDs are numeric strings, skip $overall and other non-numeric keys
      if (key !== '$overall' && /^\d+$/.test(key)) {
        rows.push({
          creator_id: String(key),
          creator_username: String(creatorUsername),
          synced_at: now,
        })
        console.log(`✅ Added ${creatorUsername} with creator_id ${key}`)
        foundCreatorId = true
        break // Only take the first creator_id per username
      }
    }

    if (!foundCreatorId) {
      console.log(`⚠️ No creator_id found for ${creatorUsername}`)
    }
  }

  // Deduplicate by creator_id (primary key), but aggregate duplicate usernames
  const seenIds = new Set<string>()
  const seenUsernames = new Set<string>()
  const deduplicatedRows = rows.filter(row => {
    if (seenIds.has(row.creator_id)) {
      console.log(`⚠️ Duplicate creator_id found: ${row.creator_id} for ${row.creator_username}`)
      return false
    }
    if (seenUsernames.has(row.creator_username)) {
      console.log(`⚠️ Duplicate username found: ${row.creator_username} with different creator_id ${row.creator_id}`)
      // Keep the row - same username with different creator_id is valid
    }
    seenIds.add(row.creator_id)
    seenUsernames.add(row.creator_username)
    return true
  })

  console.log(`Processed ${rows.length} premium creators from Mixpanel (${deduplicatedRows.length} unique by creator_id)`)
  console.log('Final premium creators:', deduplicatedRows.map(r => r.creator_username).join(', '))
  return deduplicatedRows
}


/**
 * Process premium creator subscription metrics from Mixpanel chart 85821646
 * Extracts creator-level subscription metrics grouped by creatorUsername -> creatorId
 *
 * Data structure:
 * series -> metric -> creatorUsername -> creatorId -> {"all": value}
 *
 * Example:
 * series["A. Total Subscriptions"]["@brettsimba"]["339489349854568448"]["all"] = 121
 *
 * NOTE: Subscriptions are at the creator USERNAME level, not creator_id level.
 * When a creator has multiple creator_ids (e.g., @dubAdvisors), we take the max value
 * across all creator_ids to avoid double-counting, and store one row per creator_id
 * with the same subscription values (since they represent the same creator account).
 *
 * Returns array of creator-level metric rows for premium_creator_metrics table
 */
function processSubscriptionMetrics(data: any): any[] {
  const rows: any[] = []
  const now = new Date().toISOString()

  if (!data || !data.series) {
    console.log('No subscription metrics data')
    return rows
  }

  console.log('Processing subscription metrics from nested Mixpanel format...')
  console.log('Available metrics:', Object.keys(data.series))

  // Extract subscription-level metrics (A through D)
  const metrics = {
    subscriptions: data.series['A. Total Subscriptions'] || {},
    paywallViews: data.series['B. Total Paywall Views'] || {},
    stripeModalViews: data.series['C. Total Stripe Modal Views'] || {},
    cancellations: data.series['D. Total Cancellations'] || {},
  }

  // Use subscriptions as the primary metric to iterate
  const primaryMetric = metrics.subscriptions

  // First pass: aggregate metrics at username level (take max across creator_ids)
  const usernameMetrics = new Map<string, {
    creator_ids: string[],
    total_subscriptions: number,
    total_paywall_views: number,
    total_stripe_modal_views: number,
    total_cancellations: number
  }>()

  // Iterate through creator usernames
  for (const [creatorUsername, usernameData] of Object.entries(primaryMetric)) {
    if (creatorUsername === '$overall') continue
    if (typeof usernameData !== 'object') continue

    const creatorIds: string[] = []
    let maxSubscriptions = 0
    let maxPaywallViews = 0
    let maxStripeModalViews = 0
    let maxCancellations = 0

    // Find all creator_ids for this username and take max value
    for (const [creatorId, creatorIdData] of Object.entries(usernameData as any)) {
      if (creatorId === '$overall') continue
      if (!/^\d+$/.test(creatorId)) continue // Skip non-numeric keys
      if (typeof creatorIdData !== 'object') continue

      creatorIds.push(creatorId)

      // Extract metrics for this creator_id
      const getMetricValue = (metricData: any): number => {
        try {
          const value = metricData?.[creatorUsername]?.[creatorId]
          if (!value) return 0

          // Handle both object format {"all": 123} and direct number format
          if (typeof value === 'object' && value !== null && 'all' in value) {
            return parseInt(String(value.all)) || 0
          }

          return parseInt(String(value)) || 0
        } catch {
          return 0
        }
      }

      // Take maximum value across creator_ids (they should be the same, but handle edge cases)
      maxSubscriptions = Math.max(maxSubscriptions, getMetricValue(metrics.subscriptions))
      maxPaywallViews = Math.max(maxPaywallViews, getMetricValue(metrics.paywallViews))
      maxStripeModalViews = Math.max(maxStripeModalViews, getMetricValue(metrics.stripeModalViews))
      maxCancellations = Math.max(maxCancellations, getMetricValue(metrics.cancellations))
    }

    if (creatorIds.length > 0) {
      usernameMetrics.set(creatorUsername, {
        creator_ids: creatorIds,
        total_subscriptions: maxSubscriptions,
        total_paywall_views: maxPaywallViews,
        total_stripe_modal_views: maxStripeModalViews,
        total_cancellations: maxCancellations
      })

      if (creatorIds.length > 1) {
        console.log(`⚠️ Creator ${creatorUsername} has ${creatorIds.length} creator_ids - using max values to avoid double-counting`)
      }
    }
  }

  // Second pass: create one row per creator_id with the aggregated username-level metrics
  for (const [creatorUsername, metrics] of usernameMetrics.entries()) {
    for (const creatorId of metrics.creator_ids) {
      rows.push({
        creator_id: String(creatorId),
        creator_username: String(creatorUsername),
        total_subscriptions: metrics.total_subscriptions,
        total_paywall_views: metrics.total_paywall_views,
        total_stripe_modal_views: metrics.total_stripe_modal_views,
        total_cancellations: metrics.total_cancellations,
        synced_at: now,
      })
    }
  }

  console.log(`Processed subscription metrics for ${rows.length} creator_id rows (${usernameMetrics.size} unique usernames)`)
  return rows
}

// ============================================================================
// Affinity Computation - DEPRECATED
// ============================================================================
// Premium creator affinity is now computed via database views:
// - premium_creator_copy_affinity_base (non-pivoted data)
// - premium_creator_affinity_display (pivoted display format)
//
// The views use indexed queries on user_portfolio_creator_engagement
// and user_creator_engagement tables for optimal performance.
// ============================================================================
