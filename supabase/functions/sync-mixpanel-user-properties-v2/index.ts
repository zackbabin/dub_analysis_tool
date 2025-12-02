// Supabase Edge Function: sync-mixpanel-user-properties-v2
// Fetches user properties from Mixpanel Engage API (paginated, auto-chains)
// Uses Engage API instead of Insights API for better performance and simpler parsing
//
// Strategy:
// - Engage API returns only $distinct_id (no $user_id)
// - Looks up existing records in subscribers_insights by distinct_id
// - Updates properties on existing records (user_id already set by sync-mixpanel-user-events-v2)
// - Does NOT create new records (users must exist from sync-mixpanel-user-events-v2 first)
// Automatically chains to next page until all users are synced

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { fetchEngageProfiles } from '../_shared/mixpanel-api.ts'
import {
  initializeMixpanelCredentials,
  initializeSupabaseClient,
  handleCorsRequest,
  createSyncLog,
  updateSyncLogSuccess,
  updateSyncLogFailure,
  createSuccessResponse,
  createErrorResponse,
  sanitizeDistinctId,
} from '../_shared/sync-helpers.ts'

const COHORT_IDS = [5825472] // Premium Creator Analysis cohort

// List of Mixpanel properties to fetch
const OUTPUT_PROPERTIES = [
  'income',
  'netWorth',
  'investingActivity',
  'investingExperienceYears',
  'investingObjective',
  'investmentType',
  'acquisitionSurvey',
  'availableCopyCredits',
  'buyingPower',
  'activeCreatedPortfolios',
  'lifetimeCreatedPortfolios',
  'activeCopiedPortfolios',
  'lifetimeCopiedPortfolios',
  'totalDeposits',
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
  available_copy_credits?: number
  buying_power?: number
  active_created_portfolios?: number
  lifetime_created_portfolios?: number
  active_copied_portfolios?: number
  lifetime_copied_portfolios?: number
  total_deposits?: number
}

/**
 * Map Mixpanel property names to database column names
 */
const PROPERTY_MAP: Record<string, string> = {
  'income': 'income',
  'netWorth': 'net_worth',
  'investingActivity': 'investing_activity',
  'investingExperienceYears': 'investing_experience_years',
  'investingObjective': 'investing_objective',
  'investmentType': 'investment_type',
  'acquisitionSurvey': 'acquisition_survey',
  'availableCopyCredits': 'available_copy_credits',
  'buyingPower': 'buying_power',
  'activeCreatedPortfolios': 'active_created_portfolios',
  'lifetimeCreatedPortfolios': 'lifetime_created_portfolios',
  'activeCopiedPortfolios': 'active_copied_portfolios',
  'lifetimeCopiedPortfolios': 'lifetime_copied_portfolios',
  'totalDeposits': 'total_deposits',
}

/**
 * Parse Mixpanel Engage API response (flat $properties structure)
 */
function parseEngageProfiles(profiles: any[]): UserPropertyRow[] {
  const users: UserPropertyRow[] = []

  for (const profile of profiles) {
    try {
      const rawDistinctId = profile.$distinct_id
      if (!rawDistinctId) {
        console.warn('Profile missing distinct_id:', profile)
        continue
      }

      const distinctId = sanitizeDistinctId(rawDistinctId)
      if (!distinctId) {
        console.warn('Profile has invalid distinct_id after sanitization:', rawDistinctId)
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
          if (dbColumn === 'available_copy_credits' || dbColumn === 'buying_power' ||
              dbColumn === 'active_created_portfolios' || dbColumn === 'lifetime_created_portfolios' ||
              dbColumn === 'active_copied_portfolios' || dbColumn === 'lifetime_copied_portfolios' ||
              dbColumn === 'total_deposits') {
            (row as any)[dbColumn] = 0
          }
          continue
        }

        // Handle different field types
        if (
          // Explicitly defined string fields (text in DB)
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
          // Numeric/integer fields
          dbColumn === 'available_copy_credits' ||
          dbColumn === 'buying_power' ||
          dbColumn === 'active_created_portfolios' ||
          dbColumn === 'lifetime_created_portfolios' ||
          dbColumn === 'active_copied_portfolios' ||
          dbColumn === 'lifetime_copied_portfolios' ||
          dbColumn === 'total_deposits'
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
    'available_copy_credits',
    'buying_power',
    'active_created_portfolios',
    'lifetime_created_portfolios',
    'active_copied_portfolios',
    'lifetime_copied_portfolios',
    'total_deposits',
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
        // On error, skip batch to avoid data corruption (safe fallback)
        console.warn('Skipping batch due to fetch error')
        continue
      }

      // Create map of existing records for fast lookup
      const existingMap = new Map()
      if (existingRecords) {
        for (const record of existingRecords) {
          existingMap.set(record.distinct_id, record)
        }
      }

      // Filter batch to only include users with changes AND existing records
      // (Engage API should only update, not create new users)
      let skippedNew = 0
      const usersToUpsert = batch.filter(user => {
        const existing = existingMap.get(user.distinct_id)

        // Skip if user doesn't exist (no user_id from sync-mixpanel-user-events-v2)
        if (!existing) {
          skippedNew++
          return false
        }

        const needsUpdate = hasUserPropertiesChanged(existing, user)

        if (!needsUpdate) {
          totalSkippedUnchanged++
        }

        return needsUpdate
      })

      console.log(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${usersToUpsert.length} changed, ${batch.length - usersToUpsert.length - skippedNew} unchanged (skipped), ${skippedNew} new (skipped - needs user_id from events sync first)`)

      // Only update if there are changes
      if (usersToUpsert.length > 0) {
        // Transform users to include user_id from existing records for bulk upsert
        const recordsToUpdate = usersToUpsert
          .map(user => {
            const existing = existingMap.get(user.distinct_id)
            if (!existing || !existing.user_id) {
              return null
            }

            return {
              user_id: existing.user_id,
              distinct_id: user.distinct_id,
              income: user.income,
              net_worth: user.net_worth,
              investing_activity: user.investing_activity,
              investing_experience_years: user.investing_experience_years,
              investing_objective: user.investing_objective,
              investment_type: user.investment_type,
              acquisition_survey: user.acquisition_survey,
              available_copy_credits: user.available_copy_credits,
              buying_power: user.buying_power,
              active_created_portfolios: user.active_created_portfolios,
              lifetime_created_portfolios: user.lifetime_created_portfolios,
              active_copied_portfolios: user.active_copied_portfolios,
              lifetime_copied_portfolios: user.lifetime_copied_portfolios,
              total_deposits: user.total_deposits,
            }
          })
          .filter(record => record !== null)

        if (recordsToUpdate.length > 0) {
          // Bulk upsert using user_id as conflict key (much faster than individual updates)
          const { error, count } = await supabase
            .from('subscribers_insights')
            .upsert(recordsToUpdate, {
              onConflict: 'user_id',
              count: 'exact'
            })

          if (error) {
            console.error(`Error upserting batch:`, error.message)
            throw error
          }

          const successCount = count || recordsToUpdate.length
          totalUpserted += successCount
          console.log(`  Successfully upserted ${successCount} records (bulk operation)`)
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

      // Update sync log with success IMMEDIATELY after storing data
      // This ensures the log is marked as completed even if function times out after this point
      await updateSyncLogSuccess(supabase, syncLogId, {
        total_records_inserted: users.length,
      })
      console.log(`✅ Sync log ${syncLogId} marked as completed`)

      const elapsedMs = Date.now() - executionStartMs
      const elapsedSec = Math.round(elapsedMs / 1000)

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
