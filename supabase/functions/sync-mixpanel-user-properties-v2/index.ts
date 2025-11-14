// Supabase Edge Function: sync-mixpanel-user-properties-v2
// Step 1 of 2-step process: Fetches user properties from Mixpanel and stores to Storage
// Runs independently from event sync
// After this completes, call sync-mixpanel-user-properties-process to process the data

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
const STORAGE_BUCKET = 'mixpanel-data'
const STORAGE_PATH = 'user-properties-latest.json'

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

  try {
    if (!data) {
      console.error('No data provided to parseUserProperties')
      return users
    }

    if (!data.series || !data.series['Total of User Profiles']) {
      console.warn('No series data found in response')
      console.log('Data structure:', JSON.stringify(data).substring(0, 200))
      return users
    }

    if (!data.headers || data.headers.length < 2) {
      console.warn('No headers found in response')
      console.log('Headers:', data.headers)
      return users
    }

    console.log(`Headers: ${data.headers.join(', ')}`)

    const series = data.series['Total of User Profiles']
    const allDistinctIds = Object.keys(series).filter(id => id !== '$overall')

    console.log(`Total users in response: ${allDistinctIds.length}`)

    // Process in chunks to avoid timeout (38k users takes too long to parse)
    const CHUNK_SIZE = 5000 // Process 5000 users at a time
    const startTime = Date.now()
    const MAX_EXECUTION_TIME = 120000 // 120 seconds (leave buffer before 150s timeout)

    // Iterate through distinct_ids in chunks
    let processedCount = 0
    for (const distinctId of allDistinctIds) {
      try {
        // Check for timeout
        const elapsed = Date.now() - startTime
        if (elapsed > MAX_EXECUTION_TIME) {
          console.log(`⚠️ Approaching timeout after ${Math.round(elapsed / 1000)}s. Processed ${processedCount}/${allDistinctIds.length} users.`)
          console.log('⚠️ Partial sync completed - run again to continue processing remaining users')
          break
        }

        // Limit to chunk size to prevent memory issues
        if (processedCount >= CHUNK_SIZE) {
          console.log(`⚠️ Reached chunk limit (${CHUNK_SIZE} users). Processed ${processedCount}/${allDistinctIds.length} users.`)
          console.log('⚠️ Run function again to process next chunk')
          break
        }

        const userData = series[distinctId]

        // Extract nested property values following the headers order
        const propertyValues = extractPropertyValues(userData as any, data.headers)

        if (propertyValues) {
          users.push({
            distinct_id: distinctId,
            ...propertyValues
          })
        }

        processedCount++

        // Log progress every 1000 users
        if (processedCount % 1000 === 0) {
          console.log(`Parsed ${processedCount} users... (${Math.round(elapsed / 1000)}s elapsed)`)
        }
      } catch (userError) {
        console.error(`Error parsing user ${distinctId}:`, userError.message)
        // Continue processing other users
      }
    }

    console.log(`✓ Parsed ${users.length} users (${processedCount}/${allDistinctIds.length} total)`)
    return users
  } catch (error) {
    console.error('Error in parseUserProperties:', error.message)
    console.error('Stack:', error.stack)
    return users
  }
}

/**
 * Recursively traverse nested structure and collect property values
 * Following the order of headers array (skip first 2: $people and $distinct_id)
 */
function extractPropertyValues(obj: any, headers: string[]): any {
  const values: any = {}

  // Map Mixpanel property names to our database column names
  // Based on actual API response headers order
  const propertyMap: Record<string, string> = {
    'totalDeposits': 'total_deposits',
    'activeCopiedPortfolios': 'lifetime_created_portfolios', // Using this for active copied
    'totalDepositCount': 'total_deposit_count',
    'activeCreatedPortfolios': 'active_created_portfolios',
    'lifetimeCopiedPortfolios': 'lifetime_created_portfolios',
    'income': 'income',
    'investingActivity': 'investing_activity',
    'investingExperienceYears': 'investing_experience_years',
    'investingObjective': 'investing_objective',
    'investmentType': 'investment_type',
    '$ae_total_app_sessions': 'app_sessions', // Mapped from $ae_total_app_sessions
    'availableCopyCredits': 'available_copy_credits',
    'totalBuys': 'total_deposits', // Mapping totalBuys (not in our schema, skip for now)
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
                   headerName === 'activeCreatedPortfolios' || headerName === 'lifetimeCopiedPortfolios' ||
                   headerName === 'activeCopiedPortfolios' || headerName === '$ae_total_app_sessions' ||
                   headerName === 'totalBuys') {
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
 * Update user properties using bulk upsert (much faster than individual updates)
 */
async function updateUserPropertiesBatch(
  supabase: any,
  users: UserPropertyRow[]
): Promise<number> {
  console.log(`Starting bulk upsert of ${users.length} users...`)

  // Use upsert instead of individual updates for massive speed improvement
  // Supabase upsert can handle bulk operations efficiently
  const BATCH_SIZE = 1000 // Much larger batches since we're using bulk upsert
  let totalUpserted = 0

  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const batch = users.slice(i, i + BATCH_SIZE)

    try {
      const { data, error, count } = await supabase
        .from('subscribers_insights_v2')
        .upsert(batch, {
          onConflict: 'distinct_id',
          count: 'exact'
        })

      if (error) {
        console.error(`Error upserting batch ${Math.floor(i / BATCH_SIZE) + 1}:`, error.message)
        console.error('Error details:', error)
      } else {
        const batchCount = count || batch.length
        totalUpserted += batchCount
        console.log(`✓ Upserted batch ${Math.floor(i / BATCH_SIZE) + 1}: ${totalUpserted}/${users.length} users (${Math.round(totalUpserted / users.length * 100)}%)`)
      }
    } catch (batchError) {
      console.error(`Exception upserting batch:`, batchError.message)
    }
  }

  console.log(`✓ Finished bulk upsert: ${totalUpserted} users`)
  return totalUpserted
}

serve(async (req) => {
  const corsResponse = handleCorsRequest(req)
  if (corsResponse) return corsResponse

  try {
    console.log('Initializing credentials and Supabase client...')
    const credentials = initializeMixpanelCredentials()
    const supabase = initializeSupabaseClient()

    console.log('Starting Mixpanel user properties sync v2...')

    // Check if sync should be skipped (within 1-hour window)
    console.log('Checking skip sync...')
    const skipResponse = await checkAndHandleSkipSync(supabase, 'mixpanel_user_properties_v2', 1)
    if (skipResponse) return skipResponse

    console.log('Creating sync log...')
    const executionStartMs = Date.now()
    const { syncLog, syncStartTime } = await createSyncLog(supabase, 'user', 'mixpanel_user_properties_v2')
    const syncLogId = syncLog.id

    try {
      console.log('Fetching user properties from Mixpanel chart 86138059...')
      console.log('⚠️ This may take 30-60 seconds for 38k+ users...')

      // Fetch data from Insights API (chart has date range configured)
      const data = await fetchInsightsData(credentials, CHART_ID)
      console.log('✓ Received data from Mixpanel')

      // Count users in response
      const series = data.series?.['Total of User Profiles'] || {}
      const userCount = Object.keys(series).filter(id => id !== '$overall').length
      console.log(`Found ${userCount} users in response`)

      // Store raw data to Supabase Storage
      console.log('Storing data to Supabase Storage...')
      const dataString = JSON.stringify(data)
      const dataBlob = new Blob([dataString], { type: 'application/json' })

      const { error: storageError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(STORAGE_PATH, dataBlob, {
          upsert: true,
          contentType: 'application/json'
        })

      if (storageError) {
        console.error('Storage error:', storageError)
        throw new Error(`Failed to store data: ${storageError.message}`)
      }

      console.log('✓ Data stored to Storage')

      const elapsedMs = Date.now() - executionStartMs
      const elapsedSec = Math.round(elapsedMs / 1000)

      await updateSyncLogSuccess(supabase, syncLogId, {
        total_records_inserted: userCount,
      })

      console.log(`Fetch completed in ${elapsedSec}s`)
      console.log('🔄 Auto-triggering processing (offset=0)...')

      // Automatically trigger the processing function to start processing chunks
      const processUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/sync-mixpanel-user-properties-process`
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

      fetch(processUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${serviceKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ offset: 0 })
      }).catch(err => console.error('Failed to trigger processing:', err.message))

      console.log('✅ Processing triggered in background')

      return createSuccessResponse('User properties fetched, stored, and processing started (Step 1/2)', {
        totalTimeSeconds: elapsedSec,
        totalUsers: userCount,
        storagePath: `${STORAGE_BUCKET}/${STORAGE_PATH}`,
        nextStep: 'Processing automatically in progress',
      })
    } catch (error) {
      await updateSyncLogFailure(supabase, syncLogId, error)
      throw error
    }
  } catch (error) {
    return createErrorResponse(error, 'sync-mixpanel-user-properties-v2')
  }
})
