import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

interface UserData {
  distinct_id: string
  creator_ids: Set<string>
  did_copy: boolean
  copy_count: number
}

interface CombinationResult {
  combination: [string, string]
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

interface CreatorCopyPair {
  distinct_id: string
  creator_id: string
  creator_username: string | null
  profile_view_count: number
  did_copy: boolean
  copy_count: number
}

/**
 * Generate all 2-element combinations from an array
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
    // Check if user viewed BOTH creators in the combination
    const hasExposure = combination.every(creatorId => user.creator_ids.has(creatorId))
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
    combination: combination as [string, string],
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
function pairsToUserData(pairs: CreatorCopyPair[]): UserData[] {
  const userMap = new Map<string, UserData>()

  for (const pair of pairs) {
    if (!userMap.has(pair.distinct_id)) {
      userMap.set(pair.distinct_id, {
        distinct_id: pair.distinct_id,
        creator_ids: new Set(),
        did_copy: pair.did_copy,
        copy_count: pair.copy_count,
      })
    }
    // Only add creator if they have profile views
    if (pair.profile_view_count > 0) {
      userMap.get(pair.distinct_id)!.creator_ids.add(pair.creator_id)
    }
  }

  return Array.from(userMap.values())
}

/**
 * Get top creators with sufficient engagement
 */
function getTopCreators(users: UserData[], minUsers = 5): string[] {
  const creatorCounts = new Map<string, number>()

  for (const user of users) {
    for (const creatorId of user.creator_ids) {
      creatorCounts.set(creatorId, (creatorCounts.get(creatorId) || 0) + 1)
    }
  }

  const topCreators = Array.from(creatorCounts.entries())
    .filter(([_, count]) => count >= minUsers)
    .sort((a, b) => b[1] - a[1])
    .map(([creatorId, _]) => creatorId)

  console.log(`Found ${topCreators.length} creators with >=${minUsers} user exposures`)
  return topCreators
}

/**
 * Build creator ID to username mapping
 */
function buildCreatorUsernameMap(pairs: CreatorCopyPair[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const pair of pairs) {
    if (pair.creator_username) {
      map.set(pair.creator_id, pair.creator_username)
    }
  }
  return map
}

/**
 * Calculate total profile views per creator
 */
function calculateTotalViewsByCreator(pairs: CreatorCopyPair[]): Map<string, number> {
  const viewsMap = new Map<string, number>()
  for (const pair of pairs) {
    const currentViews = viewsMap.get(pair.creator_id) || 0
    viewsMap.set(pair.creator_id, currentViews + pair.profile_view_count)
  }
  return viewsMap
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

    // Step 1: Load stored creator copy engagement data from Supabase
    console.log('Loading stored creator copy engagement data from Supabase...')

    // Fetch ALL rows (Supabase defaults to 1000 limit, we need to override)
    let allPairRows: any[] = []
    let page = 0
    const pageSize = 10000
    let hasMore = true

    while (hasMore) {
      const { data: pageData, error: loadError } = await supabaseClient
        .from('user_portfolio_creator_copies')
        .select('distinct_id, creator_id, creator_username, profile_view_count, did_copy, copy_count')
        .range(page * pageSize, (page + 1) * pageSize - 1)

      if (loadError) {
        console.error('Error loading creator copy engagement data:', loadError)
        throw loadError
      }

      if (!pageData || pageData.length === 0) {
        hasMore = false
      } else {
        allPairRows = allPairRows.concat(pageData)
        page++
        console.log(`Loaded page ${page}: ${pageData.length} rows (total: ${allPairRows.length})`)

        if (pageData.length < pageSize) {
          hasMore = false
        }
      }
    }

    const pairRows = allPairRows

    if (!pairRows || pairRows.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          warning: 'No creator copy engagement data found. Run sync-mixpanel first.',
          stats: { pairs_found: 0 }
        }),
        { headers: { 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    console.log(`✓ Loaded ${pairRows.length} creator copy pairs from database`)

    // Build creator username mapping
    const creatorUsernameMap = buildCreatorUsernameMap(pairRows)
    console.log(`✓ Built username mapping for ${creatorUsernameMap.size} creators`)

    // Calculate total profile views per creator
    const creatorViewsMap = calculateTotalViewsByCreator(pairRows)
    console.log(`✓ Calculated total views for ${creatorViewsMap.size} creators`)

    // Step 2: Run pattern analysis
    console.log('Starting pattern analysis...')
    console.log(`Converting ${pairRows.length} pairs to user-level data...`)
    const users = pairsToUserData(pairRows)
    console.log(`✓ Converted to ${users.length} unique users`)

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

    // Get creators with at least 1 user (maximize coverage)
    // Combinations are filtered by ≥1 exposure AND ≥1 conversion
    const allCreators = getTopCreators(users, 1) // Min 1 user per creator

    // Safety limit: Cap at 200 creators for 2-way analysis
    // 200 creators = 19,900 pairs
    const MAX_CREATORS = 200
    const topCreators = allCreators.slice(0, MAX_CREATORS)

    if (topCreators.length < 2) {
      return new Response(
        JSON.stringify({
          success: true,
          stats: { pairs_synced: pairRows.length },
          warning: 'Insufficient creators for pattern analysis (need 2+ with engagement)',
        }),
        { headers: { 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    const totalCombinations = (topCreators.length * (topCreators.length - 1)) / 2
    console.log(`Testing ${totalCombinations} 2-way combinations from ${topCreators.length} creators (${allCreators.length} total available, capped at ${MAX_CREATORS})`)

    const results: CombinationResult[] = []
    let processed = 0

    for (const combo of generateCombinations(topCreators, 2)) {
      const result = evaluateCombination(combo, users)

      // Only keep combinations where at least 1 user viewed both creators AND at least 1 conversion occurred
      if (result.users_with_exposure > 0 && result.total_conversions > 0) {
        results.push(result)
      }

      processed++
      if (processed % 1000 === 0) {
        console.log(`Processed ${processed}/${totalCombinations} combinations...`)
      }
    }

    console.log(`Kept ${results.length} combinations with at least 1 user exposure`)

    // Sort by Expected Value (lift × total_conversions) - balances impact and volume
    results.sort((a, b) => {
      const evA = a.lift * a.total_conversions
      const evB = b.lift * b.total_conversions
      return evB - evA // Descending order
    })

    const insertRows = results.map((result, index) => ({
      analysis_type: 'creator_copy',
      combination_rank: index + 1,
      value_1: result.combination[0],
      value_2: result.combination[1],
      username_1: creatorUsernameMap.get(result.combination[0]) || null,
      username_2: creatorUsernameMap.get(result.combination[1]) || null,
      total_views_1: creatorViewsMap.get(result.combination[0]) || 0,
      total_views_2: creatorViewsMap.get(result.combination[1]) || 0,
      lift: result.lift,
      users_with_exposure: result.users_with_exposure,
      conversion_rate_in_group: result.conversion_rate_in_group,
      overall_conversion_rate: result.overall_conversion_rate,
      total_conversions: result.total_conversions,
      analyzed_at: analyzedAt,
    }))

    // Delete old results
    await supabaseClient
      .from('conversion_pattern_combinations')
      .delete()
      .eq('analysis_type', 'creator_copy')

    // Insert new results in batches
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
      creators: [
        creatorUsernameMap.get(r.combination[0]) || r.combination[0],
        creatorUsernameMap.get(r.combination[1]) || r.combination[1]
      ],
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
          creators_tested: topCreators.length,
          combinations_total: totalCombinations,
          combinations_processed: processed,
          combinations_evaluated: results.length,
          combinations_stored: insertRows.length,
          completion_percentage: 100,
        },
        top_10_combinations: top10,
      }),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error: any) {
    console.error('Error in analyze-creator-copy-patterns:', error)
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
