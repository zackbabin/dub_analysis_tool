// Supabase Edge Function: sync-creator-data
// Fetches user profile data from Mixpanel Insights API
// Enriches uploaded creators with Mixpanel user attributes
// Stores data in creators_insights table

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4'
import { fetchInsightsData, CORS_HEADERS, type MixpanelCredentials } from '../_shared/mixpanel-api.ts'

// Mixpanel Chart IDs
const CHART_IDS = {
  creatorProfiles: '85130412',  // User profile data for creators
  premiumCreators: '85725073',  // Premium Creators list (creators with subscription products)
}

interface SyncStats {
  totalMixpanelUsers: number
  matchedCreators: number
  enrichedCreators: number
  premiumCreatorsCount: number
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    const mixpanelUsername = Deno.env.get('MIXPANEL_SERVICE_USERNAME')
    const mixpanelSecret = Deno.env.get('MIXPANEL_SERVICE_SECRET')

    if (!mixpanelUsername || !mixpanelSecret) {
      throw new Error('Mixpanel credentials not configured in Supabase secrets')
    }

    console.log('Mixpanel credentials loaded from secrets')

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    console.log('Starting Creator enrichment sync...')

    const syncStartTime = new Date()
    const credentials: MixpanelCredentials = {
      username: mixpanelUsername,
      secret: mixpanelSecret,
    }

    // Create sync log entry
    const { data: syncLog, error: syncLogError } = await supabase
      .from('sync_logs')
      .insert({
        tool_type: 'creator',
        sync_started_at: syncStartTime.toISOString(),
        sync_status: 'in_progress',
        source: 'mixpanel_user_profiles',
        triggered_by: 'manual',
      })
      .select()
      .single()

    if (syncLogError) {
      console.error('Failed to create sync log:', syncLogError)
      throw syncLogError
    }

    console.log(`Created sync log with ID: ${syncLog.id}`)

    try {
      // Fetch premium creators list from Mixpanel
      console.log(`Fetching premium creators from Mixpanel chart ${CHART_IDS.premiumCreators}...`)
      const premiumCreatorsData = await fetchInsightsData(credentials, CHART_IDS.premiumCreators, 'Premium Creators')

      // Fetch user profile data from Mixpanel
      console.log(`Fetching user profile data from Mixpanel chart ${CHART_IDS.creatorProfiles}...`)
      const userProfileData = await fetchInsightsData(credentials, CHART_IDS.creatorProfiles, 'User Profiles')

      console.log('User profile data fetched successfully')

      // Process ALL Mixpanel data (no filtering)
      console.log('Processing all Mixpanel user profiles...')

      const stats: SyncStats = {
        totalMixpanelUsers: 0,
        matchedCreators: 0,
        enrichedCreators: 0,
        premiumCreatorsCount: 0,
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

      // Note: Premium creator affinity is now computed via database views
      // See: premium_creator_affinity_display view
      console.log('✅ Premium creator affinity available via views')

      // Update sync log with success
      const syncEndTime = new Date()
      const durationSeconds = Math.round((syncEndTime.getTime() - syncStartTime.getTime()) / 1000)

      await supabase
        .from('sync_logs')
        .update({
          sync_completed_at: syncEndTime.toISOString(),
          sync_status: 'completed',
          subscribers_fetched: stats.enrichedCreators,
          total_records_inserted: stats.enrichedCreators,
          duration_seconds: durationSeconds,
        })
        .eq('id', syncLog.id)

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Creator enrichment sync completed successfully',
          stats,
        }),
        {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          status: 200,
        }
      )
    } catch (error) {
      console.error('Error during creator enrichment sync:', error)

      // Update sync log with failure
      await supabase
        .from('sync_logs')
        .update({
          sync_completed_at: new Date().toISOString(),
          sync_status: 'failed',
          error_message: error instanceof Error ? error.message : String(error),
        })
        .eq('id', syncLog.id)

      throw error
    }
  } catch (error) {
    console.error('Error in sync-creator-data function:', error)

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }),
      {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        status: 500,
      }
    )
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

  // Iterate through creator usernames (skip $overall)
  for (const [creatorUsername, usernameData] of Object.entries(metricData)) {
    if (creatorUsername === '$overall') continue
    if (typeof usernameData !== 'object') continue

    // Find the creator_id (the 18-digit number key)
    for (const [key, value] of Object.entries(usernameData as any)) {
      // Creator IDs are 18-digit numbers, skip $overall and other keys
      if (key !== '$overall' && /^\d+$/.test(key)) {
        rows.push({
          creator_id: String(key),
          creator_username: String(creatorUsername),
          synced_at: now,
        })
        break // Only take the first creator_id per username
      }
    }
  }

  // Deduplicate by creator_id (primary key)
  const seenIds = new Set<string>()
  const deduplicatedRows = rows.filter(row => {
    if (seenIds.has(row.creator_id)) {
      return false
    }
    seenIds.add(row.creator_id)
    return true
  })

  console.log(`Processed ${rows.length} premium creators from Mixpanel (${deduplicatedRows.length} unique by creator_id)`)
  return deduplicatedRows
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
