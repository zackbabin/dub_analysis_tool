// Supabase Edge Function: sync-mixpanel-user-properties-process
// Step 2 of 2-step process: Processes user properties from Storage and upserts to DB
// Call this after sync-mixpanel-user-properties-v2 completes
// Processes in chunks to avoid timeout (run multiple times for 38k+ users)

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import {
  initializeSupabaseClient,
  handleCorsRequest,
  createSyncLog,
  updateSyncLogSuccess,
  updateSyncLogFailure,
  createSuccessResponse,
  createErrorResponse,
} from '../_shared/sync-helpers.ts'

const STORAGE_BUCKET = 'mixpanel-data'
const STORAGE_PATH = 'user-properties-latest.json'
const CHUNK_SIZE = 5000 // Process 5000 users per run

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
 * Processes only a chunk of users (offset to offset+limit)
 */
function parseUserPropertiesChunk(data: any, offset: number, limit: number): UserPropertyRow[] {
  const users: UserPropertyRow[] = []

  try {
    if (!data) {
      console.error('No data provided to parseUserPropertiesChunk')
      return users
    }

    if (!data.series || !data.series['Total of User Profiles']) {
      console.warn('No series data found in response')
      return users
    }

    if (!data.headers || data.headers.length < 2) {
      console.warn('No headers found in response')
      return users
    }

    const series = data.series['Total of User Profiles']
    const allDistinctIds = Object.keys(series).filter(id => id !== '$overall')

    console.log(`Total users in storage: ${allDistinctIds.length}`)
    console.log(`Processing chunk: ${offset} to ${Math.min(offset + limit, allDistinctIds.length)}`)

    // Process only the specified chunk
    const chunkIds = allDistinctIds.slice(offset, offset + limit)

    for (const distinctId of chunkIds) {
      try {
        const userData = series[distinctId]
        const propertyValues = extractPropertyValues(userData as any, data.headers)

        if (propertyValues) {
          users.push({
            distinct_id: distinctId,
            ...propertyValues
          })
        }
      } catch (userError) {
        console.error(`Error parsing user ${distinctId}:`, userError.message)
      }
    }

    console.log(`✓ Parsed ${users.length} users from chunk`)
    return users
  } catch (error) {
    console.error('Error in parseUserPropertiesChunk:', error.message)
    return users
  }
}

/**
 * Recursively traverse nested structure and collect property values
 */
function extractPropertyValues(obj: any, headers: string[]): any {
  const values: any = {}

  const propertyMap: Record<string, string> = {
    'totalDeposits': 'total_deposits',
    'activeCopiedPortfolios': 'lifetime_created_portfolios',
    'totalDepositCount': 'total_deposit_count',
    'activeCreatedPortfolios': 'active_created_portfolios',
    'lifetimeCopiedPortfolios': 'lifetime_created_portfolios',
    'income': 'income',
    'investingActivity': 'investing_activity',
    'investingExperienceYears': 'investing_experience_years',
    'investingObjective': 'investing_objective',
    'investmentType': 'investment_type',
    '$ae_total_app_sessions': 'app_sessions',
    'availableCopyCredits': 'available_copy_credits',
    'totalBuys': 'total_deposits',
    'acquisitionSurvey': 'acquisition_survey',
    'buyingPower': 'buying_power',
    'netWorth': 'net_worth',
    'totalWithdrawalCount': 'total_withdrawal_count',
    'totalWithdrawals': 'total_withdrawals',
    'hasLinkedBank': 'linked_bank_account'
  }

  function traverse(node: any, depth: number = 2): void {
    if (!node || typeof node !== 'object') return
    if (depth >= headers.length) return

    const headerName = headers[depth]
    const columnName = propertyMap[headerName]

    for (const [key, value] of Object.entries(node)) {
      if (key === '$overall') {
        traverse(value, depth)
        continue
      }

      if (key === 'all') {
        return
      }

      if (columnName) {
        const lowerKey = String(key).toLowerCase()
        const isInvalidValue = key === 'undefined' || lowerKey === 'null' || lowerKey === 'n/a' || lowerKey === 'not set'

        if (columnName === 'linked_bank_account') {
          if (!isInvalidValue) {
            values[columnName] = key === 'true' || key === true
          }
        } else if (headerName === 'totalDeposits' || headerName === 'buyingPower' ||
                   headerName === 'availableCopyCredits' || headerName === 'totalWithdrawals' ||
                   headerName === 'totalDepositCount' || headerName === 'totalWithdrawalCount' ||
                   headerName === 'activeCreatedPortfolios' || headerName === 'lifetimeCopiedPortfolios' ||
                   headerName === 'activeCopiedPortfolios' || headerName === '$ae_total_app_sessions' ||
                   headerName === 'totalBuys') {
          if (isInvalidValue) {
            values[columnName] = 0
          } else {
            const parsed = parseFloat(key)
            values[columnName] = isNaN(parsed) ? 0 : parsed
          }
        } else {
          if (!isInvalidValue && key && key !== 'undefined') {
            values[columnName] = key
          }
        }
      }

      if (typeof value === 'object') {
        traverse(value, depth + 1)
      }
    }
  }

  traverse(obj, 2)
  return Object.keys(values).length > 0 ? values : null
}

/**
 * Bulk upsert user properties
 */
async function updateUserPropertiesBatch(
  supabase: any,
  users: UserPropertyRow[]
): Promise<number> {
  console.log(`Starting bulk upsert of ${users.length} users...`)

  const BATCH_SIZE = 1000
  let totalUpserted = 0

  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const batch = users.slice(i, i + BATCH_SIZE)

    try {
      const { error, count } = await supabase
        .from('subscribers_insights_v2')
        .upsert(batch, {
          onConflict: 'distinct_id',
          count: 'exact'
        })

      if (error) {
        console.error(`Error upserting batch:`, error.message)
      } else {
        const batchCount = count || batch.length
        totalUpserted += batchCount
        console.log(`✓ Upserted batch ${Math.floor(i / BATCH_SIZE) + 1}: ${totalUpserted}/${users.length} users`)
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
    console.log('Initializing Supabase client...')
    const supabase = initializeSupabaseClient()

    console.log('Starting user properties processing (Step 2/2)...')

    // Get offset from request body (for processing multiple chunks)
    const body = await req.json().catch(() => ({}))
    const offset = body.offset || 0

    console.log('Creating sync log...')
    const executionStartMs = Date.now()
    const { syncLog, syncStartTime } = await createSyncLog(supabase, 'user', 'mixpanel_user_properties_process')
    const syncLogId = syncLog.id

    try {
      // Load data from Storage
      console.log(`Loading data from Storage (${STORAGE_BUCKET}/${STORAGE_PATH})...`)
      const { data: fileData, error: downloadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .download(STORAGE_PATH)

      if (downloadError) {
        throw new Error(`Failed to load data from storage: ${downloadError.message}`)
      }

      console.log('✓ Data loaded from Storage')
      console.log('Parsing JSON...')
      const text = await fileData.text()
      const data = JSON.parse(text)

      console.log('✓ JSON parsed successfully')

      // Count total users
      const series = data.series?.['Total of User Profiles'] || {}
      const totalUsers = Object.keys(series).filter(id => id !== '$overall').length

      // Parse chunk
      console.log(`Parsing chunk (offset: ${offset}, size: ${CHUNK_SIZE})...`)
      const users = parseUserPropertiesChunk(data, offset, CHUNK_SIZE)

      if (users.length === 0) {
        return createSuccessResponse('No more users to process', {
          totalTimeSeconds: Math.round((Date.now() - executionStartMs) / 1000),
          offset: offset,
          totalUsers: totalUsers,
          usersProcessed: 0,
          allComplete: true,
        })
      }

      // Upsert to database
      console.log('Upserting to database...')
      const updatedCount = await updateUserPropertiesBatch(supabase, users)

      const elapsedMs = Date.now() - executionStartMs
      const elapsedSec = Math.round(elapsedMs / 1000)

      await updateSyncLogSuccess(supabase, syncLogId, {
        total_records_inserted: updatedCount,
      })

      const nextOffset = offset + CHUNK_SIZE
      const hasMore = nextOffset < totalUsers

      console.log(`Processing completed in ${elapsedSec}s`)
      if (hasMore) {
        console.log(`📋 Next step: Call again with offset=${nextOffset} to process next chunk`)
      } else {
        console.log('✅ All users processed!')
      }

      return createSuccessResponse('User properties chunk processed successfully (Step 2/2)', {
        totalTimeSeconds: elapsedSec,
        offset: offset,
        nextOffset: hasMore ? nextOffset : null,
        totalUsers: totalUsers,
        usersProcessed: updatedCount,
        progress: `${Math.min(nextOffset, totalUsers)}/${totalUsers} (${Math.round(Math.min(nextOffset, totalUsers) / totalUsers * 100)}%)`,
        hasMore: hasMore,
        nextStep: hasMore ? `Call again with { "offset": ${nextOffset} }` : 'Processing complete!',
      })
    } catch (error) {
      await updateSyncLogFailure(supabase, syncLogId, error)
      throw error
    }
  } catch (error) {
    return createErrorResponse(error, 'sync-mixpanel-user-properties-process')
  }
})
