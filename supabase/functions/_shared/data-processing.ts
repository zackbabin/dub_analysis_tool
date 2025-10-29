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
 * @param profileViewsData - Profile views by creator
 * @param pdpViewsData - PDP views by portfolio/creator
 * @param subscriptionsData - Subscription events by user
 * @param copiesData - Copy events by user (includes both Total Copies and Total Liquidations metrics)
 * @param syncedAt - Timestamp for sync tracking
 * @returns Array of consolidated engagement pairs
 */
export function processPortfolioCreatorPairs(
  profileViewsData: any,
  pdpViewsData: any,
  subscriptionsData: any,
  copiesData: any,
  syncedAt: string
): any[] {
  const engagementPairs: any[] = []

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

  // Build profile view counts map
  const profileViewCounts = new Map<string, Map<string, number>>()
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
              if (!profileViewCounts.has(distinctId)) {
                profileViewCounts.set(distinctId, new Map())
              }
              const userCounts = profileViewCounts.get(distinctId)!
              userCounts.set(creatorId, (userCounts.get(creatorId) || 0) + count)
            }
          }
        })
      })
    })
  }

  // Build subscription users and counts
  const subscribedUsers = new Set<string>()
  const subscriptionCounts = new Map<string, number>()
  const subsMetric = subscriptionsData?.series?.['Total Subscriptions']
  if (subsMetric) {
    Object.entries(subsMetric).forEach(([distinctId, data]: [string, any]) => {
      if (distinctId !== '$overall') {
        subscribedUsers.add(distinctId)
        const count = typeof data === 'object' && data !== null && '$overall' in data
          ? parseInt(String(data['$overall'])) || 1
          : parseInt(String(data)) || 1
        subscriptionCounts.set(distinctId, count)
      }
    })
  }

  // Build copied users and counts
  const copiedUsers = new Set<string>()
  const copyCounts = new Map<string, number>()
  const copiesMetric = copiesData?.series?.['Total Copies']
  if (copiesMetric) {
    Object.entries(copiesMetric).forEach(([distinctId, data]: [string, any]) => {
      if (distinctId !== '$overall') {
        copiedUsers.add(distinctId)
        const count = typeof data === 'object' && data !== null && '$overall' in data
          ? parseInt(String(data['$overall'])) || 1
          : parseInt(String(data)) || 1
        copyCounts.set(distinctId, count)
      }
    })
  }

  // Build liquidation counts
  const liquidationCounts = new Map<string, number>()
  const liquidationsMetric = copiesData?.series?.['Total Liquidations']
  if (liquidationsMetric) {
    Object.entries(liquidationsMetric).forEach(([distinctId, data]: [string, any]) => {
      if (distinctId !== '$overall') {
        const count = typeof data === 'object' && data !== null && '$overall' in data
          ? parseInt(String(data['$overall'])) || 0
          : parseInt(String(data)) || 0
        if (count > 0) {
          liquidationCounts.set(distinctId, count)
        }
      }
    })
  }

  // Process PDP views to create pairs
  const pdpMetric = pdpViewsData?.series?.['Total PDP Views']
  if (pdpMetric) {
    Object.entries(pdpMetric).forEach(([distinctId, portfolioData]: [string, any]) => {
      if (distinctId === '$overall' || typeof portfolioData !== 'object' || portfolioData === null) return

      const didSubscribe = subscribedUsers.has(distinctId)
      const subCount = subscriptionCounts.get(distinctId) || 0
      const didCopy = copiedUsers.has(distinctId)
      const copyCount = copyCounts.get(distinctId) || 0
      const liquidationCount = liquidationCounts.get(distinctId) || 0

      Object.entries(portfolioData).forEach(([portfolioTicker, creatorData]: [string, any]) => {
        if (portfolioTicker === '$overall' || typeof creatorData !== 'object' || creatorData === null) return

        Object.entries(creatorData).forEach(([creatorId, viewCount]: [string, any]) => {
          if (creatorId === '$overall') return

          const pdpCount = typeof viewCount === 'object' && viewCount !== null && 'all' in viewCount
            ? parseInt(String((viewCount as any).all))
            : parseInt(String(viewCount)) || 0
          const creatorUsername = creatorIdToUsername.get(creatorId) || null
          const profileViewCount = profileViewCounts.get(distinctId)?.get(creatorId) || 0

          if (pdpCount > 0) {
            // Add consolidated engagement pair with subscription, copy, and liquidation data
            engagementPairs.push({
              distinct_id: distinctId,
              portfolio_ticker: portfolioTicker,
              creator_id: creatorId,
              creator_username: creatorUsername,
              pdp_view_count: pdpCount,
              profile_view_count: profileViewCount,
              did_subscribe: didSubscribe,
              subscription_count: subCount,
              did_copy: didCopy,
              copy_count: copyCount,
              liquidation_count: liquidationCount,
              synced_at: syncedAt,
            })
          }
        })
      })
    })
  }

  console.log(`Processed ${engagementPairs.length} consolidated engagement pairs`)
  return engagementPairs
}
