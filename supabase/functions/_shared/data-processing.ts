/**
 * Shared data processing utilities
 * Used by: sync-mixpanel-funnels, sync-mixpanel-engagement
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
// Funnel Data Processing
// ============================================================================

/**
 * Process funnel data from Mixpanel Funnels API
 * Extracts user-level completion times for funnel analysis
 * @param data - Raw funnel data from Mixpanel
 * @param funnelType - Type identifier (e.g., 'time_to_first_copy')
 * @returns Array of processed funnel records
 */
export function processFunnelData(data: any, funnelType: string): any[] {
  if (!data || !data.data) {
    console.log(`No funnel data for ${funnelType}`)
    return []
  }

  const rows: any[] = []

  // Funnels API returns data grouped by date, then by distinct_id
  // Structure: { data: { "2025-09-29": { "$overall": [...], "distinct_id_1": [...], ... } } }

  Object.entries(data.data).forEach(([date, dateData]: [string, any]) => {
    if (!dateData || typeof dateData !== 'object') return

    Object.entries(dateData).forEach(([key, steps]: [string, any]) => {
      // Skip $overall aggregate
      if (key === '$overall') return

      // Key can be distinct_id or $device:xxx format
      let distinctId = key

      // If it's a device ID format, extract just the device ID part
      if (key.startsWith('$device:')) {
        distinctId = key.replace('$device:', '')
      }

      // steps is an array of funnel steps
      if (!Array.isArray(steps) || steps.length === 0) return

      // Get the last step (final conversion step)
      const finalStep = steps[steps.length - 1]

      // Only include if user completed the funnel (count > 0 on final step)
      // and we have a time value
      if (finalStep.count > 0 && finalStep.avg_time_from_start) {
        const timeInSeconds = parseFloat(finalStep.avg_time_from_start)

        if (timeInSeconds > 0) {
          rows.push({
            distinct_id: distinctId,
            funnel_type: funnelType,
            time_in_seconds: timeInSeconds,
            time_in_days: timeInSeconds / 86400,
            synced_at: new Date().toISOString(),
          })
        }
      }
    })
  })

  console.log(`Processed ${rows.length} ${funnelType} records`)
  return rows
}

// ============================================================================
// Portfolio-Creator Pairs Processing
// ============================================================================

/**
 * Process portfolio-creator engagement data to create user-level pairs
 * Combines profile views, PDP views, subscriptions, copies, and liquidations into normalized pairs
 * @param profileViewsData - Profile views by creator (chart 85165851)
 * @param pdpViewsData - PDP views, copies, liquidations by portfolio/creator (chart 85165580)
 * @param subscriptionsData - Subscription events by user (chart 85165590)
 * @param syncedAt - Timestamp for sync tracking
 * @returns Object with two arrays: portfolioCreatorPairs and creatorPairs
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
    Object.entries(profileMetric).forEach(([distinctId, creatorData]: [string, any]) => {
      if (distinctId === '$overall' || typeof creatorData !== 'object' || creatorData === null) return

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
  // Chart 85165851 structure: distinctId -> creatorId -> creatorUsername -> { all: count }
  if (profileMetric) {
    Object.entries(profileMetric).forEach(([distinctId, creatorData]: [string, any]) => {
      if (distinctId === '$overall' || typeof creatorData !== 'object' || creatorData === null) return

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
              const key = `${distinctId}|${creatorId}`
              const existingPair = creatorPairsMap.get(key)

              if (existingPair) {
                existingPair.profile_view_count += count
              } else {
                const newPair = {
                  distinct_id: distinctId,
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
  // Chart 85165590 structure: distinctId -> creatorId -> creatorUsername -> { all: count }
  const subsMetric = subscriptionsData?.series?.['Total Subscriptions']
  if (subsMetric) {
    Object.entries(subsMetric).forEach(([distinctId, creatorData]: [string, any]) => {
      if (distinctId === '$overall' || typeof creatorData !== 'object' || creatorData === null) return

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
              const key = `${distinctId}|${creatorId}`
              const existingPair = creatorPairsMap.get(key)

              if (existingPair) {
                existingPair.did_subscribe = true
                existingPair.subscription_count = count
              } else {
                const newPair = {
                  distinct_id: distinctId,
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
  // All metrics share the same nested structure: distinctId -> portfolioTicker -> creatorId -> creatorUsername -> { all: count }
  const pdpMetric = pdpViewsData?.series?.['A. Total PDP Views']
  const copiesMetric = pdpViewsData?.series?.['B. Total Copies']
  const liquidationsMetric = pdpViewsData?.series?.['C. Total Liquidations']

  // Collect all unique (distinctId, portfolioTicker, creatorId) combinations from ALL metrics
  // This ensures we don't miss copies or liquidations that exist without PDP views
  const allCombinations = new Set<string>()

  const addCombinationsFromMetric = (metric: any) => {
    if (!metric) return
    Object.entries(metric).forEach(([distinctId, portfolioData]: [string, any]) => {
      if (distinctId === '$overall' || typeof portfolioData !== 'object' || portfolioData === null) return
      Object.entries(portfolioData).forEach(([portfolioTicker, creatorData]: [string, any]) => {
        if (portfolioTicker === '$overall' || typeof creatorData !== 'object' || creatorData === null) return
        if (!portfolioTicker || portfolioTicker.length <= 1 || portfolioTicker === 'null' || portfolioTicker === 'undefined') return
        Object.keys(creatorData).forEach(rawCreatorId => {
          if (rawCreatorId === '$overall') return
          // Normalize creator_id to handle duplicates
          const creatorId = normalizeCreatorId(rawCreatorId)
          allCombinations.add(`${distinctId}|${portfolioTicker}|${creatorId}`)
        })
      })
    })
  }

  addCombinationsFromMetric(pdpMetric)
  addCombinationsFromMetric(copiesMetric)
  addCombinationsFromMetric(liquidationsMetric)

  console.log(`Found ${allCombinations.size} unique portfolio-creator combinations across all metrics`)

  // Now process each unique combination
  allCombinations.forEach(combinationKey => {
    const [distinctId, rawPortfolioTicker, creatorId] = combinationKey.split('|')

    // Get the username data from any metric that has it (prefer PDP metric)
    // Use rawPortfolioTicker (as it appears in Mixpanel) for lookup
    let usernameData = pdpMetric?.[distinctId]?.[rawPortfolioTicker]?.[creatorId]
    if (!usernameData) usernameData = copiesMetric?.[distinctId]?.[rawPortfolioTicker]?.[creatorId]
    if (!usernameData) usernameData = liquidationsMetric?.[distinctId]?.[rawPortfolioTicker]?.[creatorId]

    if (!usernameData || typeof usernameData !== 'object') return

    // Get creator username from the pre-built map OR extract from current metric data
    let creatorUsername = creatorIdToUsername.get(creatorId)

    // If not in map, try to extract from the usernameData
    if (!creatorUsername) {
      const usernameKeys = Object.keys(usernameData).filter(k => k !== '$overall')
      if (usernameKeys.length > 0) {
        creatorUsername = usernameKeys[0]
        creatorIdToUsername.set(creatorId, creatorUsername)
      }
    }

    if (!creatorUsername) {
      console.warn(`No username found for creatorId ${creatorId} on portfolio ${rawPortfolioTicker}`)
      return
    }

    // Normalize portfolio ticker: ensure it always has $ prefix
    const portfolioTicker = rawPortfolioTicker.startsWith('$') ? rawPortfolioTicker : '$' + rawPortfolioTicker

    // Extract PDP view count
    let pdpCount = 0
    const pdpData = pdpMetric?.[distinctId]?.[rawPortfolioTicker]?.[creatorId]
    if (pdpData) {
      if (pdpData['$overall']) {
        const overallData = pdpData['$overall']
        pdpCount = typeof overallData === 'object' && overallData !== null && 'all' in overallData
          ? parseInt(String(overallData.all)) || 0
          : parseInt(String(overallData)) || 0
      } else if (pdpData[creatorUsername]) {
        const usernameViewData = pdpData[creatorUsername]
        pdpCount = typeof usernameViewData === 'object' && usernameViewData !== null && 'all' in usernameViewData
          ? parseInt(String(usernameViewData.all)) || 0
          : parseInt(String(usernameViewData)) || 0
      }
    }

    // Extract copy count
    let copyCount = 0
    let didCopy = false
    const copyData = copiesMetric?.[distinctId]?.[rawPortfolioTicker]?.[creatorId]
    if (copyData) {
      if (copyData['$overall']) {
        const overallCopyData = copyData['$overall']
        copyCount = typeof overallCopyData === 'object' && overallCopyData !== null && 'all' in overallCopyData
          ? parseInt(String(overallCopyData.all)) || 0
          : parseInt(String(overallCopyData)) || 0
      } else if (copyData[creatorUsername]) {
        const creatorCopyData = copyData[creatorUsername]
        copyCount = typeof creatorCopyData === 'object' && creatorCopyData !== null && 'all' in creatorCopyData
          ? parseInt(String(creatorCopyData.all)) || 0
          : parseInt(String(creatorCopyData)) || 0
      }
      didCopy = copyCount > 0
    }

    // Extract liquidation count
    let liquidationCount = 0
    const liqData = liquidationsMetric?.[distinctId]?.[rawPortfolioTicker]?.[creatorId]
    if (liqData) {
      if (liqData['$overall']) {
        const overallLiqData = liqData['$overall']
        liquidationCount = typeof overallLiqData === 'object' && overallLiqData !== null && 'all' in overallLiqData
          ? parseInt(String(overallLiqData.all)) || 0
          : parseInt(String(overallLiqData)) || 0
      } else if (liqData[creatorUsername]) {
        const creatorLiqData = liqData[creatorUsername]
        liquidationCount = typeof creatorLiqData === 'object' && creatorLiqData !== null && 'all' in creatorLiqData
          ? parseInt(String(creatorLiqData.all)) || 0
          : parseInt(String(creatorLiqData)) || 0
      }
    }

    // Only create record if there's activity
    if (pdpCount === 0 && copyCount === 0 && liquidationCount === 0) return

    // Add portfolio-creator engagement pair
    portfolioCreatorPairs.push({
      distinct_id: distinctId,
      portfolio_ticker: portfolioTicker,
      creator_id: creatorId,
      creator_username: creatorUsername,
      pdp_view_count: pdpCount,
      did_copy: didCopy,
      copy_count: copyCount,
      liquidation_count: liquidationCount,
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
