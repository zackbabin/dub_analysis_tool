// Analyzes behavioral drivers for deposits and copies
// Calculates correlation coefficients and t-statistics for all predictor variables
// Stores results in deposit_drivers and copy_drivers tables

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

interface MainAnalysisRow {
  user_id: string
  distinct_id: string
  // Outcome variables
  total_deposits: number
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

// Variable exclusions per outcome (from analysis_utils.js SECTION_EXCLUSIONS)
const EXCLUSIONS = {
  total_deposits: [
    // Profile fields (N/A in mapping)
    'income', 'net_worth', 'investing_activity', 'investing_experience_years',
    'investing_objective', 'investment_type', 'acquisition_survey',
    // Deposit-related (circular dependency)
    'total_deposits', 'total_ach_deposits', 'total_bank_links',
    'buying_power', 'available_copy_credits',
    // Portfolio creation
    'active_created_portfolios', 'lifetime_created_portfolios',
    // Copy metrics (outcome variables)
    'active_copied_portfolios', 'lifetime_copied_portfolios',
    'total_copies', 'total_regular_copies', 'total_premium_copies', 'did_copy',
    // Subscription metrics
    'total_subscriptions', 'did_subscribe',
    // Metadata
    'user_id', 'distinct_id', 'updated_at'
  ],
  total_copies: [
    // Profile fields (N/A in mapping)
    'income', 'net_worth', 'investing_activity', 'investing_experience_years',
    'investing_objective', 'investment_type', 'acquisition_survey',
    // Financial metrics
    'available_copy_credits', 'buying_power',
    // Portfolio creation
    'active_created_portfolios', 'lifetime_created_portfolios',
    // Copy metrics (circular dependency)
    'active_copied_portfolios', 'lifetime_copied_portfolios',
    'total_copies', 'total_regular_copies', 'total_premium_copies', 'did_copy',
    // Subscription metrics
    'total_subscriptions', 'did_subscribe',
    // Metadata
    'user_id', 'distinct_id', 'updated_at'
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

  // Filter groups (min 10 users, >10% conversion rate)
  const validGroups = Object.entries(groups)
    .filter(([_, stats]) => stats.total >= 10 && (stats.converted / stats.total) > 0.10)
    .map(([value, stats]) => ({
      value: Number(value),
      rate: stats.converted / stats.total
    }))
    .sort((a, b) => a.value - b.value)

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

  return tippingPoint !== null ? tippingPoint.toFixed(1) : null
}

/**
 * Analyze behavioral drivers for a specific outcome
 */
function analyzeBehavioralDrivers(
  data: MainAnalysisRow[],
  outcomeField: string,
  exclusions: string[]
): DriverResult[] {
  const n = data.length
  if (n === 0) return []

  // Get all numeric columns except exclusions
  const sampleRow = data[0]
  const allColumns = Object.keys(sampleRow)
  const numericColumns = allColumns.filter(col => {
    if (exclusions.includes(col)) return false
    const value = sampleRow[col]
    return typeof value === 'number' && !isNaN(value)
  })

  console.log(`Analyzing ${numericColumns.length} variables for ${outcomeField}`)

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
  try {
    console.log('🔄 Starting behavioral drivers analysis...')

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

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
      'total_deposits',
      EXCLUSIONS.total_deposits
    )
    console.log(`✓ Calculated ${depositDrivers.length} deposit drivers`)

    // Analyze copy drivers
    console.log('📈 Analyzing copy drivers...')
    const copyDrivers = analyzeBehavioralDrivers(
      mainAnalysisData,
      'total_copies',
      EXCLUSIONS.total_copies
    )
    console.log(`✓ Calculated ${copyDrivers.length} copy drivers`)

    // Clear existing data and insert new results
    const syncedAt = new Date().toISOString()

    console.log('💾 Clearing old deposit drivers...')
    const { error: deleteDepositError } = await supabase
      .from('deposit_drivers')
      .delete()
      .neq('id', 0) // Delete all rows

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
      .neq('id', 0) // Delete all rows

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

    console.log('✅ Behavioral drivers analysis complete')

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Behavioral drivers analysis completed successfully',
        stats: {
          total_users: mainAnalysisData.length,
          deposit_drivers_count: depositDrivers.length,
          copy_drivers_count: copyDrivers.length,
          top_deposit_driver: depositDrivers[0]?.variable_name || null,
          top_copy_driver: copyDrivers[0]?.variable_name || null,
          synced_at: syncedAt
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
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
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
