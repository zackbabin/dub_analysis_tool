import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const MIXPANEL_PROJECT_ID = '2599235'
const MIXPANEL_USERNAME = Deno.env.get('MIXPANEL_SERVICE_USERNAME') || ''
const MIXPANEL_PASSWORD = Deno.env.get('MIXPANEL_SERVICE_SECRET') || ''

const CHART_IDS = {
  portfolioSequenceFunnel: '85190800',
}

interface UserData {
  distinct_id: string
  portfolio_sequence: string[] // [portfolio1, portfolio2, portfolio3]
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

/**
 * Fetch Mixpanel funnel data
 */
async function fetchMixpanelChart(chartId: string, name: string): Promise<any> {
  console.log(`Fetching ${name} (ID: ${chartId})...`)

  const params = new URLSearchParams({
    project_id: MIXPANEL_PROJECT_ID,
    funnel_id: chartId,
    limit: '50000',
  })

  const authString = `${MIXPANEL_USERNAME}:${MIXPANEL_PASSWORD}`
  const authHeader = `Basic ${btoa(authString)}`

  const response = await fetch(`https://mixpanel.com/api/query/funnels?${params}`, {
    method: 'GET',
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Mixpanel API error (${response.status}): ${errorText}`)
  }

  const data = await response.json()
  console.log(`✓ ${name} fetch successful`)
  return data
}

/**
 * Parse funnel data to extract portfolio sequences
 * Structure: data -> date -> distinct_id -> portfolio_ticker -> array of steps
 * Each step has step_label ("First PDP View", "Second PDP View", "Third PDP View") and count
 * We extract the sequence by determining which portfolio was viewed at each position (1st, 2nd, 3rd)
 */
function parsePortfolioSequences(funnelData: any): Map<string, string[]> {
  const sequences = new Map<string, string[]>()

  // Navigate through the nested structure
  if (!funnelData?.data) {
    console.warn('No funnel data found')
    return sequences
  }

  // Get the most recent date's data
  const dates = Object.keys(funnelData.data).sort().reverse()
  if (dates.length === 0) {
    console.warn('No dates found in funnel data')
    return sequences
  }

  const dateData = funnelData.data[dates[0]]
  console.log(`Processing funnel data for date: ${dates[0]}`)

  // Iterate through distinct_ids (top level keys, excluding $overall)
  Object.entries(dateData).forEach(([distinctId, portfolioData]: [string, any]) => {
    if (distinctId === '$overall' || typeof portfolioData !== 'object' || portfolioData === null) return

    // For this user, determine which portfolio was viewed at each sequence position
    const positionMap: { [position: number]: string } = {}

    // Get all portfolio tickers for this user (keys that aren't $overall)
    const portfolioTickers = Object.keys(portfolioData).filter(key => key !== '$overall')

    // For each portfolio, check which step positions it appears in
    portfolioTickers.forEach(ticker => {
      const steps = portfolioData[ticker]
      if (!Array.isArray(steps)) return

      steps.forEach((step: any) => {
        if (step.count > 0) {
          if (step.step_label === 'First PDP View') {
            positionMap[1] = ticker
          } else if (step.step_label === 'Second PDP View') {
            positionMap[2] = ticker
          } else if (step.step_label === 'Third PDP View') {
            positionMap[3] = ticker
          }
        }
      })
    })

    // Build the sequence array in order
    const sequence: string[] = []
    if (positionMap[1]) sequence.push(positionMap[1])
    if (positionMap[2]) sequence.push(positionMap[2])
    if (positionMap[3]) sequence.push(positionMap[3])

    // Include users who viewed at least 1 portfolio
    if (sequence.length >= 1) {
      sequences.set(distinctId, sequence)
    }
  })

  console.log(`Extracted ${sequences.size} portfolio sequences (1-3 portfolios per user)`)
  return sequences
}

/**
 * Get copy outcomes from existing copy data
 */
async function getCopyOutcomes(supabaseClient: any): Promise<Map<string, { did_copy: boolean; copy_count: number }>> {
  const { data, error } = await supabaseClient
    .from('user_portfolio_creator_copies')
    .select('distinct_id, did_copy, copy_count')

  if (error) {
    console.error('Error fetching copy outcomes:', error)
    throw error
  }

  const outcomes = new Map<string, { did_copy: boolean; copy_count: number }>()

  // Aggregate by distinct_id (sum copy_count, did_copy = true if any copies)
  data.forEach((row: any) => {
    const existing = outcomes.get(row.distinct_id)
    if (existing) {
      outcomes.set(row.distinct_id, {
        did_copy: existing.did_copy || row.did_copy,
        copy_count: existing.copy_count + (row.copy_count || 0)
      })
    } else {
      outcomes.set(row.distinct_id, {
        did_copy: row.did_copy,
        copy_count: row.copy_count || 0
      })
    }
  })

  console.log(`Loaded copy outcomes for ${outcomes.size} users`)
  return outcomes
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
 * Evaluate a single portfolio sequence combination
 */
function evaluateCombination(
  combination: string[],
  users: UserData[]
): CombinationResult {
  const combinationSet = new Set(combination)

  const X: number[] = []
  const y: number[] = []

  for (const user of users) {
    // Check if user's sequence contains all portfolios in the combination (order doesn't matter)
    const hasExposure = combination.every(portfolio =>
      user.portfolio_sequence.includes(portfolio)
    )
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
 * Get top portfolios by frequency
 */
function getTopPortfolios(users: UserData[], minUsers = 10): string[] {
  const portfolioCounts = new Map<string, number>()

  for (const user of users) {
    for (const portfolio of user.portfolio_sequence) {
      portfolioCounts.set(portfolio, (portfolioCounts.get(portfolio) || 0) + 1)
    }
  }

  const topPortfolios = Array.from(portfolioCounts.entries())
    .filter(([_, count]) => count >= minUsers)
    .sort((a, b) => b[1] - a[1])
    .map(([id, _]) => id)

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

    const syncedAt = new Date().toISOString()

    // Step 1: Fetch funnel data from Mixpanel
    console.log('Fetching portfolio sequence funnel from Mixpanel...')
    const funnelData = await fetchMixpanelChart(
      CHART_IDS.portfolioSequenceFunnel,
      'Portfolio Sequence Funnel'
    )

    // Step 2: Parse sequences
    console.log('Parsing portfolio sequences...')
    const sequences = parsePortfolioSequences(funnelData)

    if (sequences.size < 50) {
      return new Response(
        JSON.stringify({
          success: true,
          warning: 'Insufficient sequences for analysis (need 50+ users with sequences)',
          stats: { sequences_found: sequences.size }
        }),
        { headers: { 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    // Step 3: Get copy outcomes
    console.log('Loading copy outcomes...')
    const copyOutcomes = await getCopyOutcomes(supabaseClient)

    // Step 4: Build user data combining sequences + outcomes
    const users: UserData[] = []
    sequences.forEach((sequence, distinctId) => {
      // Include all users with any portfolio views
      const outcome = copyOutcomes.get(distinctId) || { did_copy: false, copy_count: 0 }
      users.push({
        distinct_id: distinctId,
        portfolio_sequence: sequence,
        did_copy: outcome.did_copy,
        copy_count: outcome.copy_count
      })
    })

    console.log(`Built user data for ${users.length} users with sequences`)
    console.log(`Sequence length distribution:`)
    console.log(`  1 portfolio: ${users.filter(u => u.portfolio_sequence.length === 1).length}`)
    console.log(`  2 portfolios: ${users.filter(u => u.portfolio_sequence.length === 2).length}`)
    console.log(`  3 portfolios: ${users.filter(u => u.portfolio_sequence.length === 3).length}`)

    if (users.length < 50) {
      return new Response(
        JSON.stringify({
          success: true,
          warning: 'Insufficient data (need 50+ users with portfolio views)',
          stats: { users_found: users.length }
        }),
        { headers: { 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    // Step 5: Run pattern analysis
    console.log('Starting pattern analysis...')
    const topPortfolios = getTopPortfolios(users, 10).slice(0, 25)

    if (topPortfolios.length < 3) {
      return new Response(
        JSON.stringify({
          success: true,
          warning: 'Insufficient portfolios for pattern analysis (need 3+ with engagement)',
          stats: { portfolios_found: topPortfolios.length }
        }),
        { headers: { 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    const totalCombinations = (topPortfolios.length * (topPortfolios.length - 1) * (topPortfolios.length - 2)) / 6
    console.log(`Testing ${totalCombinations} combinations from ${topPortfolios.length} portfolios`)

    const results: CombinationResult[] = []
    let processed = 0

    for (const combo of generateCombinations(topPortfolios, 3)) {
      const result = evaluateCombination(combo, users)

      if (result.users_with_exposure >= users.length * 0.05) {
        results.push(result)
      }

      processed++
      if (processed % 500 === 0) {
        console.log(`Processed ${processed}/${totalCombinations} combinations...`)
      }
    }

    results.sort((a, b) => a.aic - b.aic)
    const topResults = results.slice(0, 100)

    const insertRows = topResults.map((result, index) => ({
      analysis_type: 'portfolio_sequence',
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
      analyzed_at: syncedAt,
    }))

    // Delete old results
    await supabaseClient
      .from('conversion_pattern_combinations')
      .delete()
      .eq('analysis_type', 'portfolio_sequence')

    // Insert new results in batches
    const batchSize = 500
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

    const top10 = topResults.slice(0, 10).map(r => ({
      portfolios: r.combination,
      aic: Math.round(r.aic * 100) / 100,
      odds_ratio: Math.round(r.odds_ratio * 100) / 100,
      lift: Math.round(r.lift * 100) / 100,
      conversion_rate: Math.round(r.conversion_rate_in_group * 10000) / 100,
    }))

    return new Response(
      JSON.stringify({
        success: true,
        stats: {
          sequences_found: sequences.size,
          complete_sequences: users.length,
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
    console.error('Error in analyze-portfolio-sequences:', error)
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
