// Analyzes behavioral drivers for deposits, copies, and subscriptions
// Calculates correlation coefficients and t-statistics for all predictor variables
// Stores results in deposit_drivers, copy_drivers, and subscription_drivers tables

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface MainAnalysisRow {
  user_id: string
  distinct_id: string
  // Outcome variables
  total_ach_deposits: number
  total_copies: number
  total_subscriptions: number
  // All other numeric fields are potential predictors
  [key: string]: any
}

interface DriverResult {
  variable_name: string
  correlation_coefficient: number
  t_stat: number
  tipping_point: string | null
  predictive_strength: string
}

// Variable inclusions per outcome - ONLY these variables should be analyzed
// Based on CSV mappings provided by user
const INCLUSIONS = {
  total_ach_deposits: [
    // Deposit Funds: 14 specific variables from CSV
    'regular_pdp_views',           // E. Regular PDP Views
    'premium_pdp_views',           // F. Premium PDP Views
    'paywall_views',               // G. Paywall Views
    'regular_creator_views',       // H. Regular Creator Profile Views
    'premium_creator_views',       // I. Premium Creator Profile Views
    'app_sessions',                // K. App Sessions
    'discover_tab_views',          // L. Discover Tab Views
    'leaderboard_tab_views',       // M. Leaderboard Tab Views
    'premium_tab_views',           // N. Premium Tab Views
    'stripe_modal_views',          // O. Stripe Modal Views
    'creator_card_taps',           // P. Creator Card Taps
    'portfolio_card_taps',         // Q. Portfolio Card Taps
    'unique_creators_viewed',      // Joined from other table
    'unique_portfolios_viewed',    // Joined from other table
  ],
  total_copies: [
    // Copy Portfolios: 18 specific variables from CSV (removed total_ach_deposits)
    'total_bank_links',            // A. Total Bank Links
    'regular_pdp_views',           // E. Regular PDP Views
    'premium_pdp_views',           // F. Premium PDP Views
    'paywall_views',               // G. Paywall Views
    'regular_creator_views',       // H. Regular Creator Profile Views
    'premium_creator_views',       // I. Premium Creator Profile Views
    'total_subscriptions',         // J. Total Subscriptions
    'app_sessions',                // K. App Sessions
    'discover_tab_views',          // L. Discover Tab Views
    'leaderboard_tab_views',       // M. Leaderboard Tab Views
    'premium_tab_views',           // N. Premium Tab Views
    'stripe_modal_views',          // O. Stripe Modal Views
    'creator_card_taps',           // P. Creator Card Taps
    'portfolio_card_taps',         // Q. Portfolio Card Taps
    'unique_creators_viewed',      // Joined from other table
    'unique_portfolios_viewed',    // Joined from other table
    'buying_power',                // buyingPower
    'total_deposits',              // totalDeposits
  ],
  total_subscriptions: [
    // Subscriptions: 26 specific variables from CSV
    'total_bank_links',            // A. Total Bank Links
    'total_copies',                // B. Total Copies
    'total_regular_copies',        // C. Total Regular Copies
    'total_premium_copies',        // D. Total Premium Copies
    'regular_pdp_views',           // E. Regular PDP Views
    'premium_pdp_views',           // F. Premium PDP Views
    'paywall_views',               // G. Paywall Views
    'regular_creator_views',       // H. Regular Creator Profile Views
    'premium_creator_views',       // I. Premium Creator Profile Views
    'app_sessions',                // K. App Sessions
    'discover_tab_views',          // L. Discover Tab Views
    'leaderboard_tab_views',       // M. Leaderboard Tab Views
    'premium_tab_views',           // N. Premium Tab Views
    'stripe_modal_views',          // O. Stripe Modal Views
    'creator_card_taps',           // P. Creator Card Taps
    'portfolio_card_taps',         // Q. Portfolio Card Taps
    'total_ach_deposits',          // R. Total ACH Deposits
    'unique_creators_viewed',      // Joined from other table
    'unique_portfolios_viewed',    // Joined from other table
    'available_copy_credits',      // availableCopyCredits
    'buying_power',                // buyingPower
    'active_created_portfolios',   // activeCreatedPortfolios
    'lifetime_created_portfolios', // lifetimeCreatedPortfolios
    'active_copied_portfolios',    // activeCopiedPortfolios
    'lifetime_copied_portfolios',  // lifetimeCopiedPortfolios
    'total_deposits',              // totalDeposits
  ]
}

/**
 * Calculate Pearson correlation coefficient
 */
function calculateCorrelation(x: number[], y: number[]): number {
  const n = x.length
  if (n === 0) return 0

  const sumX = x.reduce((a, b) => a + b, 0)
  const sumY = y.reduce((a, b) => a + b, 0)
  const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0)
  const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0)
  const sumY2 = y.reduce((sum, yi) => sum + yi * yi, 0)

  const numerator = n * sumXY - sumX * sumY
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY))

  return denominator === 0 ? 0 : numerator / denominator
}

/**
 * Calculate t-statistic from correlation
 */
function calculateTStat(correlation: number, n: number): number {
  if (Math.abs(correlation) <= 0.001 || n <= 2) return 0

  const denominator = 1 - (correlation * correlation)
  if (denominator <= 0.001) return 0

  return correlation * Math.sqrt((n - 2) / denominator)
}

/**
 * Calculate predictive strength based on correlation and t-statistic
 * Uses same logic as analysis_utils.js calculatePredictiveStrength()
 */
function calculatePredictiveStrength(correlation: number, tStat: number): string {
  const absCorr = Math.abs(correlation)
  const absTStat = Math.abs(tStat)

  // Gate 1: Statistical significance check
  if (absTStat < 1.96) {
    return 'Very Weak'
  }

  // Gate 2: Calculate weighted score
  let corrScore = 0
  if (absCorr >= 0.50) corrScore = 6
  else if (absCorr >= 0.30) corrScore = 5
  else if (absCorr >= 0.20) corrScore = 4
  else if (absCorr >= 0.10) corrScore = 3
  else if (absCorr >= 0.05) corrScore = 2
  else if (absCorr >= 0.02) corrScore = 1
  else corrScore = 0

  let tScore = 0
  if (absTStat >= 3.29) tScore = 6
  else if (absTStat >= 2.58) tScore = 5
  else if (absTStat >= 1.96) tScore = 4

  const combinedScore = (corrScore * 0.9) + (tScore * 0.1)

  if (combinedScore >= 5.5) return 'Very Strong'
  else if (combinedScore >= 4.5) return 'Strong'
  else if (combinedScore >= 3.5) return 'Moderate - Strong'
  else if (combinedScore >= 2.5) return 'Moderate'
  else if (combinedScore >= 1.5) return 'Weak - Moderate'
  else if (combinedScore >= 0.5) return 'Weak'
  else return 'Very Weak'
}

/**
 * Calculate tipping point for a variable-outcome pair
 * Finds the threshold where conversion rate jumps the most
 */
function calculateTippingPoint(
  data: MainAnalysisRow[],
  variable: string,
  outcomeField: string
): string | null {
  const groups: Record<number, { total: number, converted: number }> = {}

  // Group by variable value
  data.forEach(row => {
    const value = Math.floor(Number(row[variable]) || 0)
    const converted = Number(row[outcomeField]) > 0 ? 1 : 0

    if (!groups[value]) {
      groups[value] = { total: 0, converted: 0 }
    }
    groups[value].total++
    groups[value].converted += converted
  })

  const totalGroups = Object.keys(groups).length

  // Filter groups (min 10 users, >10% conversion rate)
  const validGroups = Object.entries(groups)
    .filter(([_, stats]) => stats.total >= 10 && (stats.converted / stats.total) > 0.10)
    .map(([value, stats]) => ({
      value: Number(value),
      rate: stats.converted / stats.total,
      total: stats.total,
      converted: stats.converted
    }))
    .sort((a, b) => a.value - b.value)

  // Log diagnostic info for null tipping points (subscriptions only, to reduce noise)
  if (validGroups.length < 2 && outcomeField === 'total_subscriptions') {
    console.log(`   ⚠️ ${variable}: No tipping point (${totalGroups} total groups, ${validGroups.length} valid)`)
    if (validGroups.length === 1) {
      console.log(`      Only valid group: value=${validGroups[0].value}, rate=${(validGroups[0].rate * 100).toFixed(1)}%, n=${validGroups[0].total}`)
    } else if (totalGroups > 0) {
      // Show why groups were filtered out
      const allGroupStats = Object.entries(groups)
        .map(([value, stats]) => ({
          value: Number(value),
          total: stats.total,
          converted: stats.converted,
          rate: stats.converted / stats.total,
          passSize: stats.total >= 10,
          passRate: (stats.converted / stats.total) > 0.10
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 3) // Show top 3 groups by size

      console.log(`      Top groups (by size):`)
      allGroupStats.forEach(g => {
        console.log(`        value=${g.value}: n=${g.total} (${g.passSize ? '✓' : '✗'}), rate=${(g.rate * 100).toFixed(1)}% (${g.passRate ? '✓' : '✗'}), converted=${g.converted}`)
      })
    }
  }

  if (validGroups.length < 2) return null

  // Find largest jump in conversion rate
  let maxJump = 0
  let tippingPoint = null

  for (let i = 1; i < validGroups.length; i++) {
    const jump = validGroups[i].rate - validGroups[i - 1].rate
    if (jump > maxJump) {
      maxJump = jump
      tippingPoint = validGroups[i].value
    }
  }

  // Log successful tipping points for subscriptions
  if (tippingPoint !== null && outcomeField === 'total_subscriptions') {
    console.log(`   ✓ ${variable}: Tipping point at ${tippingPoint} (${validGroups.length} valid groups, max jump=${(maxJump * 100).toFixed(1)}%)`)
  }

  return tippingPoint !== null ? tippingPoint.toFixed(1) : null
}

/**
 * Analyze behavioral drivers for a specific outcome
 */
function analyzeBehavioralDrivers(
  data: MainAnalysisRow[],
  outcomeField: string,
  inclusions: string[]
): DriverResult[] {
  const n = data.length
  if (n === 0) return []

  // Use ONLY the specified inclusion variables
  const sampleRow = data[0]
  const numericColumns = inclusions.filter(col => {
    // Verify column exists and is numeric
    if (!(col in sampleRow)) {
      console.warn(`Warning: Column '${col}' not found in main_analysis`)
      return false
    }
    const value = sampleRow[col]
    return typeof value === 'number' && !isNaN(value)
  })

  console.log(`Analyzing ${numericColumns.length} variables for ${outcomeField} (from ${inclusions.length} specified)`)

  // Extract outcome array once
  const outcomeArray = data.map(row => Number(row[outcomeField]) || 0)

  // Calculate drivers for each variable
  const results: DriverResult[] = []

  for (const variable of numericColumns) {
    const variableArray = data.map(row => Number(row[variable]) || 0)

    const correlation = calculateCorrelation(outcomeArray, variableArray)
    const tStat = calculateTStat(correlation, n)
    const predictiveStrength = calculatePredictiveStrength(correlation, tStat)
    const tippingPoint = calculateTippingPoint(data, variable, outcomeField)

    results.push({
      variable_name: variable,
      correlation_coefficient: correlation,
      t_stat: tStat,
      tipping_point: tippingPoint,
      predictive_strength: predictiveStrength
    })
  }

  // Sort by absolute correlation (descending)
  return results.sort((a, b) =>
    Math.abs(b.correlation_coefficient) - Math.abs(a.correlation_coefficient)
  )
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    console.log('🔄 Starting behavioral drivers analysis...')

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Note: main_analysis is refreshed in supabase_integration.js after portfolio engagement processing
    // This ensures all source data (subscribers_insights + user_portfolio_creator_engagement) is fresh

    // Fetch all data from main_analysis materialized view
    console.log('📊 Fetching data from main_analysis...')
    const { data: mainAnalysisData, error: fetchError } = await supabase
      .from('main_analysis')
      .select('*')

    if (fetchError) {
      throw new Error(`Failed to fetch main_analysis: ${fetchError.message}`)
    }

    if (!mainAnalysisData || mainAnalysisData.length === 0) {
      throw new Error('No data found in main_analysis')
    }

    console.log(`✓ Fetched ${mainAnalysisData.length} rows from main_analysis`)

    // Analyze deposit drivers
    console.log('📈 Analyzing deposit drivers...')
    const depositDrivers = analyzeBehavioralDrivers(
      mainAnalysisData,
      'total_ach_deposits',
      INCLUSIONS.total_ach_deposits
    )
    console.log(`✓ Calculated ${depositDrivers.length} deposit drivers`)

    // Analyze copy drivers
    console.log('📈 Analyzing copy drivers...')
    const copyDrivers = analyzeBehavioralDrivers(
      mainAnalysisData,
      'total_copies',
      INCLUSIONS.total_copies
    )
    console.log(`✓ Calculated ${copyDrivers.length} copy drivers`)

    // Analyze subscription drivers
    console.log('📈 Analyzing subscription drivers...')
    const subscriptionDrivers = analyzeBehavioralDrivers(
      mainAnalysisData,
      'total_subscriptions',
      INCLUSIONS.total_subscriptions
    )
    console.log(`✓ Calculated ${subscriptionDrivers.length} subscription drivers`)

    // Summary stats for tipping points
    const tippingPointStats = {
      total: subscriptionDrivers.length,
      withTippingPoint: subscriptionDrivers.filter(d => d.tipping_point !== null).length,
      nullTippingPoint: subscriptionDrivers.filter(d => d.tipping_point === null).length
    }
    console.log(`   Tipping Point Summary: ${tippingPointStats.withTippingPoint}/${tippingPointStats.total} have tipping points (${((tippingPointStats.withTippingPoint / tippingPointStats.total) * 100).toFixed(1)}%)`)
    if (tippingPointStats.nullTippingPoint > 0) {
      console.log(`   Variables without tipping points: ${subscriptionDrivers.filter(d => d.tipping_point === null).map(d => d.variable_name).join(', ')}`)
    }

    // Clear existing data and insert new results
    const syncedAt = new Date().toISOString()

    console.log('💾 Clearing old deposit drivers...')
    const { error: deleteDepositError } = await supabase
      .from('deposit_drivers')
      .delete()
      .gte('id', 0) // Delete all rows (id >= 0)

    if (deleteDepositError) {
      console.warn('Warning: Failed to clear deposit_drivers:', deleteDepositError.message)
    }

    console.log('💾 Inserting new deposit drivers...')
    const depositInserts = depositDrivers.map(d => ({ ...d, synced_at: syncedAt }))
    const { error: insertDepositError } = await supabase
      .from('deposit_drivers')
      .insert(depositInserts)

    if (insertDepositError) {
      throw new Error(`Failed to insert deposit_drivers: ${insertDepositError.message}`)
    }

    console.log('💾 Clearing old copy drivers...')
    const { error: deleteCopyError } = await supabase
      .from('copy_drivers')
      .delete()
      .gte('id', 0) // Delete all rows (id >= 0)

    if (deleteCopyError) {
      console.warn('Warning: Failed to clear copy_drivers:', deleteCopyError.message)
    }

    console.log('💾 Inserting new copy drivers...')
    const copyInserts = copyDrivers.map(d => ({ ...d, synced_at: syncedAt }))
    const { error: insertCopyError } = await supabase
      .from('copy_drivers')
      .insert(copyInserts)

    if (insertCopyError) {
      throw new Error(`Failed to insert copy_drivers: ${insertCopyError.message}`)
    }

    console.log('💾 Clearing old subscription drivers...')
    const { error: deleteSubscriptionError } = await supabase
      .from('subscription_drivers')
      .delete()
      .gte('id', 0) // Delete all rows (id >= 0)

    if (deleteSubscriptionError) {
      console.warn('Warning: Failed to clear subscription_drivers:', deleteSubscriptionError.message)
    }

    console.log('💾 Inserting new subscription drivers...')
    const subscriptionInserts = subscriptionDrivers.map(d => ({ ...d, synced_at: syncedAt }))
    const { error: insertSubscriptionError } = await supabase
      .from('subscription_drivers')
      .insert(subscriptionInserts)

    if (insertSubscriptionError) {
      throw new Error(`Failed to insert subscription_drivers: ${insertSubscriptionError.message}`)
    }

    console.log('✅ Behavioral drivers analysis complete')

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Behavioral drivers analysis completed successfully',
        stats: {
          total_users: mainAnalysisData.length,
          deposit_drivers_count: depositDrivers.length,
          copy_drivers_count: copyDrivers.length,
          subscription_drivers_count: subscriptionDrivers.length,
          top_deposit_driver: depositDrivers[0]?.variable_name || null,
          top_copy_driver: copyDrivers[0]?.variable_name || null,
          top_subscription_driver: subscriptionDrivers[0]?.variable_name || null,
          synced_at: syncedAt
        }
      }),
      { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('❌ Error in analyze-behavioral-drivers:', error.message)
    console.error('Stack trace:', error.stack)

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        stack: error.stack
      }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    )
  }
})
