// Supabase Edge Function: sync-creator-data
// Fetches premium creator portfolio metrics from Mixpanel Insights API
// Syncs portfolio-level metrics (copies, subscriptions, performance) to database tables
// Refreshes materialized views for Premium Creator Analysis dashboard

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
  premiumCreators: '85725073',  // Premium Creators list (creators with subscription products)
  premiumCreatorSubscriptionMetrics: '85821646',  // Premium Creator Subscription Metrics (creator-level: subscriptions, paywall views, stripe modal views, cancellations)
  portfolioCreatorCopyMetrics: '86055000',  // Portfolio-Creator Copy/Liquidation aggregates (not user-level)
  // Note: Chart 85810770 (Portfolio Metrics) is no longer used - all portfolio metrics aggregated from user_portfolio_creator_engagement
  // Note: Chart 85130412 (Creator User Profiles) is no longer used - creators_insights table was removed due to timeouts and unused data
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

        // User profile data is no longer fetched - creators_insights table was removed
        userProfileData = null

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
      // Pass premiumCreatorRows to look up missing creator_ids by username
      const creatorMetricsRows = processSubscriptionMetrics(subscriptionMetricsData, premiumCreatorRows)
      console.log(`Processed subscription metrics for ${creatorMetricsRows.length} creators`)

      // Store creator-level metrics in separate table with change detection
      if (creatorMetricsRows.length > 0) {
        console.log('Upserting premium creator-level metrics with change detection...')

        // CHANGE DETECTION: Fetch existing metrics to avoid unnecessary writes
        let metricsToUpsert = creatorMetricsRows
        let skippedUnchanged = 0

        try {
          // Fetch latest metrics for each creator (most recent synced_at per creator_id)
          const creatorIds = creatorMetricsRows.map(r => r.creator_id)

          // Get the most recent record for each creator_id
          const { data: existingMetrics, error: fetchError } = await supabase
            .from('premium_creator_metrics')
            .select('creator_id, total_subscriptions, total_paywall_views, total_stripe_modal_views, total_cancellations')
            .in('creator_id', creatorIds)
            .order('synced_at', { ascending: false })

          if (fetchError) {
            console.warn(`⚠️ Change detection fetch failed, upserting all records as fallback:`, fetchError.message)
          } else if (existingMetrics && existingMetrics.length > 0) {
            // Create map of creator_id -> latest metrics (dedupe to get only most recent per creator)
            const existingMap = new Map()
            for (const record of existingMetrics) {
              if (!existingMap.has(record.creator_id)) {
                existingMap.set(record.creator_id, record)
              }
            }

            // Filter to only creators whose metrics have changed
            metricsToUpsert = creatorMetricsRows.filter(newRecord => {
              const existing = existingMap.get(newRecord.creator_id)

              if (!existing) {
                // New creator - needs insert
                return true
              }

              // Check if any metric has changed
              const hasChanged =
                existing.total_subscriptions !== newRecord.total_subscriptions ||
                existing.total_paywall_views !== newRecord.total_paywall_views ||
                existing.total_stripe_modal_views !== newRecord.total_stripe_modal_views ||
                existing.total_cancellations !== newRecord.total_cancellations

              if (!hasChanged) {
                skippedUnchanged++
              }

              return hasChanged
            })

            if (skippedUnchanged > 0) {
              console.log(`📊 Change detection: ${skippedUnchanged} unchanged creators skipped, ${metricsToUpsert.length} creators with changes to upsert`)
            }
          }
        } catch (changeDetectionError) {
          console.warn(`⚠️ Change detection error, upserting all records as fallback:`, changeDetectionError)
          metricsToUpsert = creatorMetricsRows
        }

        // Upsert only creators with changed metrics
        if (metricsToUpsert.length > 0) {
          const { error: creatorMetricsError } = await supabase
            .from('premium_creator_metrics')
            .upsert(metricsToUpsert, {
              onConflict: 'creator_id,synced_at',
              ignoreDuplicates: false,
            })

          if (creatorMetricsError) {
            console.error('Error upserting creator metrics:', creatorMetricsError)
            throw creatorMetricsError
          }

          const efficiency = skippedUnchanged > 0
            ? ` (${Math.round((skippedUnchanged / creatorMetricsRows.length) * 100)}% unchanged)`
            : ''
          console.log(`✅ Upserted ${metricsToUpsert.length} creator-level metrics rows${efficiency}`)
        } else {
          console.log(`✅ All ${creatorMetricsRows.length} creator metrics unchanged (skipped upsert)`)
        }
      }

      // Process and upsert portfolio-creator copy metrics with change detection
      if (portfolioCreatorCopyMetricsData) {
        console.log('Processing portfolio-creator copy metrics...')
        const copyMetricsRows = processPortfolioCreatorCopyMetrics(
          portfolioCreatorCopyMetricsData,
          syncStartTime.toISOString()
        )

        if (copyMetricsRows.length > 0) {
          console.log('Upserting portfolio-creator copy metrics with change detection...')

          // CHANGE DETECTION: Fetch existing copy metrics to avoid unnecessary writes
          let copyMetricsToUpsert = copyMetricsRows
          let skippedUnchangedCopy = 0

          try {
            // Build composite keys for lookup
            const compositeKeys = copyMetricsRows.map(r => `${r.portfolio_ticker}|${r.creator_id}`)

            // Fetch existing records
            const portfolioTickers = [...new Set(copyMetricsRows.map(r => r.portfolio_ticker))]
            const { data: existingCopyMetrics, error: fetchError } = await supabase
              .from('portfolio_creator_copy_metrics')
              .select('portfolio_ticker, creator_id, total_copies, total_liquidations')
              .in('portfolio_ticker', portfolioTickers)

            if (fetchError) {
              console.warn(`⚠️ Change detection fetch failed, upserting all records as fallback:`, fetchError.message)
            } else if (existingCopyMetrics && existingCopyMetrics.length > 0) {
              // Create map of composite key -> existing metrics
              const existingCopyMap = new Map()
              for (const record of existingCopyMetrics) {
                const key = `${record.portfolio_ticker}|${record.creator_id}`
                existingCopyMap.set(key, record)
              }

              // Filter to only records with changed metrics
              copyMetricsToUpsert = copyMetricsRows.filter((newRecord, idx) => {
                const existing = existingCopyMap.get(compositeKeys[idx])

                if (!existing) {
                  // New portfolio-creator pair - needs insert
                  return true
                }

                // Check if metrics have changed
                const hasChanged =
                  existing.total_copies !== newRecord.total_copies ||
                  existing.total_liquidations !== newRecord.total_liquidations

                if (!hasChanged) {
                  skippedUnchangedCopy++
                }

                return hasChanged
              })

              if (skippedUnchangedCopy > 0) {
                console.log(`📊 Change detection: ${skippedUnchangedCopy} unchanged portfolio-creator pairs skipped, ${copyMetricsToUpsert.length} pairs with changes to upsert`)
              }
            }
          } catch (changeDetectionError) {
            console.warn(`⚠️ Change detection error, upserting all records as fallback:`, changeDetectionError)
            copyMetricsToUpsert = copyMetricsRows
          }

          // Upsert only changed records
          if (copyMetricsToUpsert.length > 0) {
            const { error: copyMetricsError } = await supabase
              .from('portfolio_creator_copy_metrics')
              .upsert(copyMetricsToUpsert, {
                onConflict: 'portfolio_ticker,creator_id',
                ignoreDuplicates: false,
              })

            if (copyMetricsError) {
              console.error('Error upserting portfolio-creator copy metrics:', copyMetricsError)
              throw copyMetricsError
            }

            const efficiency = skippedUnchangedCopy > 0
              ? ` (${Math.round((skippedUnchangedCopy / copyMetricsRows.length) * 100)}% unchanged)`
              : ''
            console.log(`✅ Upserted ${copyMetricsToUpsert.length} portfolio-creator copy metrics rows${efficiency}`)
          } else {
            console.log(`✅ All ${copyMetricsRows.length} portfolio-creator copy metrics unchanged (skipped upsert)`)
          }
        }
      }

      // COMMENTED OUT: User profile data processing is skipped since data isn't stored anywhere
      // const enrichmentRows = processUserProfileData(userProfileData, null, stats)
      // console.log(`Processed ${enrichmentRows.length} creator enrichment rows`)
      // console.log(`Stats: ${stats.totalMixpanelUsers} total users, ${stats.matchedCreators} matched creators`)

      // Note: creators_insights table has been removed - enrichment data is no longer stored separately
      // Setting stats to 0 since we're not processing this data anymore
      stats.totalMixpanelUsers = 0
      stats.matchedCreators = 0
      stats.enrichedCreators = 0
      console.log('ℹ️ User profile enrichment skipped (data not stored/used)')

      console.log('Creator enrichment sync completed successfully')

      // Refresh materialized views asynchronously (fire-and-forget)
      // This can take a long time, so don't wait for it
      console.log('Triggering materialized view refresh (async)...')
      supabase.rpc('refresh_portfolio_engagement_views').then(({ error: refreshError }) => {
        if (refreshError) {
          console.error('⚠️ Error refreshing materialized views:', refreshError.message)
        } else {
          console.log('✅ Materialized views refreshed in background')
        }
      })
      console.log('✓ Materialized view refresh triggered')

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

    // Collect ALL numeric creator IDs for this username with their metric values
    const creatorIdsWithMetrics: Array<{ id: string, metricValue: number }> = []

    for (const [key, value] of Object.entries(usernameData as any)) {
      // Creator IDs are numeric strings, skip $overall and other non-numeric keys
      if (key !== '$overall' && /^\d+$/.test(key)) {
        // Extract metric value (should be in value.all or just value)
        let metricValue = 0
        if (typeof value === 'object' && value !== null && 'all' in value) {
          metricValue = Number(value.all) || 0
        } else {
          metricValue = Number(value) || 0
        }
        creatorIdsWithMetrics.push({ id: key, metricValue })
      }
    }

    // Select creator_id (or use username as fallback if no numeric ID found)
    let selectedCreatorId: string
    let metricValue = 0

    if (creatorIdsWithMetrics.length > 0) {
      // If multiple creator IDs exist, prioritize 18-digit IDs
      if (creatorIdsWithMetrics.length > 1) {
        // Prefer 18-digit IDs
        const longIds = creatorIdsWithMetrics.filter(item => item.id.length >= 18)
        const selected = longIds.length > 0 ? longIds[0] : creatorIdsWithMetrics[0]
        selectedCreatorId = selected.id
        metricValue = selected.metricValue
        console.log(`ℹ️ ${creatorUsername} has multiple IDs: [${creatorIdsWithMetrics.map(i => i.id).join(', ')}], selected: ${selectedCreatorId}`)
      } else {
        selectedCreatorId = creatorIdsWithMetrics[0].id
        metricValue = creatorIdsWithMetrics[0].metricValue
      }
      console.log(`✅ Added ${creatorUsername} with creator_id ${selectedCreatorId}, metric: ${metricValue}`)
    } else {
      // No numeric creator_id found - use username as fallback
      // This ensures we don't skip ANY premium creators from Mixpanel
      selectedCreatorId = creatorUsername
      console.log(`⚠️ No numeric creator_id found for ${creatorUsername}`)
      console.log(`⚠️ Available keys:`, keys)
      console.log(`⚠️ Using username as creator_id fallback`)
    }

    rows.push({
      creator_id: String(selectedCreatorId),
      creator_username: String(creatorUsername),
      metric_value: metricValue,
      synced_at: now,
    })
  }

  // Two-phase deduplication:
  // 1. Deduplicate by creator_username - keep ONE creator_id per username (prefer 18-digit IDs)
  // 2. Deduplicate by creator_id - keep ONE username per ID (prefer highest metric value)

  console.log(`Starting deduplication: ${rows.length} total rows`)

  // Phase 1: Deduplicate by username
  const usernameToRows = new Map<string, any[]>()
  for (const row of rows) {
    if (!usernameToRows.has(row.creator_username)) {
      usernameToRows.set(row.creator_username, [])
    }
    usernameToRows.get(row.creator_username)!.push(row)
  }

  const dedupedByUsername: any[] = []
  for (const [username, userRows] of usernameToRows.entries()) {
    if (userRows.length === 1) {
      dedupedByUsername.push(userRows[0])
    } else {
      // Multiple creator_ids for same username - prefer 18-digit ID
      const longIdRows = userRows.filter(r => r.creator_id.length >= 18)
      const selectedRow = longIdRows.length > 0 ? longIdRows[0] : userRows[0]

      const allIds = userRows.map(r => r.creator_id).join(', ')
      console.log(`⚠️ Deduping by username ${username}: found IDs [${allIds}], selected ${selectedRow.creator_id}`)
      dedupedByUsername.push(selectedRow)
    }
  }

  console.log(`After username dedup: ${dedupedByUsername.length} rows`)

  // Phase 2: Deduplicate by creator_id (same ID with multiple usernames)
  const idToRows = new Map<string, any[]>()
  for (const row of dedupedByUsername) {
    if (!idToRows.has(row.creator_id)) {
      idToRows.set(row.creator_id, [])
    }
    idToRows.get(row.creator_id)!.push(row)
  }

  const finalRows: any[] = []
  for (const [creatorId, idRows] of idToRows.entries()) {
    if (idRows.length === 1) {
      // Remove metric_value before pushing (not a DB column)
      const { metric_value, ...rowWithoutMetric } = idRows[0]
      finalRows.push(rowWithoutMetric)
    } else {
      // Multiple usernames for same creator_id - prefer username with highest metric value
      const sortedByMetric = [...idRows].sort((a, b) => b.metric_value - a.metric_value)
      const selectedRow = sortedByMetric[0]

      const allUsernames = idRows.map(r => `${r.creator_username}(${r.metric_value})`).join(', ')
      console.log(`⚠️ Deduping by creator_id ${creatorId}: found usernames [${allUsernames}], selected ${selectedRow.creator_username} with metric ${selectedRow.metric_value}`)

      // Remove metric_value before pushing (not a DB column)
      const { metric_value, ...rowWithoutMetric } = selectedRow
      finalRows.push(rowWithoutMetric)
    }
  }

  console.log(`Processed ${rows.length} premium creators from Mixpanel (${finalRows.length} after deduplication)`)
  console.log('Final premium creators:', finalRows.map(r => r.creator_username).join(', '))
  return finalRows
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
 * When a creator has duplicate entries (e.g., @dubAdvisors with both 18-digit ID and non-numeric key),
 * we COMBINE (sum) the metrics from all entries and store ONE row per username with a single
 * creator_id (preferring 18-digit IDs).
 *
 * If a username has metrics but no valid 18-digit creator_id in the chart data,
 * we look up the creator_id from the premiumCreators list.
 *
 * Returns array of creator-level metric rows for premium_creator_metrics table
 */
function processSubscriptionMetrics(data: any, premiumCreators: any[] = []): any[] {
  const rows: any[] = []
  const now = new Date().toISOString()

  // Create username -> creator_id lookup from premium creators list
  const usernameToCreatorId = new Map<string, string>()
  for (const creator of premiumCreators) {
    if (creator.creator_username && creator.creator_id && creator.creator_id.length >= 18) {
      usernameToCreatorId.set(creator.creator_username, creator.creator_id)
    }
  }

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
    const nonNumericKeys: string[] = []
    let totalSubscriptions = 0
    let totalPaywallViews = 0
    let totalStripeModalViews = 0
    let totalCancellations = 0

    // Extract metrics helper function
    const getMetricValue = (metricData: any, creatorId: string): number => {
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

    // Find all creator_ids for this username and sum metrics (combine duplicates)
    for (const [creatorId, creatorIdData] of Object.entries(usernameData as any)) {
      if (creatorId === '$overall') continue
      if (typeof creatorIdData !== 'object') continue

      // Check if this is a valid 18-digit creator_id
      if (/^\d{18}$/.test(creatorId)) {
        creatorIds.push(creatorId)

        // Sum metrics across all creator_ids (combine duplicates like @dubAdvisors)
        totalSubscriptions += getMetricValue(metrics.subscriptions, creatorId)
        totalPaywallViews += getMetricValue(metrics.paywallViews, creatorId)
        totalStripeModalViews += getMetricValue(metrics.stripeModalViews, creatorId)
        totalCancellations += getMetricValue(metrics.cancellations, creatorId)
      } else {
        // Track non-numeric keys - might still have metrics
        nonNumericKeys.push(creatorId)

        // Sum metrics even from non-numeric keys (combine duplicates)
        totalSubscriptions += getMetricValue(metrics.subscriptions, creatorId)
        totalPaywallViews += getMetricValue(metrics.paywallViews, creatorId)
        totalStripeModalViews += getMetricValue(metrics.stripeModalViews, creatorId)
        totalCancellations += getMetricValue(metrics.cancellations, creatorId)
      }
    }

    // If no valid 18-digit creator_ids found in chart data, look up from premium creators list
    if (creatorIds.length === 0 && totalSubscriptions > 0) {
      const lookupId = usernameToCreatorId.get(creatorUsername)
      if (lookupId) {
        creatorIds.push(lookupId)
        const keyInfo = nonNumericKeys.length > 0 ? ` (found metrics under keys: ${nonNumericKeys.join(', ')})` : ''
        console.log(`ℹ️ Creator ${creatorUsername} has no valid 18-digit creator_id in chart data${keyInfo} - using ${lookupId} from premium creators list`)
      } else {
        console.warn(`⚠️ Skipping creator ${creatorUsername} - has metrics (${totalSubscriptions} subscriptions) but no valid creator_id found in chart data or premium creators list`)
      }
    }

    if (creatorIds.length > 0) {
      // Select single creator_id (prefer 18-digit IDs)
      const selected18DigitId = creatorIds.find(id => id.length >= 18)
      const selectedCreatorId = selected18DigitId || creatorIds[0]

      usernameMetrics.set(creatorUsername, {
        creator_id: selectedCreatorId,
        total_subscriptions: totalSubscriptions,
        total_paywall_views: totalPaywallViews,
        total_stripe_modal_views: totalStripeModalViews,
        total_cancellations: totalCancellations
      })

      if (creatorIds.length > 1) {
        console.log(`⚠️ Creator ${creatorUsername} has ${creatorIds.length} creator_ids [${creatorIds.join(', ')}] - combining metrics (${totalSubscriptions} total subscriptions) and using ${selectedCreatorId}`)
      }
    }
  }

  // Second pass: create one row per username with the aggregated metrics and selected creator_id
  for (const [creatorUsername, metrics] of usernameMetrics.entries()) {
    rows.push({
      creator_id: String(metrics.creator_id),
      creator_username: String(creatorUsername),
      total_subscriptions: metrics.total_subscriptions,
      total_paywall_views: metrics.total_paywall_views,
      total_stripe_modal_views: metrics.total_stripe_modal_views,
      total_cancellations: metrics.total_cancellations,
      synced_at: now,
    })
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
