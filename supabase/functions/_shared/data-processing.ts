/**
 * Shared data processing utilities
 * Used by: sync-mixpanel-engagement
 */

// ============================================================================
// Creator ID Deduplication
// ============================================================================

// Deduplication map: Maps old/duplicate creator_ids to canonical creator_id
// Add entries here when duplicate usernames are discovered
const CREATOR_ID_DEDUP_MAP: Record<string, string> = {
  '118': '211855351476994048',  // @dubAdvisors: 118 is old id, use 211855351476994048
}

// Helper function to normalize creator_id (resolve duplicates)
const normalizeCreatorId = (creatorId: string): string => {
  return CREATOR_ID_DEDUP_MAP[creatorId] || creatorId
}

// ============================================================================
// Portfolio-Creator Pairs Processing
// ============================================================================

/**
 * Process portfolio-creator engagement data to create user-level pairs
 * Combines profile views, PDP views, subscriptions, copies, and liquidations into normalized pairs
 * @param profileViewsData - Profile views by creator (chart 85165851) - uses $user_id
 * @param pdpViewsData - PDP views, copies, liquidations by portfolio/creator (chart 85165580) - uses $user_id
 * @param subscriptionsData - Subscription events by user (chart 85165590) - uses $user_id
 * @param syncedAt - Timestamp for sync tracking
 * @returns Object with two arrays: portfolioCreatorPairs and creatorPairs
 * Note: Charts return $user_id, which maps to user_id column in staging tables
 */
export function processPortfolioCreatorPairs(
  profileViewsData: any,
  pdpViewsData: any,
  subscriptionsData: any,
  syncedAt: string
): { portfolioCreatorPairs: any[], creatorPairs: any[] } {
  const portfolioCreatorPairs: any[] = []

  // Use Map for O(1) lookups instead of array.find() O(n) - prevents memory/CPU issues with large datasets
  const creatorPairsMap = new Map<string, any>()

  // Build creator username map
  const creatorIdToUsername = new Map<string, string>()
  const profileMetric = profileViewsData?.series?.['Total Profile Views']
  if (profileMetric) {
    Object.entries(profileMetric).forEach(([userId, creatorData]: [string, any]) => {
      if (userId === '$overall' || typeof creatorData !== 'object' || creatorData === null) return

      Object.entries(creatorData).forEach(([rawCreatorId, usernameData]: [string, any]) => {
        if (rawCreatorId === '$overall' || typeof usernameData !== 'object' || usernameData === null) return

        // Normalize creator_id to handle duplicates
        const creatorId = normalizeCreatorId(rawCreatorId)

        Object.entries(usernameData).forEach(([username, viewCount]: [string, any]) => {
          if (username && username !== '$overall' && username !== 'undefined') {
            if (!creatorIdToUsername.has(creatorId)) {
              creatorIdToUsername.set(creatorId, username)
            }
          }
        })
      })
    })
  }

  // Build creator-level engagement pairs (profile views)
  // Chart 85165851 structure: $user_id -> creatorId -> creatorUsername -> { all: count }
  if (profileMetric) {
    Object.entries(profileMetric).forEach(([userId, creatorData]: [string, any]) => {
      if (userId === '$overall' || typeof creatorData !== 'object' || creatorData === null) return

      Object.entries(creatorData).forEach(([rawCreatorId, usernameData]: [string, any]) => {
        if (rawCreatorId === '$overall' || typeof usernameData !== 'object' || usernameData === null) return

        // Normalize creator_id to handle duplicates
        const creatorId = normalizeCreatorId(rawCreatorId)

        Object.entries(usernameData).forEach(([username, viewCount]: [string, any]) => {
          if (username && username !== '$overall' && username !== 'undefined') {
            const count = typeof viewCount === 'object' && viewCount !== null && 'all' in viewCount
              ? parseInt(String((viewCount as any).all))
              : parseInt(String(viewCount)) || 0

            if (count > 0) {
              // Use Map for O(1) lookup instead of array.find() O(n)
              // Map $user_id to distinct_id column (DB column name stays the same)
              const key = `${userId}|${creatorId}`
              const existingPair = creatorPairsMap.get(key)

              if (existingPair) {
                existingPair.profile_view_count += count
              } else {
                const newPair = {
                  user_id: userId,  // Mixpanel $user_id
                  creator_id: creatorId,
                  creator_username: username,
                  profile_view_count: count,
                  did_subscribe: false,
                  subscription_count: 0,
                  synced_at: syncedAt,
                }
                creatorPairsMap.set(key, newPair)
              }
            }
          }
        })
      })
    })
  }

  // Build subscription data and add to creator pairs
  // Chart 85165590 structure: $user_id -> creatorId -> creatorUsername -> { all: count }
  const subsMetric = subscriptionsData?.series?.['Total Subscriptions']
  if (subsMetric) {
    Object.entries(subsMetric).forEach(([userId, creatorData]: [string, any]) => {
      if (userId === '$overall' || typeof creatorData !== 'object' || creatorData === null) return

      Object.entries(creatorData).forEach(([rawCreatorId, usernameData]: [string, any]) => {
        if (rawCreatorId === '$overall' || typeof usernameData !== 'object' || usernameData === null) return

        // Normalize creator_id to handle duplicates
        const creatorId = normalizeCreatorId(rawCreatorId)

        Object.entries(usernameData).forEach(([username, subCount]: [string, any]) => {
          if (username && username !== '$overall' && username !== 'undefined') {
            const count = typeof subCount === 'object' && subCount !== null && 'all' in subCount
              ? parseInt(String((subCount as any).all)) || 0
              : parseInt(String(subCount)) || 0

            if (count > 0) {
              // Use Map for O(1) lookup instead of array.find() O(n)
              // Map $user_id to distinct_id column (DB column name stays the same)
              const key = `${userId}|${creatorId}`
              const existingPair = creatorPairsMap.get(key)

              if (existingPair) {
                existingPair.did_subscribe = true
                existingPair.subscription_count = count
              } else {
                const newPair = {
                  user_id: userId,  // Mixpanel $user_id
                  creator_id: creatorId,
                  creator_username: username,
                  profile_view_count: 0,
                  did_subscribe: true,
                  subscription_count: count,
                  synced_at: syncedAt,
                }
                creatorPairsMap.set(key, newPair)
              }
            }
          }
        })
      })
    })
  }

  // Process PDP views to create portfolio-creator pairs
  // Chart 85165580 contains: A. Total PDP Views, B. Total Copies, C. Total Liquidations
  // All metrics share the same nested structure: $user_id -> portfolioTicker -> creatorId -> creatorUsername -> { all: count }
  const pdpMetric = pdpViewsData?.series?.['A. Total PDP Views']
  const copiesMetric = pdpViewsData?.series?.['B. Total Copies']
  const liquidationsMetric = pdpViewsData?.series?.['C. Total Liquidations']

  // Collect all unique ($user_id, portfolioTicker, creatorId) combinations from ALL metrics
  // Store both raw and normalized creator IDs to properly aggregate duplicates
  // Key: normalized triplet, Value: array of raw creator IDs that map to it
  const allCombinations = new Map<string, string[]>()

  const addCombinationsFromMetric = (metric: any) => {
    if (!metric) return
    Object.entries(metric).forEach(([userId, portfolioData]: [string, any]) => {
      if (userId === '$overall' || typeof portfolioData !== 'object' || portfolioData === null) return
      Object.entries(portfolioData).forEach(([rawPortfolioTicker, creatorData]: [string, any]) => {
        if (rawPortfolioTicker === '$overall' || typeof creatorData !== 'object' || creatorData === null) return
        if (!rawPortfolioTicker || rawPortfolioTicker.length <= 1 || rawPortfolioTicker === 'null' || rawPortfolioTicker === 'undefined') return

        // Normalize portfolio ticker BEFORE building key to prevent duplicates (DOGE vs $DOGE)
        const normalizedPortfolioTicker = rawPortfolioTicker.startsWith('$') ? rawPortfolioTicker : '$' + rawPortfolioTicker

        Object.keys(creatorData).forEach(rawCreatorId => {
          if (rawCreatorId === '$overall') return
          // Normalize creator_id to handle duplicates
          const normalizedCreatorId = normalizeCreatorId(rawCreatorId)
          const key = `${userId}|${normalizedPortfolioTicker}|${normalizedCreatorId}`

          // Track all raw creator IDs that map to this normalized combination
          if (!allCombinations.has(key)) {
            allCombinations.set(key, [])
          }
          if (!allCombinations.get(key)!.includes(rawCreatorId)) {
            allCombinations.get(key)!.push(rawCreatorId)
          }
        })
      })
    })
  }

  addCombinationsFromMetric(pdpMetric)
  addCombinationsFromMetric(copiesMetric)
  addCombinationsFromMetric(liquidationsMetric)

  console.log(`Found ${allCombinations.size} unique portfolio-creator combinations across all metrics`)

  // Now process each unique combination
  allCombinations.forEach((rawCreatorIds, combinationKey) => {
    const [userId, portfolioTicker, normalizedCreatorId] = combinationKey.split('|')

    // portfolioTicker is already normalized (has $ prefix) from the key
    // But we need to check both with and without $ prefix when looking up in metrics
    const possibleTickerKeys = [portfolioTicker]
    if (portfolioTicker.startsWith('$')) {
      possibleTickerKeys.push(portfolioTicker.substring(1)) // Also try without $ prefix
    }

    // Aggregate data across all raw creator IDs that map to the normalized ID
    // This handles cases where duplicate creator IDs (like '118' and '211855351476994048') need to be merged
    let usernameData = null
    for (const rawCreatorId of rawCreatorIds) {
      for (const tickerKey of possibleTickerKeys) {
        const data = pdpMetric?.[userId]?.[tickerKey]?.[rawCreatorId]
          || copiesMetric?.[userId]?.[tickerKey]?.[rawCreatorId]
          || liquidationsMetric?.[userId]?.[tickerKey]?.[rawCreatorId]
        if (data && typeof data === 'object') {
          usernameData = data
          break
        }
      }
      if (usernameData) break
    }

    if (!usernameData || typeof usernameData !== 'object') return

    // Get creator username from the pre-built map OR extract from current metric data
    let creatorUsername = creatorIdToUsername.get(normalizedCreatorId)

    // If not in map, try to extract from the usernameData
    if (!creatorUsername) {
      const usernameKeys = Object.keys(usernameData).filter(k => k !== '$overall')
      if (usernameKeys.length > 0) {
        creatorUsername = usernameKeys[0]
        creatorIdToUsername.set(normalizedCreatorId, creatorUsername)
      }
    }

    if (!creatorUsername) {
      console.warn(`No username found for creatorId ${normalizedCreatorId} on portfolio ${portfolioTicker}`)
      return
    }

    // Aggregate metrics across all raw creator IDs that map to the normalized ID
    let pdpCount = 0
    let copyCount = 0
    let liquidationCount = 0

    for (const rawCreatorId of rawCreatorIds) {
      // Try all possible ticker key variations when looking up metrics
      for (const tickerKey of possibleTickerKeys) {
        // Extract PDP view count
        const pdpData = pdpMetric?.[userId]?.[tickerKey]?.[rawCreatorId]
        if (pdpData) {
          if (pdpData['$overall']) {
            const overallData = pdpData['$overall']
            pdpCount += typeof overallData === 'object' && overallData !== null && 'all' in overallData
              ? parseInt(String(overallData.all)) || 0
              : parseInt(String(overallData)) || 0
          } else if (pdpData[creatorUsername]) {
            const usernameViewData = pdpData[creatorUsername]
            pdpCount += typeof usernameViewData === 'object' && usernameViewData !== null && 'all' in usernameViewData
              ? parseInt(String(usernameViewData.all)) || 0
              : parseInt(String(usernameViewData)) || 0
          }
        }

        // Extract copy count
        const copyData = copiesMetric?.[userId]?.[tickerKey]?.[rawCreatorId]
        if (copyData) {
          if (copyData['$overall']) {
            const overallCopyData = copyData['$overall']
            copyCount += typeof overallCopyData === 'object' && overallCopyData !== null && 'all' in overallCopyData
              ? parseInt(String(overallCopyData.all)) || 0
              : parseInt(String(overallCopyData)) || 0
          } else if (copyData[creatorUsername]) {
            const creatorCopyData = copyData[creatorUsername]
            copyCount += typeof creatorCopyData === 'object' && creatorCopyData !== null && 'all' in creatorCopyData
              ? parseInt(String(creatorCopyData.all)) || 0
              : parseInt(String(creatorCopyData)) || 0
          }
        }

        // Extract liquidation count
        const liqData = liquidationsMetric?.[userId]?.[tickerKey]?.[rawCreatorId]
        if (liqData) {
          if (liqData['$overall']) {
            const overallLiqData = liqData['$overall']
            liquidationCount += typeof overallLiqData === 'object' && overallLiqData !== null && 'all' in overallLiqData
              ? parseInt(String(overallLiqData.all)) || 0
              : parseInt(String(overallLiqData)) || 0
          } else if (liqData[creatorUsername]) {
            const creatorLiqData = liqData[creatorUsername]
            liquidationCount += typeof creatorLiqData === 'object' && creatorLiqData !== null && 'all' in creatorLiqData
              ? parseInt(String(creatorLiqData.all)) || 0
              : parseInt(String(creatorLiqData)) || 0
          }
        }
      }
    }

    const didCopy = copyCount > 0

    // Get profile views and subscriptions for this creator from the creatorPairsMap
    const creatorKey = `${userId}|${normalizedCreatorId}`
    const creatorPair = creatorPairsMap.get(creatorKey)
    const profileViewCount = creatorPair?.profile_view_count || 0
    const subscriptionCount = creatorPair?.subscription_count || 0

    // Only create record if there's activity
    if (profileViewCount === 0 && pdpCount === 0 && copyCount === 0 && liquidationCount === 0 && subscriptionCount === 0) return

    // Add portfolio-creator engagement pair with correct column names for staging table
    portfolioCreatorPairs.push({
      user_id: userId,  // Mixpanel $user_id
      portfolio_ticker: portfolioTicker,
      creator_id: normalizedCreatorId,  // Use normalized ID to prevent duplicates
      creator_username: creatorUsername,  // Include for hidden_gems and other views
      total_profile_views: profileViewCount,
      total_pdp_views: pdpCount,
      total_copies: copyCount,
      total_liquidations: liquidationCount,
      total_subscriptions: subscriptionCount,
      synced_at: syncedAt,
    })
  })


  // Convert Map to array for return
  const creatorPairs = Array.from(creatorPairsMap.values())

  console.log(`Processed ${portfolioCreatorPairs.length} portfolio-creator pairs and ${creatorPairs.length} creator pairs`)
  return { portfolioCreatorPairs, creatorPairs }
}

// ============================================================================
// Portfolio-Creator Copy Metrics Processing (Aggregated, not user-level)
// ============================================================================

/**
 * Process portfolio-level aggregated copy and liquidation metrics from Mixpanel
 * Chart 86055000 structure: portfolioTicker -> creatorId -> creatorUsername -> { all: count }
 * @param copyData - Copy metrics from chart 86055000
 * @param syncedAt - Timestamp for sync tracking
 * @returns Array of portfolio-creator copy metrics
 */
export function processPortfolioCreatorCopyMetrics(
  copyData: any,
  syncedAt: string
): any[] {
  const metrics: any[] = []

  if (!copyData || !copyData.series) {
    console.log('No portfolio-creator copy data to process')
    return []
  }

  const copiesMetric = copyData.series['A. Total Copies']
  const liquidationsMetric = copyData.series['B. Total Liquidations']

  // Collect all unique (portfolioTicker, creatorId) combinations
  const allCombinations = new Set<string>()

  const addCombinationsFromMetric = (metric: any) => {
    if (!metric) return
    Object.entries(metric).forEach(([portfolioTicker, creatorData]: [string, any]) => {
      if (portfolioTicker === '$overall' || typeof creatorData !== 'object' || creatorData === null) return
      if (!portfolioTicker || portfolioTicker.length <= 1 || portfolioTicker === 'null' || portfolioTicker === 'undefined') return

      Object.keys(creatorData).forEach(rawCreatorId => {
        if (rawCreatorId === '$overall') return
        const creatorId = normalizeCreatorId(rawCreatorId)
        allCombinations.add(`${portfolioTicker}|${creatorId}`)
      })
    })
  }

  addCombinationsFromMetric(copiesMetric)
  addCombinationsFromMetric(liquidationsMetric)

  console.log(`Found ${allCombinations.size} unique portfolio-creator combinations for copy metrics`)

  // Process each combination
  allCombinations.forEach(combinationKey => {
    const [rawPortfolioTicker, creatorId] = combinationKey.split('|')

    // Normalize portfolio ticker: ensure it always has $ prefix
    const portfolioTicker = rawPortfolioTicker.startsWith('$') ? rawPortfolioTicker : '$' + rawPortfolioTicker

    // Get creator username from either metric
    let creatorUsername = null
    const copyCreatorData = copiesMetric?.[rawPortfolioTicker]?.[creatorId]
    const liqCreatorData = liquidationsMetric?.[rawPortfolioTicker]?.[creatorId]

    if (copyCreatorData && typeof copyCreatorData === 'object') {
      const usernameKeys = Object.keys(copyCreatorData).filter(k => k !== '$overall')
      if (usernameKeys.length > 0) {
        const rawUsername = usernameKeys[0]
        // Ensure username has @ prefix for consistency
        creatorUsername = rawUsername.startsWith('@') ? rawUsername : `@${rawUsername}`
      }
    }

    if (!creatorUsername && liqCreatorData && typeof liqCreatorData === 'object') {
      const usernameKeys = Object.keys(liqCreatorData).filter(k => k !== '$overall')
      if (usernameKeys.length > 0) {
        const rawUsername = usernameKeys[0]
        // Ensure username has @ prefix for consistency
        creatorUsername = rawUsername.startsWith('@') ? rawUsername : `@${rawUsername}`
      }
    }

    if (!creatorUsername) {
      console.warn(`No username found for creatorId ${creatorId} on portfolio ${portfolioTicker}`)
      return
    }

    // Extract copy count
    let copyCount = 0
    if (copyCreatorData) {
      if (copyCreatorData['$overall']) {
        const overallData = copyCreatorData['$overall']
        copyCount = typeof overallData === 'object' && overallData !== null && 'all' in overallData
          ? parseInt(String(overallData.all)) || 0
          : parseInt(String(overallData)) || 0
      } else if (copyCreatorData[creatorUsername]) {
        const usernameData = copyCreatorData[creatorUsername]
        copyCount = typeof usernameData === 'object' && usernameData !== null && 'all' in usernameData
          ? parseInt(String(usernameData.all)) || 0
          : parseInt(String(usernameData)) || 0
      }
    }

    // Extract liquidation count
    let liquidationCount = 0
    if (liqCreatorData) {
      if (liqCreatorData['$overall']) {
        const overallData = liqCreatorData['$overall']
        liquidationCount = typeof overallData === 'object' && overallData !== null && 'all' in overallData
          ? parseInt(String(overallData.all)) || 0
          : parseInt(String(overallData)) || 0
      } else if (liqCreatorData[creatorUsername]) {
        const usernameData = liqCreatorData[creatorUsername]
        liquidationCount = typeof usernameData === 'object' && usernameData !== null && 'all' in usernameData
          ? parseInt(String(usernameData.all)) || 0
          : parseInt(String(usernameData)) || 0
      }
    }

    // Only create record if there's activity
    if (copyCount === 0 && liquidationCount === 0) return

    metrics.push({
      portfolio_ticker: portfolioTicker,
      creator_id: creatorId,
      creator_username: creatorUsername,
      total_copies: copyCount,
      total_liquidations: liquidationCount,
      synced_at: syncedAt,
    })
  })

  console.log(`Processed ${metrics.length} portfolio-creator copy metrics`)
  return metrics
}
