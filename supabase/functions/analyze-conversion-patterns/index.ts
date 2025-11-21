// Supabase Edge Function: analyze-conversion-patterns
// MERGED: Combines analyze-subscription-patterns, analyze-copy-patterns, and analyze-creator-copy-patterns
// Analyzes conversion patterns using exhaustive search + logistic regression
// Supports 3 analysis types via request body parameter

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { CORS_HEADERS } from '../_shared/mixpanel-api.ts'
import { TimeoutGuard } from '../_shared/sync-helpers.ts'

// Analysis type configurations
// Supports two analysis types:
// - 'copy': Portfolio combinations that drive copies (uses portfolio_ticker)
// - 'creator_copy': Creator combinations that drive copies (uses creator_id/username)
const ANALYSIS_CONFIGS = {
  copy: {
    table: 'user_portfolio_creator_copies',  // Regular view (converted from materialized) - always current
    select: 'distinct_id, portfolio_ticker, pdp_view_count, copy_count, liquidation_count, did_copy, synced_at',
    filterColumn: 'pdp_view_count',
    outcomeColumn: 'did_copy',
    entityType: 'portfolio',
    entityIdColumn: 'portfolio_ticker',  // Key identifier for this entity type
  },
  creator_copy: {
    table: 'user_creator_profile_copies',  // Regular view - always current
    select: 'distinct_id, creator_id, creator_username, profile_view_count, did_copy, copy_count',
    filterColumn: 'profile_view_count',
    outcomeColumn: 'did_copy',
    entityType: 'creator',
    entityIdColumn: 'creator_id',  // Key identifier for this entity type
  },
}

interface UserData {
  distinct_id: string
  entity_ids: Set<string>  // Can be creator_ids or portfolio_tickers
  did_convert: boolean
  conversion_count: number
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
  total_views_1: number  // Total views for entity 1 (only users who viewed BOTH)
  total_views_2: number  // Total views for entity 2 (only users who viewed BOTH)
  total_copies: number   // Total copies by users who viewed BOTH entities
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
 * Now also calculates per-combination metrics for users who viewed BOTH entities
 */
function evaluateCombination(
  combination: string[],
  users: UserData[],
  pairRows: any[],
  entityType: string,
  filterColumn: string
): CombinationResult {
  const combinationSet = new Set(combination)

  const X: number[] = []
  const y: number[] = []

  // Track users who viewed BOTH entities for per-combination metrics
  const usersWithBothExposures = new Set<string>()

  for (const user of users) {
    // Check if user viewed BOTH entities in the combination
    const hasExposure = combination.every(id => user.entity_ids.has(id))
    X.push(hasExposure ? 1 : 0)
    y.push(user.did_convert ? 1 : 0)

    if (hasExposure) {
      usersWithBothExposures.add(user.distinct_id)
    }
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

  for (let i = 0; i < X.length; i++) {
    const hasExposure = X[i] === 1
    const didConvert = y[i] === 1

    if (hasExposure) {
      exposedTotal++
      if (didConvert) {
        exposedConverters++
        truePositives++
      } else {
        falsePositives++
      }
    } else {
      if (didConvert) {
        falseNegatives++
      } else {
        trueNegatives++
      }
    }
  }

  const precision = truePositives / (truePositives + falsePositives) || 0
  const recall = truePositives / (truePositives + falseNegatives) || 0
  const conversionRateInGroup = exposedTotal > 0 ? exposedConverters / exposedTotal : 0
  const lift = overallConversionRate > 0 ? conversionRateInGroup / overallConversionRate : 0

  // Calculate per-combination metrics for users who viewed BOTH entities
  let totalViewsEntity1 = 0
  let totalViewsEntity2 = 0
  let totalCopies = 0

  for (const pair of pairRows) {
    // Only include rows for users who viewed BOTH entities in this combination
    if (!usersWithBothExposures.has(pair.distinct_id)) continue

    const entityId = entityType === 'portfolio' ? pair.portfolio_ticker : pair.creator_id

    if (entityId === combination[0]) {
      totalViewsEntity1 += (pair[filterColumn] || 0)
    }
    if (entityId === combination[1]) {
      totalViewsEntity2 += (pair[filterColumn] || 0)
    }

    // Count copies (avoid double-counting same user)
    const copyCount = pair.copy_count || pair.subscription_count || 0
    totalCopies += copyCount
  }

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
    total_conversions: exposedConverters,
    total_views_1: totalViewsEntity1,
    total_views_2: totalViewsEntity2,
    total_copies: totalCopies,
  }
}

/**
 * Convert pairs to user-level data
 */
function pairsToUserData(
  pairs: any[],
  outcomeColumn: string,
  entityColumn: string
): UserData[] {
  const userMap = new Map<string, UserData>()

  for (const pair of pairs) {
    const entityId = entityColumn === 'portfolio' ? pair.portfolio_ticker : pair.creator_id

    if (!userMap.has(pair.distinct_id)) {
      userMap.set(pair.distinct_id, {
        distinct_id: pair.distinct_id,
        entity_ids: new Set(),
        did_convert: pair[outcomeColumn],
        conversion_count: pair.copy_count || pair.subscription_count || 0,
      })
    } else {
      // Update did_convert to true if ANY row has did_copy = true (OR logic)
      const userData = userMap.get(pair.distinct_id)!
      if (pair[outcomeColumn]) {
        userData.did_convert = true
      }
      // Accumulate conversion count
      userData.conversion_count += (pair.copy_count || pair.subscription_count || 0)
    }
    userMap.get(pair.distinct_id)!.entity_ids.add(entityId)
  }

  return Array.from(userMap.values())
}

/**
 * Get top entities with sufficient engagement
 */
function getTopEntities(users: UserData[], minUsers = 5): string[] {
  const entityCounts = new Map<string, number>()

  for (const user of users) {
    for (const entityId of user.entity_ids) {
      entityCounts.set(entityId, (entityCounts.get(entityId) || 0) + 1)
    }
  }

  const topEntities = Array.from(entityCounts.entries())
    .filter(([_, count]) => count >= minUsers)
    .sort((a, b) => b[1] - a[1])
    .map(([id, _]) => id)

  console.log(`Found ${topEntities.length} entities with >=${minUsers} user exposures`)
  return topEntities
}

/**
 * Main handler
 */
serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    // Parse request body to get analysis type
    const body = await req.json()
    const analysisType = body.analysis_type || 'copy'  // Default to portfolio copy analysis

    if (!ANALYSIS_CONFIGS[analysisType]) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Invalid analysis_type: ${analysisType}. Must be 'copy' or 'creator_copy'`
        }),
        { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    const config = ANALYSIS_CONFIGS[analysisType]
    console.log(`Starting ${analysisType} pattern analysis...`)

    // Initialize timeout guard
    const executionStartMs = Date.now()
    const timeoutGuard = new TimeoutGuard(executionStartMs)

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Step 1: Load stored engagement data from Supabase
    console.log(`Loading stored ${analysisType} data from ${config.table}...`)

    // Calculate 90-day cutoff date to limit data scope
    const ninetyDaysAgo = new Date()
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)
    const cutoffDate = ninetyDaysAgo.toISOString()

    console.log(`Only loading engagement data from last 90 days (since ${cutoffDate.split('T')[0]})`)

    let allPairRows: any[] = []
    let page = 0
    // Use 1000 to match PostgREST default limit - ensures pagination works correctly
    const pageSize = 1000
    let hasMore = true

    while (hasMore) {
      const offset = page * pageSize

      // Query with pagination (PostgREST has 1000 row default limit)
      const { data: pageData, error: loadError } = await supabaseClient
        .from(config.table)
        .select(config.select)
        .gt(config.filterColumn, 0)
        .gte('synced_at', cutoffDate) // Only load engagement from last 90 days
        .range(offset, offset + pageSize - 1)

      if (loadError) {
        console.error(`Error loading engagement data from ${config.table}:`, loadError)
        console.error(`Query details: table=${config.table}, filterColumn=${config.filterColumn}, page=${page}`)
        throw new Error(`Database query failed: ${loadError.message || JSON.stringify(loadError)}`)
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
          warning: 'No engagement data found. Run sync-mixpanel first.',
          stats: { pairs_found: 0 }
        }),
        { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    console.log(`✓ Loaded ${pairRows.length} pairs from database`)

    // Note: user_portfolio_creator_copies is now a regular view (no refresh needed)
    // Data is always current from the underlying user_portfolio_creator_engagement table

    // Step 2: Run pattern analysis
    console.log('Starting pattern analysis...')
    console.log(`Converting ${pairRows.length} pairs to user-level data...`)
    const users = pairsToUserData(pairRows, config.outcomeColumn, config.entityType)
    console.log(`✓ Converted to ${users.length} unique users`)

    // DIAGNOSTIC: Check user data quality
    const usersWithMultipleEntities = users.filter(u => u.entity_ids.size >= 2).length
    const usersWhoConverted = users.filter(u => u.did_convert).length
    const usersWithMultipleEntitiesAndConverted = users.filter(u => u.entity_ids.size >= 2 && u.did_convert).length
    console.log(`📊 DIAGNOSTIC - Users with 2+ entities: ${usersWithMultipleEntities}`)
    console.log(`📊 DIAGNOSTIC - Users who converted: ${usersWhoConverted}`)
    console.log(`📊 DIAGNOSTIC - Users with 2+ entities AND converted: ${usersWithMultipleEntitiesAndConverted}`)

    // Sample a few users to verify data structure
    const sampleUsers = users.slice(0, 3)
    console.log(`📊 DIAGNOSTIC - Sample users:`, JSON.stringify(sampleUsers.map(u => ({
      distinct_id: u.distinct_id,
      entity_count: u.entity_ids.size,
      entity_ids: Array.from(u.entity_ids),
      did_convert: u.did_convert,
      conversion_count: u.conversion_count
    }))))

    if (users.length < 50) {
      return new Response(
        JSON.stringify({
          success: true,
          stats: { pairs_synced: pairRows.length },
          warning: 'Insufficient data for pattern analysis (need 50+ users)',
        }),
        { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    const analyzedAt = new Date().toISOString()

    // Get entities with at least 1 user
    const allEntities = getTopEntities(users, 1)

    // Safety limit: Cap at 200 entities for 2-way analysis
    const MAX_ENTITIES = 200
    const topEntities = allEntities.slice(0, MAX_ENTITIES)

    if (topEntities.length < 2) {
      return new Response(
        JSON.stringify({
          success: true,
          stats: { pairs_synced: pairRows.length },
          warning: 'Insufficient entities for pattern analysis (need 2+ with engagement)',
        }),
        { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    const totalCombinations = (topEntities.length * (topEntities.length - 1)) / 2
    console.log(`Testing ${totalCombinations} 2-way combinations from ${topEntities.length} ${config.entityType}s (${allEntities.length} total available, capped at ${MAX_ENTITIES})`)

    // Stream results to database in batches
    const STREAM_BATCH_SIZE = 100
    let streamBatch: CombinationResult[] = []
    let processed = 0
    let keptCount = 0

    // Build entity ID to display name map
    // For creators: maps creator_id -> creator_username
    // For portfolios: maps portfolio_ticker -> portfolio_ticker (identity mapping for consistency)
    let entityIdToDisplayName = new Map<string, string>()
    if (config.entityType === 'creator') {
      console.log('Building creator username map...')
      for (const pair of pairRows) {
        if (pair.creator_id && pair.creator_username && !entityIdToDisplayName.has(pair.creator_id)) {
          entityIdToDisplayName.set(pair.creator_id, pair.creator_username)
        }
      }
      console.log(`✓ Mapped ${entityIdToDisplayName.size} creator IDs to usernames`)
    } else if (config.entityType === 'portfolio') {
      console.log('Building portfolio ticker map...')
      for (const pair of pairRows) {
        if (pair.portfolio_ticker && !entityIdToDisplayName.has(pair.portfolio_ticker)) {
          entityIdToDisplayName.set(pair.portfolio_ticker, pair.portfolio_ticker)
        }
      }
      console.log(`✓ Mapped ${entityIdToDisplayName.size} portfolio tickers`)
    }

    // Clear old data before streaming new results
    await supabaseClient
      .from('conversion_pattern_combinations')
      .delete()
      .eq('analysis_type', analysisType)

    // Check timeout before starting expensive operations
    if (timeoutGuard.isApproachingTimeout()) {
      console.warn('⏱️ Approaching 140s timeout before combination evaluation - returning early')
      timeoutGuard.logStatus('Pre-Combination-Eval')
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Timeout: Not enough time to complete analysis',
          elapsed_seconds: timeoutGuard.getElapsedSeconds()
        }),
        { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, status: 408 }
      )
    }

    // Parallel evaluation with controlled concurrency
    const EVAL_CONCURRENCY = 4
    const allCombinations = Array.from(generateCombinations(topEntities, 2))

    console.log(`Starting parallel evaluation with concurrency ${EVAL_CONCURRENCY}...`)
    console.log(`Total combinations to evaluate: ${allCombinations.length}`)

    // Process combinations in parallel chunks
    for (let i = 0; i < allCombinations.length; i += EVAL_CONCURRENCY) {
      // Check timeout periodically during loop
      if (timeoutGuard.isApproachingTimeout()) {
        console.warn(`⏱️ Approaching 140s timeout after evaluating ${i}/${allCombinations.length} combinations`)
        timeoutGuard.logStatus('During-Combination-Eval')
        break // Exit loop early but still insert partial results
      }

      const chunk = allCombinations.slice(i, Math.min(i + EVAL_CONCURRENCY, allCombinations.length))

      // Evaluate chunk in parallel
      const chunkResults = await Promise.all(
        chunk.map(combo => Promise.resolve(evaluateCombination(combo, users, pairRows, config.entityType, config.filterColumn)))
      )

      // Filter and collect results
      for (const result of chunkResults) {
        if (result.users_with_exposure > 0 && result.total_conversions > 0) {
          streamBatch.push(result)
          keptCount++

          // Insert batch when full
          if (streamBatch.length >= STREAM_BATCH_SIZE) {
            const batchToInsert = streamBatch.map((r, idx) => ({
              analysis_type: analysisType,
              combination_rank: keptCount - streamBatch.length + idx + 1,
              value_1: r.combination[0],
              value_2: r.combination[1],
              username_1: entityIdToDisplayName.get(r.combination[0]) || null,
              username_2: entityIdToDisplayName.get(r.combination[1]) || null,
              total_views_1: r.total_views_1,  // Per-combination metric (users who viewed BOTH entities)
              total_views_2: r.total_views_2,  // Per-combination metric (users who viewed BOTH entities)
              total_copies: r.total_copies,     // Per-combination metric (users who viewed BOTH entities)
              log_likelihood: r.log_likelihood,
              aic: r.aic,
              odds_ratio: r.odds_ratio,
              precision: r.precision,
              recall: r.recall,
              lift: r.lift,
              users_with_exposure: r.users_with_exposure,
              conversion_rate_in_group: r.conversion_rate_in_group,
              overall_conversion_rate: r.overall_conversion_rate,
              total_conversions: r.total_conversions,
              analyzed_at: analyzedAt,
            }))

            const { error: insertError } = await supabaseClient
              .from('conversion_pattern_combinations')
              .insert(batchToInsert)

            if (insertError) {
              console.error('Error inserting batch:', insertError)
              throw insertError
            }

            streamBatch = []
          }
        }
      }

      processed += chunk.length
      if (processed % 1000 === 0) {
        console.log(`Progress: ${processed}/${totalCombinations} combinations evaluated (${keptCount} kept)`)
      }
    }

    // Insert final batch
    if (streamBatch.length > 0) {
      // Check timeout before final insert
      if (timeoutGuard.isApproachingTimeout()) {
        console.warn(`⏱️ Approaching 140s timeout - skipping final batch insert of ${streamBatch.length} results`)
        timeoutGuard.logStatus('Before-Final-Insert')
      } else {
        const batchToInsert = streamBatch.map((r, idx) => ({
          analysis_type: analysisType,
          combination_rank: keptCount - streamBatch.length + idx + 1,
          value_1: r.combination[0],
          value_2: r.combination[1],
          username_1: entityIdToDisplayName.get(r.combination[0]) || null,
          username_2: entityIdToDisplayName.get(r.combination[1]) || null,
          total_views_1: r.total_views_1,  // Per-combination metric (users who viewed BOTH entities)
          total_views_2: r.total_views_2,  // Per-combination metric (users who viewed BOTH entities)
          total_copies: r.total_copies,     // Per-combination metric (users who viewed BOTH entities)
          log_likelihood: r.log_likelihood,
          aic: r.aic,
          odds_ratio: r.odds_ratio,
          precision: r.precision,
          recall: r.recall,
          lift: r.lift,
          users_with_exposure: r.users_with_exposure,
          conversion_rate_in_group: r.conversion_rate_in_group,
          overall_conversion_rate: r.overall_conversion_rate,
          total_conversions: r.total_conversions,
          analyzed_at: analyzedAt,
        }))

        const { error: insertError } = await supabaseClient
          .from('conversion_pattern_combinations')
          .insert(batchToInsert)

        if (insertError) {
          console.error('Error inserting final batch:', insertError)
          throw insertError
        }
      }
    }

    console.log(`✓ Completed ${analysisType} pattern analysis: ${keptCount} combinations with results`)

    return new Response(
      JSON.stringify({
        success: true,
        message: `${analysisType} pattern analysis completed successfully`,
        stats: {
          analysis_type: analysisType,
          pairs_synced: pairRows.length,
          users_analyzed: users.length,
          combinations_tested: totalCombinations,
          combinations_with_results: keptCount,
        },
      }),
      { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error) {
    console.error('Error in pattern analysis:', error)
    console.error('Error stack:', error.stack)
    console.error('Error type:', error.constructor.name)

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Unknown error occurred',
        error_type: error.constructor.name,
        details: error.toString(),
      }),
      { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
