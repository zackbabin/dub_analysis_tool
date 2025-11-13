// Supabase Edge Function: sync-mixpanel-user-properties-v2
// Fetches user properties from Mixpanel Insights API (chart 86138059)
// Updates existing rows in subscribers_insights_v2 with property data
// Runs independently from event sync

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { fetchInsightsData } from '../_shared/mixpanel-api.ts'
import {
  initializeMixpanelCredentials,
  initializeSupabaseClient,
  handleCorsRequest,
  checkAndHandleSkipSync,
  createSyncLog,
  updateSyncLogSuccess,
  updateSyncLogFailure,
  createSuccessResponse,
  createErrorResponse,
} from '../_shared/sync-helpers.ts'

const CHART_ID = '86138059' // User properties chart

interface UserPropertyRow {
  distinct_id: string
  income?: string
  net_worth?: string
  investing_activity?: string
  investing_experience_years?: string
  investing_objective?: string
  investment_type?: string
  acquisition_survey?: string
  linked_bank_account?: boolean
  available_copy_credits?: number
  buying_power?: number
  total_deposits?: number
  total_deposit_count?: number
  total_withdrawals?: number
  total_withdrawal_count?: number
  active_created_portfolios?: number
  lifetime_created_portfolios?: number
}

/**
 * Parse Mixpanel Insights API response and extract user properties
 */
function parseUserProperties(data: any): UserPropertyRow[] {
  const users: UserPropertyRow[] = []

  if (!data.series || !data.series['Total of User Profiles']) {
    console.warn('No series data found in response')
    return users
  }

  if (!data.headers || data.headers.length < 2) {
    console.warn('No headers found in response')
    return users
  }

  console.log(`Headers: ${data.headers.join(', ')}`)

  const series = data.series['Total of User Profiles']

  // Iterate through all distinct_ids in the response
  for (const [distinctId, userData] of Object.entries(series)) {
    // Skip the $overall aggregation
    if (distinctId === '$overall') continue

    // Extract nested property values following the headers order
    const propertyValues = extractPropertyValues(userData as any, data.headers)

    if (propertyValues) {
      users.push({
        distinct_id: distinctId,
        ...propertyValues
      })
    }
  }

  console.log(`Parsed ${users.length} users`)
  return users
}

/**
 * Recursively traverse nested structure and collect property values
 * Following the order of headers array (skip first 2: $people and $distinct_id)
 */
function extractPropertyValues(obj: any, headers: string[]): any {
  const values: any = {}

  // Map Mixpanel property names to our database column names
  const propertyMap: Record<string, string> = {
    'totalDeposits': 'total_deposits',
    'totalDepositCount': 'total_deposit_count',
    'activeCreatedPortfolios': 'active_created_portfolios',
    'income': 'income',
    'investingActivity': 'investing_activity',
    'investingExperienceYears': 'investing_experience_years',
    'investingObjective': 'investing_objective',
    'investmentType': 'investment_type',
    'availableCopyCredits': 'available_copy_credits',
    'acquisitionSurvey': 'acquisition_survey',
    'buyingPower': 'buying_power',
    'netWorth': 'net_worth',
    'totalWithdrawalCount': 'total_withdrawal_count',
    'totalWithdrawals': 'total_withdrawals',
    'hasLinkedBank': 'linked_bank_account'
  }

  // Recursively traverse and collect values in the order of headers
  function traverse(node: any, depth: number = 2): void {
    if (!node || typeof node !== 'object') return
    if (depth >= headers.length) return // Past the last header

    const headerName = headers[depth]
    const columnName = propertyMap[headerName]

    // For each key at this level
    for (const [key, value] of Object.entries(node)) {
      if (key === '$overall') {
        // Skip aggregation, continue deeper
        traverse(value, depth)
        continue
      }

      if (key === 'all') {
        // We've reached the leaf, stop
        return
      }

      // This key is the value for the current header
      if (columnName) {
        const lowerKey = String(key).toLowerCase()
        const isInvalidValue = key === 'undefined' || lowerKey === 'null' || lowerKey === 'n/a' || lowerKey === 'not set'

        // Store the value based on field type
        if (columnName === 'linked_bank_account') {
          // Boolean field - skip if invalid
          if (!isInvalidValue) {
            values[columnName] = key === 'true' || key === true
          }
        } else if (headerName === 'totalDeposits' || headerName === 'buyingPower' ||
                   headerName === 'availableCopyCredits' || headerName === 'totalWithdrawals' ||
                   headerName === 'totalDepositCount' || headerName === 'totalWithdrawalCount' ||
                   headerName === 'activeCreatedPortfolios') {
          // Numeric fields - always set to 0 if invalid or NaN
          if (isInvalidValue) {
            values[columnName] = 0
          } else {
            const parsed = parseFloat(key)
            values[columnName] = isNaN(parsed) ? 0 : parsed
          }
        } else {
          // String fields - skip if invalid, don't store anything
          if (!isInvalidValue && key && key !== 'undefined') {
            values[columnName] = key
          }
        }
      }

      // Continue to next depth
      if (typeof value === 'object') {
        traverse(value, depth + 1)
      }
    }
  }

  traverse(obj, 2) // Start at index 2 (after $people and $distinct_id)
  return Object.keys(values).length > 0 ? values : null
}

/**
 * Update user properties in batches
 */
async function updateUserPropertiesBatch(
  supabase: any,
  users: UserPropertyRow[]
): Promise<number> {
  let successCount = 0

  // Process in batches of 100
  const BATCH_SIZE = 100
  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const batch = users.slice(i, i + BATCH_SIZE)

    // Update each user individually (Supabase doesn't support batch UPDATE with different values easily)
    for (const user of batch) {
      const { distinct_id, ...properties } = user

      const { error } = await supabase
        .from('subscribers_insights_v2')
        .update(properties)
        .eq('distinct_id', distinct_id)

      if (error) {
        console.error(`Error updating user ${distinct_id}:`, error)
      } else {
        successCount++
      }
    }

    console.log(`Processed batch ${Math.floor(i / BATCH_SIZE) + 1}: ${successCount} users updated`)
  }

  return successCount
}

serve(async (req) => {
  const corsResponse = handleCorsRequest(req)
  if (corsResponse) return corsResponse

  try {
    const credentials = initializeMixpanelCredentials()
    const supabase = initializeSupabaseClient()

    console.log('Starting Mixpanel user properties sync v2...')

    // Check if sync should be skipped (within 1-hour window)
    const skipResponse = await checkAndHandleSkipSync(supabase, 'mixpanel_user_properties_v2', 1)
    if (skipResponse) return skipResponse

    const executionStartMs = Date.now()
    const { syncLog, syncStartTime } = await createSyncLog(supabase, 'user', 'mixpanel_user_properties_v2')
    const syncLogId = syncLog.id

    try {
      console.log('Fetching user properties from Mixpanel chart 86138059...')

      // Fetch data from Insights API (chart has date range configured)
      const data = await fetchInsightsData(credentials, CHART_ID)

      console.log('Parsing user properties...')
      const users = parseUserProperties(data)
      console.log(`Found ${users.length} users with properties`)

      if (users.length === 0) {
        throw new Error('No user data returned from Mixpanel')
      }

      console.log('Updating user properties in database...')
      const updatedCount = await updateUserPropertiesBatch(supabase, users)

      const elapsedMs = Date.now() - executionStartMs
      const elapsedSec = Math.round(elapsedMs / 1000)

      await updateSyncLogSuccess(supabase, syncLogId, {
        total_records_inserted: updatedCount,
      })

      console.log(`User properties sync completed in ${elapsedSec}s`)

      return createSuccessResponse('User properties synced successfully (v2)', {
        totalTimeSeconds: elapsedSec,
        totalUsersFound: users.length,
        totalUsersUpdated: updatedCount,
      })
    } catch (error) {
      await updateSyncLogFailure(supabase, syncLogId, error)
      throw error
    }
  } catch (error) {
    return createErrorResponse(error, 'sync-mixpanel-user-properties-v2')
  }
})
