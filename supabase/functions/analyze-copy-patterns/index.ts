import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const MIXPANEL_PROJECT_ID = '2599235'
const MIXPANEL_USERNAME = Deno.env.get('MIXPANEL_SERVICE_USERNAME') || ''
const MIXPANEL_PASSWORD = Deno.env.get('MIXPANEL_SERVICE_SECRET') || ''

const CHART_IDS = {
  profileViewsByCreator: '85165851',
  pdpViewsByPortfolio: '85165580',
  copiesByCreator: '85172578',
}

interface UserData {
  distinct_id: string
  portfolio_tickers: Set<string>
  did_copy: boolean
  copy_count: number
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
  total_conversions: number
}

interface PortfolioCreatorCopyPair {
  distinct_id: string
  portfolio_ticker: string
  creator_id: string
  creator_username: string | null
  pdp_view_count: number
  profile_view_count: number
  did_copy: boolean
  copy_count: number
  synced_at: string
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
 */
function fitLogisticRegression(
  X: number[],
  y: number[],
  maxIterations = 20
): { beta0: number; beta1: number; log_likelihood: number } {
  const n = X.length
  let beta0 = 0
  let beta1 = 0

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

    const det = hessian00 * hessian11 - hessian01 * hessian01
    if (Math.abs(det) < 1e-10) break

    const delta0 = (hessian11 * gradient0 - hessian01 * gradient1) / det
    const delta1 = (hessian00 * gradient1 - hessian01 * gradient0) / det

    beta0 += delta0
    beta1 += delta1

    if (Math.abs(delta0) < 1e-6 && Math.abs(delta1) < 1e-6) break
  }

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

  const X: number[] = []
  const y: number[] = []

  for (const user of users) {
    // Check if user viewed ALL portfolios in the combination (not just any)
    const hasExposure = combination.every(ticker => user.portfolio_tickers.has(ticker))
    X.push(hasExposure ? 1 : 0)
    y.push(user.did_copy ? 1 : 0)
  }

  const model = fitLogisticRegression(X, y)
  const aic = 2 * 2 - 2 * model.log_likelihood
  const oddsRatio = Math.exp(model.beta1)

  const overallConversionRate = y.filter(val => val === 1).length / y.length

  let truePositives = 0
  let falsePositives = 0
  let trueNegatives = 0
  let falseNegatives = 0
  let exposedConverters = 0
  let exposedTotal = 0
  let totalConversions = 0

  for (let i = 0; i < X.length; i++) {
    const predicted = X[i] === 1 ? 1 : 0
    const actual = y[i]

    if (predicted === 1 && actual === 1) truePositives++
    else if (predicted === 1 && actual === 0) falsePositives++
    else if (predicted === 0 && actual === 0) trueNegatives++
    else if (predicted === 0 && actual === 1) falseNegatives++

    if (X[i] === 1) {
      exposedTotal++
      if (actual === 1) {
        exposedConverters++
        totalConversions += users[i].copy_count
      }
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
    total_conversions: totalConversions,
  }
}

/**
 * Convert raw pairs to user-level data
 */
function pairsToUserData(pairs: PortfolioCreatorCopyPair[]): UserData[] {
  const userMap = new Map<string, UserData>()

  for (const pair of pairs) {
    if (!userMap.has(pair.distinct_id)) {
      userMap.set(pair.distinct_id, {
        distinct_id: pair.distinct_id,
        portfolio_tickers: new Set(),
        did_copy: pair.did_copy,
        copy_count: pair.copy_count,
      })
    }
    userMap.get(pair.distinct_id)!.portfolio_tickers.add(pair.portfolio_ticker)
  }

  return Array.from(userMap.values())
}

/**
 * Get top portfolios with sufficient engagement
 */
function getTopPortfolios(users: UserData[], minUsers = 5): string[] {
  const portfolioCounts = new Map<string, number>()

  for (const user of users) {
    for (const portfolioTicker of user.portfolio_tickers) {
      portfolioCounts.set(portfolioTicker, (portfolioCounts.get(portfolioTicker) || 0) + 1)
    }
  }

  const topPortfolios = Array.from(portfolioCounts.entries())
    .filter(([_, count]) => count >= minUsers)
    .sort((a, b) => b[1] - a[1])
    .map(([ticker, _]) => ticker)

  console.log(`Found ${topPortfolios.length} portfolios with >=${minUsers} user exposures`)
  return topPortfolios
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

    // Step 1: Load stored copy engagement data from Supabase
    console.log('Loading stored copy engagement data from Supabase...')
    const { data: pairRows, error: loadError } = await supabaseClient
      .from('user_portfolio_creator_copies')
      .select('*')

    if (loadError) {
      console.error('Error loading copy engagement data:', loadError)
      throw loadError
    }

    if (!pairRows || pairRows.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          warning: 'No copy engagement data found. Run sync-mixpanel first.',
          stats: { pairs_found: 0 }
        }),
        { headers: { 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    console.log(`✓ Loaded ${pairRows.length} portfolio-creator copy pairs from database`)

    // Refresh materialized views
    try {
      await supabaseClient.rpc('refresh_copy_engagement_summary')
      console.log('✓ copy_engagement_summary refreshed')

      await supabaseClient.rpc('refresh_hidden_gems')
      console.log('✓ hidden_gems refreshed')
    } catch (err) {
      console.warn('Warning: Failed to refresh materialized views:', err)
    }

    // Step 2: Run pattern analysis
    console.log('Starting pattern analysis...')
    const users = pairsToUserData(pairRows)

    if (users.length < 50) {
      return new Response(
        JSON.stringify({
          success: true,
          stats: { pairs_synced: pairRows.length },
          warning: 'Insufficient data for pattern analysis (need 50+ users)',
        }),
        { headers: { 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    const analyzedAt = new Date().toISOString()
    const batchSize = 500

    // Get portfolios with at least 3 users (balances coverage vs timeout risk)
    // Combinations are filtered by ≥1 exposure AND ≥1 conversion
    const allPortfolios = getTopPortfolios(users, 3) // Min 3 users per portfolio

    // Safety limit: Cap at 200 portfolios to prevent timeout
    // 200 portfolios = 1,313,400 combinations (~4-5 min processing time)
    const MAX_PORTFOLIOS = 200
    const topPortfolios = allPortfolios.slice(0, MAX_PORTFOLIOS)

    if (topPortfolios.length < 3) {
      return new Response(
        JSON.stringify({
          success: true,
          stats: { pairs_synced: pairRows.length },
          warning: 'Insufficient portfolios for pattern analysis (need 3+ with engagement)',
        }),
        { headers: { 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    const totalCombinations = (topPortfolios.length * (topPortfolios.length - 1) * (topPortfolios.length - 2)) / 6
    console.log(`Testing ${totalCombinations} combinations from ${topPortfolios.length} portfolios (${allPortfolios.length} total available, capped at ${MAX_PORTFOLIOS} for performance)`)

    const results: CombinationResult[] = []
    let processed = 0

    for (const combo of generateCombinations(topPortfolios, 3)) {
      const result = evaluateCombination(combo, users)

      // Only keep combinations where at least 1 user viewed all 3 portfolios AND at least 1 conversion occurred
      if (result.users_with_exposure > 0 && result.total_conversions > 0) {
        results.push(result)
      }

      processed++
      if (processed % 500 === 0) {
        console.log(`Processed ${processed}/${totalCombinations} combinations...`)
      }
    }

    console.log(`Kept ${results.length} combinations with at least 1 user exposure`)

    // Sort by AIC (lower is better model fit) and store ALL results
    // UI will handle filtering (minExposure) and limiting (top N)
    results.sort((a, b) => a.aic - b.aic)

    const insertRows = results.map((result, index) => ({
      analysis_type: 'copy',
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
      total_conversions: result.total_conversions,
      analyzed_at: analyzedAt,
    }))

    await supabaseClient
      .from('conversion_pattern_combinations')
      .delete()
      .eq('analysis_type', 'copy')

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

    console.log(`✓ Pattern analysis complete: ${insertRows.length} combinations stored`)

    const top10 = results.slice(0, 10).map(r => ({
      creators: r.combination,
      aic: Math.round(r.aic * 100) / 100,
      odds_ratio: Math.round(r.odds_ratio * 100) / 100,
      lift: Math.round(r.lift * 100) / 100,
      conversion_rate: Math.round(r.conversion_rate_in_group * 10000) / 100,
    }))

    return new Response(
      JSON.stringify({
        success: true,
        stats: {
          pairs_synced: pairRows.length,
          total_users: users.length,
          portfolios_tested: topPortfolios.length,
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
    console.error('Error in analyze-copy-patterns:', error)
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
