// Supabase Edge Function: sync-mixpanel-user-properties-v2
// Fetches user properties from Mixpanel Engage API (paginated, auto-chains)
// Uses Engage API instead of Insights API for better performance and simpler parsing
// Automatically chains to next page until all users are synced

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { fetchEngageProfiles } from '../_shared/mixpanel-api.ts'
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

const COHORT_IDS = [5825472] // Premium Creator Analysis cohort

// List of Mixpanel properties to fetch
const OUTPUT_PROPERTIES = [
  'totalDeposits',
  'activeCopiedPortfolios',
  'totalDepositCount',
  'activeCreatedPortfolios',
  'lifetimeCopiedPortfolios',
  'income',
  'investingActivity',
  'investingExperienceYears',
  'investingObjective',
  'investmentType',
  '$ae_total_app_sessions',
  'availableCopyCredits',
  'acquisitionSurvey',
  'buyingPower',
  'netWorth',
  'totalWithdrawalCount',
  'totalWithdrawals',
  'hasLinkedBank',
]

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
  active_copied_portfolios?: number
  lifetime_copied_portfolios?: number
}

/**
 * Map Mixpanel property names to database column names
 */
const PROPERTY_MAP: Record<string, string> = {
  'totalDeposits': 'total_deposits',
  'activeCopiedPortfolios': 'active_copied_portfolios',
  'totalDepositCount': 'total_deposit_count',
  'activeCreatedPortfolios': 'active_created_portfolios',
  'lifetimeCopiedPortfolios': 'lifetime_copied_portfolios',
  'income': 'income',
  'investingActivity': 'investing_activity',
  'investingExperienceYears': 'investing_experience_years',
  'investingObjective': 'investing_objective',
  'investmentType': 'investment_type',
  '$ae_total_app_sessions': 'app_sessions',
  'availableCopyCredits': 'available_copy_credits',
  'acquisitionSurvey': 'acquisition_survey',
  'buyingPower': 'buying_power',
  'netWorth': 'net_worth',
  'totalWithdrawalCount': 'total_withdrawal_count',
  'totalWithdrawals': 'total_withdrawals',
  'hasLinkedBank': 'linked_bank_account'
}

/**
 * Parse Mixpanel Engage API response (flat $properties structure)
 */
function parseEngageProfiles(profiles: any[]): UserPropertyRow[] {
  const users: UserPropertyRow[] = []

  for (const profile of profiles) {
    try {
      const distinctId = profile.$distinct_id
      if (!distinctId) {
        console.warn('Profile missing distinct_id:', profile)
        continue
      }

      const properties = profile.$properties || {}
      const row: UserPropertyRow = { distinct_id: distinctId }

      // Map each property
      for (const [mixpanelProp, dbColumn] of Object.entries(PROPERTY_MAP)) {
        const value = properties[mixpanelProp]

        if (value === undefined || value === null) continue

        const lowerValue = String(value).toLowerCase()
        const isInvalidValue = lowerValue === 'null' || lowerValue === 'n/a' ||
                               lowerValue === 'not set' || lowerValue === 'undefined'

        if (isInvalidValue) {
          // Set numeric fields to 0, skip string fields
          if (dbColumn.includes('count') || dbColumn.includes('total_') ||
              dbColumn === 'buying_power' || dbColumn === 'available_copy_credits' ||
              dbColumn === 'active_created_portfolios' || dbColumn === 'lifetime_created_portfolios' ||
              dbColumn === 'active_copied_portfolios' || dbColumn === 'lifetime_copied_portfolios') {
            (row as any)[dbColumn] = 0
          }
          continue
        }

        // Handle different field types
        if (dbColumn === 'linked_bank_account') {
          (row as any)[dbColumn] = value === 'true' || value === true
        } else if (
          // Explicitly defined string fields
          dbColumn === 'income' ||
          dbColumn === 'net_worth' ||
          dbColumn === 'investing_activity' ||
          dbColumn === 'investing_experience_years' ||
          dbColumn === 'investing_objective' ||
          dbColumn === 'investment_type' ||
          dbColumn === 'acquisition_survey'
        ) {
          // String fields - keep as string
          (row as any)[dbColumn] = String(value)
        } else if (
          // Numeric fields
          dbColumn.includes('count') ||
          dbColumn.includes('total_') ||
          dbColumn === 'buying_power' ||
          dbColumn === 'available_copy_credits' ||
          dbColumn === 'active_created_portfolios' ||
          dbColumn === 'lifetime_created_portfolios' ||
          dbColumn === 'active_copied_portfolios' ||
          dbColumn === 'lifetime_copied_portfolios' ||
          dbColumn === 'app_sessions'
        ) {
          // Numeric fields - handle both number and string types
          if (typeof value === 'number') {
            (row as any)[dbColumn] = value
          } else {
            const parsed = Number(value)
            (row as any)[dbColumn] = isNaN(parsed) ? 0 : parsed
          }
        } else {
          // Default: treat as string
          (row as any)[dbColumn] = String(value)
        }
      }

      users.push(row)
    } catch (error) {
      console.error(`Error parsing profile ${profile.$distinct_id}:`, error.message)
    }
  }

  return users
}

/**
 * Compare two user property records to detect if any field has changed
 * Returns true if records are different (needs update), false if identical (skip update)
 * Handles null/undefined comparison safely
 */
function hasUserPropertiesChanged(existing: any, incoming: UserPropertyRow): boolean {
  // If no existing record, it's a new user (needs insert)
  if (!existing) return true

  // List of all property fields to compare (excluding distinct_id which is the key)
  const fieldsToCompare = [
    'income',
    'net_worth',
    'investing_activity',
    'investing_experience_years',
    'investing_objective',
    'investment_type',
    'acquisition_survey',
    'linked_bank_account',
    'available_copy_credits',
    'buying_power',
    'total_deposits',
    'total_deposit_count',
    'total_withdrawals',
    'total_withdrawal_count',
    'active_created_portfolios',
    'lifetime_created_portfolios',
    'active_copied_portfolios',
    'lifetime_copied_portfolios',
  ]

  // Check each field - if ANY field differs, return true (needs update)
  for (const field of fieldsToCompare) {
    const existingValue = existing[field]
    const incomingValue = (incoming as any)[field]

    // Normalize null/undefined to null for comparison
    const normalizedExisting = existingValue === undefined ? null : existingValue
    const normalizedIncoming = incomingValue === undefined ? null : incomingValue

    // For numeric fields, also normalize 0 vs null (0 is different from null)
    // For string fields, normalize empty string to null
    const finalExisting = normalizedExisting === '' ? null : normalizedExisting
    const finalIncoming = normalizedIncoming === '' ? null : normalizedIncoming

    if (finalExisting !== finalIncoming) {
      // Field differs - needs update
      return true
    }
  }

  // All fields match - no update needed
  return false
}

/**
 * Bulk upsert user properties to database with change detection
 * Only upserts users whose properties have actually changed
 * This significantly reduces unnecessary DB writes for unchanged users
 */
async function updateUserPropertiesBatch(
  supabase: any,
  users: UserPropertyRow[]
): Promise<number> {
  console.log(`Starting bulk upsert with change detection for ${users.length} users...`)

  const BATCH_SIZE = 250 // Reduced from 1000 to avoid statement timeout
  let totalUpserted = 0
  let totalSkippedUnchanged = 0

  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const batch = users.slice(i, i + BATCH_SIZE)

    try {
      // CHANGE DETECTION: Fetch existing records for this batch
      const distinctIds = batch.map(u => u.distinct_id)
      const { data: existingRecords, error: fetchError } = await supabase
        .from('subscribers_insights')
        .select('*')
        .in('distinct_id', distinctIds)

      if (fetchError) {
        console.error(`Error fetching existing records for comparison:`, fetchError.message)
        // On error, fall back to upserting all (safe fallback - no data loss)
        console.warn('Falling back to upserting all records in batch (no change detection)')
        const { error, count } = await supabase
          .from('subscribers_insights')
          .upsert(batch, {
            onConflict: 'distinct_id',
            count: 'exact'
          })

        if (error) {
          console.error(`Error upserting batch:`, error.message)
        } else {
          const batchCount = count || batch.length
          totalUpserted += batchCount
        }
        continue
      }

      // Create map of existing records for fast lookup
      const existingMap = new Map()
      if (existingRecords) {
        for (const record of existingRecords) {
          existingMap.set(record.distinct_id, record)
        }
      }

      // Filter batch to only include users with changes
      const usersToUpsert = batch.filter(user => {
        const existing = existingMap.get(user.distinct_id)
        const needsUpdate = hasUserPropertiesChanged(existing, user)

        if (!needsUpdate) {
          totalSkippedUnchanged++
        }

        return needsUpdate
      })

      console.log(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${usersToUpsert.length} changed, ${batch.length - usersToUpsert.length} unchanged (skipped)`)

      // Only upsert if there are changes
      if (usersToUpsert.length > 0) {
        const { error, count } = await supabase
          .from('subscribers_insights')
          .upsert(usersToUpsert, {
            onConflict: 'distinct_id',
            count: 'exact'
          })

        if (error) {
          console.error(`Error upserting batch:`, error.message)
        } else {
          const batchCount = count || usersToUpsert.length
          totalUpserted += batchCount
        }
      }
    } catch (batchError) {
      console.error(`Exception in batch processing:`, batchError.message)
      // Continue to next batch on error (don't fail entire sync)
    }
  }

  console.log(`✓ Finished bulk upsert: ${totalUpserted} updated/new, ${totalSkippedUnchanged} skipped (unchanged)`)
  console.log(`  Efficiency: ${Math.round((totalSkippedUnchanged / users.length) * 100)}% of users had no changes`)

  return totalUpserted
}

serve(async (req) => {
  const corsResponse = handleCorsRequest(req)
  if (corsResponse) return corsResponse

  try {
    console.log('Initializing credentials and Supabase client...')
    const credentials = initializeMixpanelCredentials()
    const supabase = initializeSupabaseClient()

    console.log('Starting Mixpanel user properties sync v2 (Engage API)...')

    // Get pagination params from request body
    const body = await req.json().catch(() => ({}))
    const page = body.page || 0
    const sessionId = body.sessionId || undefined

    // Only check skip sync on first page
    if (page === 0) {
      console.log('Checking skip sync...')
      const skipResponse = await checkAndHandleSkipSync(supabase, 'mixpanel_user_properties_v2', 1)
      if (skipResponse) return skipResponse
    }

    console.log('Creating sync log...')
    const executionStartMs = Date.now()
    const { syncLog, syncStartTime } = await createSyncLog(supabase, 'user', 'mixpanel_user_properties_v2')
    const syncLogId = syncLog.id

    try {
      console.log(`Fetching user properties from Mixpanel Engage API (cohorts ${COHORT_IDS.join(', ')}, page ${page})...`)

      // Construct where filter for Email
      // Filter: users where Email property is defined/set
      const whereFilter = 'defined(properties["Email"])'

      // Fetch data from Engage API with larger page size (3000) to minimize API calls
      const response = await fetchEngageProfiles(credentials, {
        cohortIds: COHORT_IDS,
        where: whereFilter,
        outputProperties: OUTPUT_PROPERTIES,
        page: page,
        sessionId: sessionId,
        pageSize: 3000  // 3x default to reduce API calls while staying within timeout limits
      })

      console.log('✓ Received data from Mixpanel Engage API')
      console.log(`Found ${response.results.length} users in this page`)

      // Parse profiles (flat structure, much simpler than Insights API)
      const users = parseEngageProfiles(response.results)
      console.log(`✓ Parsed ${users.length} user profiles`)

      // Upsert to database
      if (users.length > 0) {
        console.log('Upserting to database...')
        const updatedCount = await updateUserPropertiesBatch(supabase, users)
        console.log(`✓ Upserted ${updatedCount} users`)
      }

      const elapsedMs = Date.now() - executionStartMs
      const elapsedSec = Math.round(elapsedMs / 1000)

      await updateSyncLogSuccess(supabase, syncLogId, {
        total_records_inserted: users.length,
      })

      // Check if there are more pages
      const hasMore = response.results.length > 0 && response.session_id
      const nextPage = page + 1

      if (hasMore) {
        console.log(`🔄 Auto-triggering next page (page=${nextPage}, session_id=${response.session_id})...`)

        // Automatically trigger next page
        const syncUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/sync-mixpanel-user-properties-v2`
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

        fetch(syncUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${serviceKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            page: nextPage,
            sessionId: response.session_id
          })
        }).catch(err => console.error('Failed to trigger next page:', err.message))

        console.log('✅ Next page triggered in background')
      } else {
        console.log('✅ All users synced!')
      }

      return createSuccessResponse('User properties page synced successfully', {
        totalTimeSeconds: elapsedSec,
        page: page,
        nextPage: hasMore ? nextPage : null,
        usersInPage: users.length,
        hasMore: hasMore,
        nextStep: hasMore ? `Next page automatically triggered (page ${nextPage})` : 'Sync complete!',
      })
    } catch (error) {
      await updateSyncLogFailure(supabase, syncLogId, error)
      throw error
    }
  } catch (error) {
    return createErrorResponse(error, 'sync-mixpanel-user-properties-v2')
  }
})
