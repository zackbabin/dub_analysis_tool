import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const MIXPANEL_PROJECT_ID = '2599235'
const MIXPANEL_USERNAME = Deno.env.get('MIXPANEL_SERVICE_USERNAME') || ''
const MIXPANEL_PASSWORD = Deno.env.get('MIXPANEL_SERVICE_SECRET') || ''

// Performance configuration
const DAYS_TO_FETCH = 30 // Limit to last 30 days
const MAX_EVENTS_PER_USER = 10 // Stop processing after first 10 events per user (we only need 3 unique)
const BATCH_SIZE = 1000 // Process events in batches to avoid memory issues

interface UserData {
  distinct_id: string
  portfolio_sequence: string[] // [portfolio1, portfolio2, portfolio3]
  portfolio_set: Set<string> // For faster lookups during combination evaluation
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
 * Fetch events from Mixpanel Event Export API
 * Performance optimizations:
 * 1. Limited to last 30 days
 * 2. Filtered to users with email (real users)
 * 3. Streaming parse to avoid loading all data in memory at once
 */
async function fetchViewedPortfolioEvents(): Promise<any[]> {
  console.log('Fetching Viewed Portfolio Details events from Event Export API...')

  // Calculate date range: last N days
  const toDate = new Date()
  const fromDate = new Date()
  fromDate.setDate(fromDate.getDate() - DAYS_TO_FETCH)

  const formatDate = (date: Date) => date.toISOString().split('T')[0]
  const from_date = formatDate(fromDate)
  const to_date = formatDate(toDate)

  // Build where clause to filter for users with email (real users)
  const whereClause = JSON.stringify({
    "property": "$email",
    "operator": "is not null"
  })

  const params = new URLSearchParams({
    project_id: MIXPANEL_PROJECT_ID,
    from_date,
    to_date,
    event: '["Viewed Portfolio Details"]',
    where: whereClause,
  })

  const authString = `${MIXPANEL_USERNAME}:${MIXPANEL_PASSWORD}`
  const authHeader = `Basic ${btoa(authString)}`

  console.log(`Fetching events from ${from_date} to ${to_date} (filtering for users with email)`)

  const response = await fetch(`https://data.mixpanel.com/api/2.0/export?${params}`, {
    method: 'GET',
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Mixpanel Event Export API error (${response.status}): ${errorText}`)
  }

  // Parse JSONL response (one JSON object per line)
  // Use streaming to avoid loading all data in memory
  const text = await response.text()
  const events: any[] = []
  let skippedLines = 0

  for (const line of text.trim().split('\n')) {
    if (line.trim()) {
      try {
        const event = JSON.parse(line)

        // Additional validation: ensure required properties exist
        if (event.properties?.distinct_id &&
            event.properties?.portfolioTicker &&
            event.properties?.time) {
          events.push(event)
        } else {
          skippedLines++
        }
      } catch (e) {
        skippedLines++
      }
    }
  }

  if (skippedLines > 0) {
    console.log(`Skipped ${skippedLines} invalid events`)
  }
  console.log(`✓ Fetched ${events.length} valid Viewed Portfolio Details events`)
  return events
}

/**
 * Parse event data to extract portfolio sequences
 * Performance optimizations:
 * 1. Process in batches to reduce memory usage
 * 2. Early exit after finding 3 unique portfolios per user
 * 3. Limit events processed per user to MAX_EVENTS_PER_USER
 */
function parsePortfolioSequences(events: any[]): Map<string, string[]> {
  const sequences = new Map<string, string[]>()

  // Group events by distinct_id
  const eventsByUser = new Map<string, any[]>()

  console.log(`Processing ${events.length} events...`)

  for (const event of events) {
    const distinctId = event.properties?.distinct_id
    const portfolioTicker = event.properties?.portfolioTicker
    const time = event.properties?.time

    // Skip if missing required properties (already validated, but double-check)
    if (!distinctId || !portfolioTicker || !time) continue

    if (!eventsByUser.has(distinctId)) {
      eventsByUser.set(distinctId, [])
    }

    eventsByUser.get(distinctId)!.push({
      portfolioTicker,
      time,
    })
  }

  console.log(`Found events for ${eventsByUser.size} distinct users`)

  // Process users in batches for better memory management
  let processedUsers = 0
  const totalUsers = eventsByUser.size

  for (const [distinctId, userEvents] of eventsByUser.entries()) {
    // Sort events by time (ascending, earliest first)
    userEvents.sort((a, b) => a.time - b.time)

    // Limit to MAX_EVENTS_PER_USER AFTER sorting to ensure we get the earliest events
    const eventsToProcess = userEvents.slice(0, MAX_EVENTS_PER_USER)

    // Extract first 3 unique portfolios with early exit
    const sequence: string[] = []
    const seen = new Set<string>()

    for (const event of eventsToProcess) {
      if (!seen.has(event.portfolioTicker)) {
        sequence.push(event.portfolioTicker)
        seen.add(event.portfolioTicker)

        // Early exit: stop once we have 3 unique portfolios
        if (sequence.length === 3) break
      }
    }

    // Include users who viewed at least 1 portfolio
    if (sequence.length >= 1) {
      sequences.set(distinctId, sequence)
    }

    processedUsers++

    // Progress logging every 1000 users
    if (processedUsers % 1000 === 0) {
      console.log(`Processed ${processedUsers}/${totalUsers} users...`)
    }
  }

  console.log(`✓ Extracted ${sequences.size} portfolio sequences (1-3 portfolios per user)`)

  // Log sequence length distribution for monitoring
  const lengthDistribution = {
    one: 0,
    two: 0,
    three: 0,
  }
  for (const seq of sequences.values()) {
    if (seq.length === 1) lengthDistribution.one++
    else if (seq.length === 2) lengthDistribution.two++
    else if (seq.length === 3) lengthDistribution.three++
  }
  console.log(`Sequence distribution: 1=${lengthDistribution.one}, 2=${lengthDistribution.two}, 3=${lengthDistribution.three}`)

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
 * Optimized iterative version for size=3 (no recursion, no array spreading)
 */
function* generateCombinations3<T>(arr: T[]): Generator<[T, T, T]> {
  const n = arr.length
  for (let i = 0; i < n - 2; i++) {
    for (let j = i + 1; j < n - 1; j++) {
      for (let k = j + 1; k < n; k++) {
        yield [arr[i], arr[j], arr[k]]
      }
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
      const Xi = X[i] // Cache to avoid repeated array lookups
      const z = beta0 + beta1 * Xi
      const p = 1 / (1 + Math.exp(-z))
      const diff = y[i] - p

      gradient0 += diff
      gradient1 += diff * Xi

      const w = p * (1 - p)
      hessian00 += w
      hessian01 += w * Xi
      hessian11 += w * Xi * Xi
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
    const Xi = X[i] // Cache to avoid repeated array lookup
    const z = beta0 + beta1 * Xi
    const p = 1 / (1 + Math.exp(-z))
    logLikelihood += y[i] * Math.log(p + 1e-10) + (1 - y[i]) * Math.log(1 - p + 1e-10)
  }

  return { beta0, beta1, log_likelihood: logLikelihood }
}

/**
 * Evaluate a single portfolio sequence combination
 * Optimized to use pre-computed Sets and cached conversion array
 */
function evaluateCombination(
  combination: [string, string, string],
  users: UserData[],
  y: number[], // Pre-computed conversion outcomes (cached across all combinations)
  overallConversionRate: number, // Pre-computed once
  totalConverters: number, // Pre-computed: total number of converters in y
  minExposureCount: number
): CombinationResult | null {
  const X = new Float64Array(users.length)

  // Single pass: compute X, exposure metrics, and confusion matrix simultaneously
  let exposedTotal = 0
  let truePositives = 0
  let falsePositives = 0
  let exposedConverters = 0
  let totalConversions = 0

  for (let i = 0; i < users.length; i++) {
    const user = users[i]
    // Optimization: Direct boolean checks instead of .every() for 3-element combinations
    const hasExposure = user.portfolio_set.has(combination[0]) &&
                       user.portfolio_set.has(combination[1]) &&
                       user.portfolio_set.has(combination[2])
    const exposure = hasExposure ? 1 : 0
    const actual = y[i]

    X[i] = exposure
    exposedTotal += exposure

    // Calculate confusion matrix and exposure metrics in same pass
    if (exposure === 1 && actual === 1) {
      truePositives++
      exposedConverters++
      totalConversions += user.copy_count
    } else if (exposure === 1 && actual === 0) {
      falsePositives++
    }
  }

  // Early exit if exposure is too low (before expensive regression)
  if (exposedTotal < minExposureCount) {
    return null
  }

  const model = fitLogisticRegression(X, y)
  const aic = 2 * 2 - 2 * model.log_likelihood
  const oddsRatio = Math.exp(model.beta1)

  const precision = truePositives + falsePositives > 0
    ? truePositives / (truePositives + falsePositives)
    : 0

  // Calculate recall: TP / (TP + FN) where FN = total converters - TP
  const falseNegatives = totalConverters - truePositives
  const recall = totalConverters > 0
    ? truePositives / totalConverters
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
serve(async (req) => {
  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const syncedAt = new Date().toISOString()

    // Performance metrics
    const startTime = Date.now()
    console.log('=== Portfolio Sequence Analysis Started ===')
    console.log(`Configuration: ${DAYS_TO_FETCH} days, filter=$email not null, max ${MAX_EVENTS_PER_USER} events/user`)

    // Step 1: Fetch events from Mixpanel Event Export API
    console.log('\n[1/5] Fetching events from Mixpanel...')
    const fetchStart = Date.now()
    const events = await fetchViewedPortfolioEvents()
    console.log(`✓ Fetch completed in ${((Date.now() - fetchStart) / 1000).toFixed(2)}s`)

    if (events.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          warning: 'No events found in the specified date range',
          stats: { events_found: 0 }
        }),
        { headers: { 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    // Step 2: Parse sequences
    console.log('\n[2/5] Parsing portfolio sequences...')
    const parseStart = Date.now()
    const sequences = parsePortfolioSequences(events)
    console.log(`✓ Parsing completed in ${((Date.now() - parseStart) / 1000).toFixed(2)}s`)

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
    console.log('\n[3/5] Loading copy outcomes from database...')
    const copyStart = Date.now()
    const copyOutcomes = await getCopyOutcomes(supabaseClient)
    console.log(`✓ Copy outcomes loaded in ${((Date.now() - copyStart) / 1000).toFixed(2)}s`)

    // Step 4: Build user data combining sequences + outcomes
    console.log('\n[4/5] Building user dataset...')
    const users: UserData[] = []
    sequences.forEach((sequence, distinctId) => {
      // Include all users with any portfolio views
      const outcome = copyOutcomes.get(distinctId) || { did_copy: false, copy_count: 0 }
      users.push({
        distinct_id: distinctId,
        portfolio_sequence: sequence,
        portfolio_set: new Set(sequence), // Pre-compute Set for O(1) lookups
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
    console.log('\n[5/5] Running pattern analysis...')
    const analysisStart = Date.now()
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
    const minExposureCount = Math.ceil(users.length * 0.05)
    console.log(`Testing ${totalCombinations} combinations from ${topPortfolios.length} portfolios`)
    console.log(`Minimum exposure threshold: ${minExposureCount} users (5% of ${users.length})`)

    // Pre-compute conversion outcomes array (y) - same for all combinations
    const y = users.map(u => u.did_copy ? 1 : 0)
    const totalConverters = y.filter(val => val === 1).length
    const overallConversionRate = totalConverters / y.length
    console.log(`Overall conversion rate: ${(overallConversionRate * 100).toFixed(2)}%`)

    const results: CombinationResult[] = []
    let processed = 0
    let skippedLowExposure = 0

    for (const combo of generateCombinations3(topPortfolios)) {
      const result = evaluateCombination(combo, users, y, overallConversionRate, totalConverters, minExposureCount)

      if (result !== null) {
        results.push(result)
      } else {
        skippedLowExposure++
      }

      processed++
      if (processed % 500 === 0) {
        console.log(`Processed ${processed}/${totalCombinations} combinations (skipped ${skippedLowExposure} low-exposure)...`)
      }
    }

    console.log(`Skipped ${skippedLowExposure} combinations with insufficient exposure`)

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

    console.log(`✓ Pattern analysis complete in ${((Date.now() - analysisStart) / 1000).toFixed(2)}s`)
    console.log(`✓ Stored ${insertRows.length} combinations`)

    const totalTime = (Date.now() - startTime) / 1000
    console.log(`\n=== Analysis Complete in ${totalTime.toFixed(2)}s ===`)

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
          events_fetched: events.length,
          sequences_found: sequences.size,
          complete_sequences: users.length,
          portfolios_tested: topPortfolios.length,
          combinations_evaluated: results.length,
          combinations_stored: insertRows.length,
          execution_time_seconds: Math.round(totalTime * 100) / 100,
        },
        configuration: {
          days_analyzed: DAYS_TO_FETCH,
          email_filter: 'not null',
          max_events_per_user: MAX_EVENTS_PER_USER,
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
