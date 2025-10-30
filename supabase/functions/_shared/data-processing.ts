/**
 * Shared data processing utilities
 * Used by: sync-mixpanel-funnels, sync-mixpanel-engagement
 */

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
  const creatorPairs: any[] = []

  // Build creator username map
  const creatorIdToUsername = new Map<string, string>()
  const profileMetric = profileViewsData?.series?.['Total Profile Views']
  if (profileMetric) {
    Object.entries(profileMetric).forEach(([distinctId, creatorData]: [string, any]) => {
      if (distinctId === '$overall' || typeof creatorData !== 'object' || creatorData === null) return

      Object.entries(creatorData).forEach(([creatorId, usernameData]: [string, any]) => {
        if (creatorId === '$overall' || typeof usernameData !== 'object' || usernameData === null) return

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

      Object.entries(creatorData).forEach(([creatorId, usernameData]: [string, any]) => {
        if (creatorId === '$overall' || typeof usernameData !== 'object' || usernameData === null) return

        Object.entries(usernameData).forEach(([username, viewCount]: [string, any]) => {
          if (username && username !== '$overall' && username !== 'undefined') {
            const count = typeof viewCount === 'object' && viewCount !== null && 'all' in viewCount
              ? parseInt(String((viewCount as any).all))
              : parseInt(String(viewCount)) || 0

            if (count > 0) {
              // Find or create creator pair
              const existingPair = creatorPairs.find(
                p => p.distinct_id === distinctId && p.creator_id === creatorId
              )

              if (existingPair) {
                existingPair.profile_view_count += count
              } else {
                creatorPairs.push({
                  distinct_id: distinctId,
                  creator_id: creatorId,
                  creator_username: username,
                  profile_view_count: count,
                  did_subscribe: false,
                  subscription_count: 0,
                  synced_at: syncedAt,
                })
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

      Object.entries(creatorData).forEach(([creatorId, usernameData]: [string, any]) => {
        if (creatorId === '$overall' || typeof usernameData !== 'object' || usernameData === null) return

        Object.entries(usernameData).forEach(([username, subCount]: [string, any]) => {
          if (username && username !== '$overall' && username !== 'undefined') {
            const count = typeof subCount === 'object' && subCount !== null && 'all' in subCount
              ? parseInt(String((subCount as any).all)) || 0
              : parseInt(String(subCount)) || 0

            if (count > 0) {
              // Find or create creator pair
              const existingPair = creatorPairs.find(
                p => p.distinct_id === distinctId && p.creator_id === creatorId
              )

              if (existingPair) {
                existingPair.did_subscribe = true
                existingPair.subscription_count = count
              } else {
                creatorPairs.push({
                  distinct_id: distinctId,
                  creator_id: creatorId,
                  creator_username: username,
                  profile_view_count: 0,
                  did_subscribe: true,
                  subscription_count: count,
                  synced_at: syncedAt,
                })
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

  if (pdpMetric) {
    Object.entries(pdpMetric).forEach(([distinctId, portfolioData]: [string, any]) => {
      if (distinctId === '$overall' || typeof portfolioData !== 'object' || portfolioData === null) return

      Object.entries(portfolioData).forEach(([portfolioTicker, creatorData]: [string, any]) => {
        if (portfolioTicker === '$overall' || typeof creatorData !== 'object' || creatorData === null) return

        // Filter out invalid portfolio tickers (single character, null, undefined, etc.)
        if (!portfolioTicker || portfolioTicker.length <= 1 || portfolioTicker === 'null' || portfolioTicker === 'undefined') {
          console.warn(`Skipping invalid portfolio ticker: "${portfolioTicker}"`)
          return
        }

        Object.entries(creatorData).forEach(([creatorId, usernameData]: [string, any]) => {
          if (creatorId === '$overall' || typeof usernameData !== 'object' || usernameData === null) return

          // Get creator username from the pre-built map OR extract from current metric data
          let creatorUsername = creatorIdToUsername.get(creatorId)

          // If not in map, try to extract from the current usernameData
          // This handles cases where creators have liquidations but no profile views
          if (!creatorUsername) {
            // usernameData structure: { "$overall": {...}, "actual_username": {...} }
            // Find the first key that's not $overall
            const usernameKeys = Object.keys(usernameData).filter(k => k !== '$overall')
            if (usernameKeys.length > 0) {
              creatorUsername = usernameKeys[0]
              // Add to map for consistency across metrics
              creatorIdToUsername.set(creatorId, creatorUsername)
            }
          }

          if (!creatorUsername) {
            console.warn(`No username found for creatorId ${creatorId} on portfolio ${portfolioTicker}`)
            return
          }

          // Extract PDP view count
          // Structure: { "$overall": { all: count }, "username": { all: count } }
          // Use $overall for count to avoid duplicates
          let pdpCount = 0

          // First, get the count from $overall (if exists)
          if (usernameData['$overall']) {
            const overallData = usernameData['$overall']
            pdpCount = typeof overallData === 'object' && overallData !== null && 'all' in overallData
              ? parseInt(String(overallData.all)) || 0
              : parseInt(String(overallData)) || 0
          }

          // If no $overall, try to get count from the username key
          if (pdpCount === 0 && usernameData[creatorUsername]) {
            const usernameViewData = usernameData[creatorUsername]
            pdpCount = typeof usernameViewData === 'object' && usernameViewData !== null && 'all' in usernameViewData
              ? parseInt(String((usernameViewData as any).all)) || 0
              : parseInt(String(usernameViewData)) || 0
          }

          if (pdpCount === 0) return

          // Extract copy count for this specific portfolio-creator pair from same chart
          let copyCount = 0
          let didCopy = false

          // Try with $overall first, then with username
          if (copiesMetric?.[distinctId]?.[portfolioTicker]?.[creatorId]) {
            const creatorCopies = copiesMetric[distinctId][portfolioTicker][creatorId]

            if (creatorCopies['$overall']) {
              const overallCopyData = creatorCopies['$overall']
              copyCount = typeof overallCopyData === 'object' && overallCopyData !== null && 'all' in overallCopyData
                ? parseInt(String(overallCopyData.all)) || 0
                : parseInt(String(overallCopyData)) || 0
            } else if (creatorCopies[creatorUsername]) {
              const copyData = creatorCopies[creatorUsername]
              copyCount = typeof copyData === 'object' && copyData !== null && 'all' in copyData
                ? parseInt(String(copyData.all)) || 0
                : parseInt(String(copyData)) || 0
            }
            didCopy = copyCount > 0
          }

          // Extract liquidation count for this specific portfolio-creator pair from same chart
          let liquidationCount = 0

          // Try with $overall first, then with username
          if (liquidationsMetric?.[distinctId]?.[portfolioTicker]?.[creatorId]) {
            const creatorLiquidations = liquidationsMetric[distinctId][portfolioTicker][creatorId]

            if (creatorLiquidations['$overall']) {
              const overallLiqData = creatorLiquidations['$overall']
              liquidationCount = typeof overallLiqData === 'object' && overallLiqData !== null && 'all' in overallLiqData
                ? parseInt(String(overallLiqData.all)) || 0
                : parseInt(String(overallLiqData)) || 0
            } else if (creatorLiquidations[creatorUsername]) {
              const liquidationData = creatorLiquidations[creatorUsername]
              liquidationCount = typeof liquidationData === 'object' && liquidationData !== null && 'all' in liquidationData
                ? parseInt(String(liquidationData.all)) || 0
                : parseInt(String(liquidationData)) || 0
            }
          }

          // Add portfolio-creator engagement pair (no profile views or subscriptions)
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
      })
    })
  }

  console.log(`Processed ${portfolioCreatorPairs.length} portfolio-creator pairs and ${creatorPairs.length} creator pairs`)
  return { portfolioCreatorPairs, creatorPairs }
}
