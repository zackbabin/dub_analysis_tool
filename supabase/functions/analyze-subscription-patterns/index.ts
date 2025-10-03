import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

interface UserData {
  distinct_id: string
  creator_ids: Set<string>
  did_subscribe: boolean
}

interface CombinationResult {
  combination: [string, string, string]
  log_likelihood: number
  aic: number
  odds_ratio: number
  precision: number
  recall: number
  lift: number
  users_with_exposure: number
  conversion_rate_in_group: number
  overall_conversion_rate: number
}

/**
 * Generate all 3-element combinations from an array
 */
function* generateCombinations<T>(arr: T[], size: number): Generator<T[]> {
  if (size === 1) {
    for (const item of arr) {
      yield [item]
    }
    return
  }

  for (let i = 0; i <= arr.length - size; i++) {
    for (const combo of generateCombinations(arr.slice(i + 1), size - 1)) {
      yield [arr[i], ...combo]
    }
  }
}

/**
 * Simple logistic regression using Newton-Raphson method
 * Returns: { beta0: intercept, beta1: coefficient, log_likelihood }
 */
function fitLogisticRegression(
  X: number[],
  y: number[],
  maxIterations = 20
): { beta0: number; beta1: number; log_likelihood: number } {
  const n = X.length
  let beta0 = 0
  let beta1 = 0

  // Newton-Raphson iterations
  for (let iter = 0; iter < maxIterations; iter++) {
    let gradient0 = 0
    let gradient1 = 0
    let hessian00 = 0
    let hessian01 = 0
    let hessian11 = 0

    for (let i = 0; i < n; i++) {
      const z = beta0 + beta1 * X[i]
      const p = 1 / (1 + Math.exp(-z))
      const diff = y[i] - p

      gradient0 += diff
      gradient1 += diff * X[i]

      const w = p * (1 - p)
      hessian00 += w
      hessian01 += w * X[i]
      hessian11 += w * X[i] * X[i]
    }

    // Calculate inverse of Hessian and update
    const det = hessian00 * hessian11 - hessian01 * hessian01
    if (Math.abs(det) < 1e-10) break

    const delta0 = (hessian11 * gradient0 - hessian01 * gradient1) / det
    const delta1 = (hessian00 * gradient1 - hessian01 * gradient0) / det

    beta0 += delta0
    beta1 += delta1

    // Check convergence
    if (Math.abs(delta0) < 1e-6 && Math.abs(delta1) < 1e-6) break
  }

  // Calculate log-likelihood
  let logLikelihood = 0
  for (let i = 0; i < n; i++) {
    const z = beta0 + beta1 * X[i]
    const p = 1 / (1 + Math.exp(-z))
    logLikelihood += y[i] * Math.log(p + 1e-10) + (1 - y[i]) * Math.log(1 - p + 1e-10)
  }

  return { beta0, beta1, log_likelihood: logLikelihood }
}

/**
 * Evaluate a single combination
 */
function evaluateCombination(
  combination: string[],
  users: UserData[]
): CombinationResult {
  const combinationSet = new Set(combination)

  // Create features: does user have exposure to any creator in combination?
  const X: number[] = []
  const y: number[] = []

  for (const user of users) {
    const hasExposure = Array.from(user.creator_ids).some(id => combinationSet.has(id))
    X.push(hasExposure ? 1 : 0)
    y.push(user.did_subscribe ? 1 : 0)
  }

  // Fit logistic regression
  const model = fitLogisticRegression(X, y)
  const aic = 2 * 2 - 2 * model.log_likelihood // 2 parameters (intercept + beta1)
  const oddsRatio = Math.exp(model.beta1)

  // Calculate metrics
  const overallConversionRate = y.filter(val => val === 1).length / y.length

  let truePositives = 0
  let falsePositives = 0
  let trueNegatives = 0
  let falseNegatives = 0
  let exposedConverters = 0
  let exposedTotal = 0

  for (let i = 0; i < X.length; i++) {
    const predicted = X[i] === 1 ? 1 : 0 // Simple threshold: exposed = predict positive
    const actual = y[i]

    if (predicted === 1 && actual === 1) truePositives++
    else if (predicted === 1 && actual === 0) falsePositives++
    else if (predicted === 0 && actual === 0) trueNegatives++
    else if (predicted === 0 && actual === 1) falseNegatives++

    if (X[i] === 1) {
      exposedTotal++
      if (actual === 1) exposedConverters++
    }
  }

  const precision = truePositives + falsePositives > 0
    ? truePositives / (truePositives + falsePositives)
    : 0
  const recall = truePositives + falseNegatives > 0
    ? truePositives / (truePositives + falseNegatives)
    : 0
  const conversionRateInGroup = exposedTotal > 0 ? exposedConverters / exposedTotal : 0
  const lift = overallConversionRate > 0 ? conversionRateInGroup / overallConversionRate : 0

  return {
    combination: combination as [string, string, string],
    log_likelihood: model.log_likelihood,
    aic,
    odds_ratio: oddsRatio,
    precision,
    recall,
    lift,
    users_with_exposure: exposedTotal,
    conversion_rate_in_group: conversionRateInGroup,
    overall_conversion_rate: overallConversionRate,
  }
}

/**
 * Load user engagement data
 */
async function loadUserData(supabaseClient: any): Promise<UserData[]> {
  console.log('Loading user engagement data...')

  const { data, error } = await supabaseClient
    .from('user_portfolio_creator_views')
    .select('distinct_id, creator_id, did_subscribe')

  if (error) throw error

  // Aggregate by user
  const userMap = new Map<string, UserData>()

  for (const row of data) {
    if (!userMap.has(row.distinct_id)) {
      userMap.set(row.distinct_id, {
        distinct_id: row.distinct_id,
        creator_ids: new Set(),
        did_subscribe: row.did_subscribe,
      })
    }
    userMap.get(row.distinct_id)!.creator_ids.add(row.creator_id)
  }

  console.log(`Loaded ${userMap.size} unique users`)
  return Array.from(userMap.values())
}

/**
 * Get all unique creator IDs with sufficient engagement
 */
function getTopCreators(users: UserData[], minUsers = 10): string[] {
  const creatorCounts = new Map<string, number>()

  for (const user of users) {
    for (const creatorId of user.creator_ids) {
      creatorCounts.set(creatorId, (creatorCounts.get(creatorId) || 0) + 1)
    }
  }

  const topCreators = Array.from(creatorCounts.entries())
    .filter(([_, count]) => count >= minUsers)
    .sort((a, b) => b[1] - a[1])
    .map(([id, _]) => id)

  console.log(`Found ${topCreators.length} creators with >=${minUsers} user exposures`)
  return topCreators
}

/**
 * Main handler
 */
serve(async (_req) => {
  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const analyzedAt = new Date().toISOString()

    // Load data
    const users = await loadUserData(supabaseClient)

    if (users.length < 50) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Insufficient data: need at least 50 users',
        }),
        { headers: { 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // Get top creators (limit to top 25 to keep combinations manageable)
    const topCreators = getTopCreators(users, 10).slice(0, 25)

    if (topCreators.length < 3) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Insufficient creators: need at least 3 with enough engagement',
        }),
        { headers: { 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // Calculate total combinations
    const totalCombinations = (topCreators.length * (topCreators.length - 1) * (topCreators.length - 2)) / 6
    console.log(`Testing ${totalCombinations} combinations from ${topCreators.length} creators`)

    // Evaluate all combinations
    const results: CombinationResult[] = []
    let processed = 0

    for (const combo of generateCombinations(topCreators, 3)) {
      const result = evaluateCombination(combo, users)

      // Only keep combinations with reasonable exposure (>5% of users)
      if (result.users_with_exposure >= users.length * 0.05) {
        results.push(result)
      }

      processed++
      if (processed % 500 === 0) {
        console.log(`Processed ${processed}/${totalCombinations} combinations...`)
      }
    }

    console.log(`Evaluated ${results.length} valid combinations`)

    // Sort by AIC (lower is better) and keep top 100
    results.sort((a, b) => a.aic - b.aic)
    const topResults = results.slice(0, 100)

    // Insert results into database
    const insertRows = topResults.map((result, index) => ({
      analysis_type: 'subscription',
      combination_rank: index + 1,
      value_1: result.combination[0],
      value_2: result.combination[1],
      value_3: result.combination[2],
      log_likelihood: result.log_likelihood,
      aic: result.aic,
      odds_ratio: result.odds_ratio,
      precision: result.precision,
      recall: result.recall,
      lift: result.lift,
      users_with_exposure: result.users_with_exposure,
      conversion_rate_in_group: result.conversion_rate_in_group,
      overall_conversion_rate: result.overall_conversion_rate,
      analyzed_at: analyzedAt,
    }))

    // Delete old subscription analysis results
    await supabaseClient
      .from('conversion_pattern_combinations')
      .delete()
      .eq('analysis_type', 'subscription')

    // Insert new results in batches
    const batchSize = 100
    for (let i = 0; i < insertRows.length; i += batchSize) {
      const batch = insertRows.slice(i, i + batchSize)
      const { error: insertError } = await supabaseClient
        .from('conversion_pattern_combinations')
        .insert(batch)

      if (insertError) {
        console.error('Error inserting results:', insertError)
        throw insertError
      }
    }

    console.log(`✓ Inserted ${insertRows.length} combination results`)

    // Return top 10 results
    const top10 = topResults.slice(0, 10).map(r => ({
      creators: r.combination,
      aic: Math.round(r.aic * 100) / 100,
      odds_ratio: Math.round(r.odds_ratio * 100) / 100,
      lift: Math.round(r.lift * 100) / 100,
      precision: Math.round(r.precision * 100) / 100,
      recall: Math.round(r.recall * 100) / 100,
      conversion_rate: Math.round(r.conversion_rate_in_group * 10000) / 100,
      users_exposed: r.users_with_exposure,
    }))

    return new Response(
      JSON.stringify({
        success: true,
        stats: {
          total_users: users.length,
          creators_tested: topCreators.length,
          combinations_evaluated: results.length,
          combinations_stored: insertRows.length,
        },
        top_10_combinations: top10,
      }),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error: any) {
    console.error('Error in analyze-subscription-patterns:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message || String(error),
      }),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 500,
      }
    )
  }
})
