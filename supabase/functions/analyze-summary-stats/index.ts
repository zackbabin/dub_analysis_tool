// Analyzes summary statistics for user analysis
// Processes comprehensive data and calculates summary stats including persona classification
// Stores results in summary_stats table

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface MainAnalysisRow {
  user_id?: string
  distinct_id?: string
  // Demographic fields
  income?: string
  net_worth?: string
  investing_experience_years?: string
  investing_activity?: string
  investing_objective?: string
  investment_type?: string
  acquisition_survey?: string
  // Financial/account fields
  total_bank_links?: number
  total_deposits?: number
  total_ach_deposits?: number
  total_copies?: number
  total_regular_copies?: number
  total_premium_copies?: number
  total_subscriptions?: number
  // Engagement fields
  regular_pdp_views?: number
  premium_pdp_views?: number
  paywall_views?: number
  regular_creator_views?: number
  premium_creator_views?: number
  app_sessions?: number
  discover_tab_views?: number
  leaderboard_tab_views?: number
  premium_tab_views?: number
  stripe_modal_views?: number
  creator_card_taps?: number
  portfolio_card_taps?: number
  unique_creators_viewed?: number
  unique_portfolios_viewed?: number
  // Portfolio fields
  available_copy_credits?: number
  buying_power?: number
  active_created_portfolios?: number
  lifetime_created_portfolios?: number
  active_copied_portfolios?: number
  lifetime_copied_portfolios?: number
  // Other fields
  total_profile_views?: number
  total_pdp_views?: number
  [key: string]: any
}

interface SummaryStats {
  totalUsers: number
  linkBankConversion: number
  firstCopyConversion: number
  depositConversion: number
  subscriptionConversion: number
  usersWithDepositData: number
  usersWithLowDeposits: number
  // Demographics breakdowns
  incomeBreakdown: Record<string, number>
  incomeTotalResponses: number
  netWorthBreakdown: Record<string, number>
  netWorthTotalResponses: number
  investingExperienceYearsBreakdown: Record<string, number>
  investingExperienceYearsTotalResponses: number
  investingActivityBreakdown: Record<string, number>
  investingActivityTotalResponses: number
  investmentTypeBreakdown: Record<string, number>
  investmentTypeTotalResponses: number
  investingObjectiveBreakdown: Record<string, number>
  investingObjectiveTotalResponses: number
  acquisitionSurveyBreakdown: Record<string, number>
  acquisitionSurveyTotalResponses: number
  // Persona stats
  personaStats: {
    premium: { count: number; percentage: number }
    core: { count: number; percentage: number }
    activationTargets: { count: number; percentage: number }
    nonActivated: { count: number; percentage: number }
  }
}

interface CleanedUser {
  totalCopies: number
  totalDeposits: number
  totalSubscriptions: number
  hasLinkedBank: number
  totalAchDeposits: number
  availableCopyCredits: number
  buyingPower: number
  activeCreatedPortfolios: number
  lifetimeCreatedPortfolios: number
  activeCopiedPortfolios: number
  lifetimeCopiedPortfolios: number
  totalRegularCopies: number
  totalPremiumCopies: number
  regularPDPViews: number
  premiumPDPViews: number
  totalPDPViews: number
  totalProfileViews: number
  paywallViews: number
  totalStripeViews: number
  regularCreatorProfileViews: number
  premiumCreatorProfileViews: number
  appSessions: number
  discoverTabViews: number
  leaderboardViews: number
  premiumTabViews: number
  totalOfUserProfiles: number
  creatorCardTaps: number
  portfolioCardTaps: number
  income: string
  netWorth: string
  incomeEnum: number
  netWorthEnum: number
  investingExperienceYears: string
  investingActivity: string
  investingObjective: string
  investmentType: string
  acquisitionSurvey: string
  subscribedWithin7Days?: number
  [key: string]: any
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function cleanNumeric(value: any): number {
  if (value === null || value === undefined || value === '' || isNaN(value)) return 0
  return parseFloat(value) || 0
}

function convertIncomeToEnum(income: string): number {
  const incomeMap: Record<string, number> = {
    'Less than $25,000': 1, '<25k': 1,
    '$25,000-$49,999': 2, '25k–50k': 2,
    '$50,000-$74,999': 3, '50k–100k': 3,
    '$75,000-$99,999': 4, '75k–100k': 4,
    '$100,000-$149,999': 5, '100k–150k': 5,
    '$150,000-$199,999': 6, '150k–200k': 6,
    '$200,000+': 7, '200k+': 7
  }
  return incomeMap[income] || 0
}

function convertNetWorthToEnum(netWorth: string): number {
  const netWorthMap: Record<string, number> = {
    'Less than $10,000': 1, '<10k': 1,
    '$10,000-$49,999': 2, '10k–50k': 2,
    '$50,000-$99,999': 3, '50k–100k': 3,
    '$100,000-$249,999': 4, '100k–250k': 4,
    '$250,000-$499,999': 5, '250k–500k': 5,
    '$500,000-$999,999': 6, '500k–1m': 6,
    '$1,000,000+': 7, '1m+': 7
  }
  return netWorthMap[netWorth] || 0
}

function classifyPersona(user: CleanedUser): string {
  const totalPDPViews = (user.regularPDPViews || 0) + (user.premiumPDPViews || 0)
  const totalCreatorViews = (user.regularCreatorProfileViews || 0) + (user.premiumCreatorProfileViews || 0)

  // HIERARCHICAL PRIORITY ORDER (4 personas)
  // 1. Premium: Active Premium subscribers
  if (user.totalSubscriptions >= 1) {
    return 'premium'
  }

  // 2. Core: Users with at least 1 copy
  if (user.totalCopies >= 1) {
    return 'core'
  }

  // 3. Activation Targets: Users with no deposits but showing engagement
  if (user.totalDeposits === 0 &&
      (totalCreatorViews >= 3 || totalPDPViews >= 3)) {
    return 'activationTargets'
  }

  // 4. Non-activated: Users with no bank linked, no deposits, and minimal engagement
  if (user.hasLinkedBank === 0 &&
      user.totalDeposits === 0 &&
      totalPDPViews < 3 &&
      totalCreatorViews < 3) {
    return 'nonActivated'
  }

  return 'unclassified'
}

function calculateDemographicBreakdown(data: CleanedUser[], key: string): { counts: Record<string, number>; totalResponses: number } {
  let totalResponses = 0
  const counts = data.reduce((acc, d) => {
    const value = d[key]
    if (value && typeof value === 'string' && value.trim() !== '') {
      acc[value] = (acc[value] || 0) + 1
      totalResponses++
    }
    return acc
  }, {} as Record<string, number>)
  return { counts, totalResponses }
}

function calculateSummaryStats(data: CleanedUser[]): SummaryStats {
  const usersWithLinkedBank = data.filter(d => d.hasLinkedBank === 1).length
  const usersWithCopies = data.filter(d => d.totalCopies > 0).length
  const usersWithDeposits = data.filter(d => d.totalAchDeposits > 0).length
  const usersWithSubscriptions = data.filter(d => d.totalSubscriptions > 0).length

  const demographicKeys = [
    'income', 'netWorth', 'investingExperienceYears',
    'investingActivity', 'investmentType', 'investingObjective',
    'acquisitionSurvey'
  ]

  const demographics: any = {}
  demographicKeys.forEach(key => {
    const breakdown = calculateDemographicBreakdown(data, key)
    demographics[key + 'Breakdown'] = breakdown.counts
    demographics[key + 'TotalResponses'] = breakdown.totalResponses
  })

  const totalUsers = data.length

  // Calculate count of users with non-null total deposits (for denominator)
  const usersWithDepositData = data.filter(d => d.totalDeposits !== null && d.totalDeposits !== undefined).length

  // Calculate count of users with low deposits for demographic cards (<$1k means strictly less than 1000)
  const usersWithLowDeposits = data.filter(d => d.totalDeposits !== null && d.totalDeposits < 1000).length

  const personaCounts: Record<string, number> = {
    premium: 0, core: 0, activationTargets: 0, nonActivated: 0, unclassified: 0
  }

  data.forEach(user => {
    const persona = classifyPersona(user)
    personaCounts[persona] = (personaCounts[persona] || 0) + 1
  })

  const personaStats = {
    premium: {
      count: personaCounts.premium,
      percentage: totalUsers > 0 ? (personaCounts.premium / totalUsers) * 100 : 0
    },
    core: {
      count: personaCounts.core,
      percentage: totalUsers > 0 ? (personaCounts.core / totalUsers) * 100 : 0
    },
    activationTargets: {
      count: personaCounts.activationTargets,
      percentage: totalUsers > 0 ? (personaCounts.activationTargets / totalUsers) * 100 : 0
    },
    nonActivated: {
      count: personaCounts.nonActivated,
      percentage: totalUsers > 0 ? (personaCounts.nonActivated / totalUsers) * 100 : 0
    }
  }

  return {
    totalUsers: totalUsers,
    linkBankConversion: (usersWithLinkedBank / totalUsers) * 100,
    firstCopyConversion: (usersWithCopies / totalUsers) * 100,
    depositConversion: (usersWithDeposits / totalUsers) * 100,
    subscriptionConversion: (usersWithSubscriptions / totalUsers) * 100,
    usersWithDepositData: usersWithDepositData,
    usersWithLowDeposits: usersWithLowDeposits,
    ...demographics,
    personaStats
  }
}

function processComprehensiveData(data: MainAnalysisRow[]): CleanedUser[] {
  return data.map(row => ({
    // Core Conversion Metrics
    totalCopies: cleanNumeric(row.total_copies),
    totalDeposits: cleanNumeric(row.total_deposits),
    totalSubscriptions: cleanNumeric(row.total_subscriptions),

    // Account & Financial Metrics
    hasLinkedBank: (row.total_bank_links && row.total_bank_links > 0) ? 1 : 0,
    availableCopyCredits: cleanNumeric(row.available_copy_credits),
    buyingPower: cleanNumeric(row.buying_power),
    totalAchDeposits: cleanNumeric(row.total_ach_deposits),

    // Portfolio Trading Metrics
    activeCreatedPortfolios: cleanNumeric(row.active_created_portfolios),
    lifetimeCreatedPortfolios: cleanNumeric(row.lifetime_created_portfolios),
    activeCopiedPortfolios: cleanNumeric(row.active_copied_portfolios),
    lifetimeCopiedPortfolios: cleanNumeric(row.lifetime_copied_portfolios),

    // Behavioral / Engagement Metrics
    totalRegularCopies: cleanNumeric(row.total_regular_copies),
    totalPremiumCopies: cleanNumeric(row.total_premium_copies),

    regularPDPViews: cleanNumeric(row.regular_pdp_views),
    premiumPDPViews: cleanNumeric(row.premium_pdp_views),
    totalPDPViews: cleanNumeric(row.total_pdp_views),
    totalProfileViews: cleanNumeric(row.total_profile_views),
    paywallViews: cleanNumeric(row.paywall_views),
    totalStripeViews: cleanNumeric(row.stripe_modal_views),
    regularCreatorProfileViews: cleanNumeric(row.regular_creator_views),
    premiumCreatorProfileViews: cleanNumeric(row.premium_creator_views),

    appSessions: cleanNumeric(row.app_sessions),
    discoverTabViews: cleanNumeric(row.discover_tab_views),
    leaderboardViews: cleanNumeric(row.leaderboard_tab_views),
    premiumTabViews: cleanNumeric(row.premium_tab_views),
    totalOfUserProfiles: cleanNumeric(row.total_profile_views), // fallback

    creatorCardTaps: cleanNumeric(row.creator_card_taps),
    portfolioCardTaps: cleanNumeric(row.portfolio_card_taps),

    // Demographic Metrics
    income: row.income || '',
    netWorth: row.net_worth || '',
    incomeEnum: convertIncomeToEnum(row.income || ''),
    netWorthEnum: convertNetWorthToEnum(row.net_worth || ''),
    investingExperienceYears: row.investing_experience_years || '',
    investingActivity: row.investing_activity || '',
    investingObjective: row.investing_objective || '',
    investmentType: row.investment_type || '',
    acquisitionSurvey: row.acquisition_survey || ''
  }))
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    console.log('🔄 Starting summary stats analysis...')

    // Step 1: Load all user data from main_analysis table
    console.log('→ Loading user data from main_analysis...')
    let allData: MainAnalysisRow[] = []
    let page = 0
    const pageSize = 1000
    let hasMore = true

    while (hasMore) {
      const { data, error } = await supabaseClient
        .from('main_analysis')
        .select('*')
        .range(page * pageSize, (page + 1) * pageSize - 1)

      if (error) {
        console.error('❌ Failed to load user data:', error)
        throw error
      }

      if (data && data.length > 0) {
        allData = allData.concat(data)
        hasMore = data.length === pageSize
        page++
      } else {
        hasMore = false
      }
    }

    console.log(`✅ Loaded ${allData.length} user records`)

    // Step 2: Process comprehensive data (clean and normalize)
    console.log('→ Processing and cleaning data...')
    const cleanData = processComprehensiveData(allData)
    console.log(`✅ Processed ${cleanData.length} clean records`)

    // Step 3: Calculate summary stats
    console.log('→ Calculating summary statistics...')
    const summaryStats = calculateSummaryStats(cleanData)
    console.log('✅ Summary stats calculated')
    console.log(`   - Total users: ${summaryStats.totalUsers}`)
    console.log(`   - Link bank conversion: ${summaryStats.linkBankConversion.toFixed(2)}%`)
    console.log(`   - First copy conversion: ${summaryStats.firstCopyConversion.toFixed(2)}%`)
    console.log(`   - Deposit conversion: ${summaryStats.depositConversion.toFixed(2)}%`)
    console.log(`   - Subscription conversion: ${summaryStats.subscriptionConversion.toFixed(2)}%`)
    console.log(`   - Premium persona: ${summaryStats.personaStats.premium.count} (${summaryStats.personaStats.premium.percentage.toFixed(2)}%)`)
    console.log(`   - Core persona: ${summaryStats.personaStats.core.count} (${summaryStats.personaStats.core.percentage.toFixed(2)}%)`)

    // Step 4: Store results in summary_stats table
    console.log('→ Storing results in summary_stats table...')

    // Delete existing stats (only one row)
    const { error: deleteError } = await supabaseClient
      .from('summary_stats')
      .delete()
      .neq('id', 0) // Delete all rows

    if (deleteError) {
      console.warn('⚠ Failed to clear old stats:', deleteError)
    }

    // Insert new stats
    const { error: insertError } = await supabaseClient
      .from('summary_stats')
      .insert({
        stats_data: summaryStats,
        calculated_at: new Date().toISOString()
      })

    if (insertError) {
      console.error('❌ Failed to store summary stats:', insertError)
      throw insertError
    }

    console.log('✅ Summary stats stored successfully')

    return new Response(
      JSON.stringify({
        success: true,
        stats: {
          total_users: summaryStats.totalUsers,
          link_bank_conversion: summaryStats.linkBankConversion,
          first_copy_conversion: summaryStats.firstCopyConversion,
          deposit_conversion: summaryStats.depositConversion,
          subscription_conversion: summaryStats.subscriptionConversion,
          premium_users: summaryStats.personaStats.premium.count,
          core_users: summaryStats.personaStats.core.count
        }
      }),
      {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error) {
    console.error('❌ Error in analyze-summary-stats:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        status: 500,
      }
    )
  }
})
