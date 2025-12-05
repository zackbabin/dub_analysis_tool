// Supabase Edge Function: sync-first-copy-users
// Fetches users who copied at least once from Mixpanel Insights chart 86612901
// Populates user_first_copies table for use by sync-portfolio-sequences and sync-creator-sequences
//
// Data source:
//   - Mixpanel Insights chart 86612901: "Uniques of Copied Portfolio" with $user_id and $time
//
// Optimizations for large datasets (13k+ users):
//   - Batched upserts (1000 rows per batch) to avoid timeout
//   - Streamlined validation to reduce processing time
//   - Database upsert with onConflict handles deduplication
//
// Note: Insights API doesn't support date filtering
//   - Always fetches all data from chart (date range configured in Mixpanel UI)

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import {
  initializeMixpanelCredentials,
  initializeSupabaseClient,
  handleCorsRequest,
  createSyncLog,
  updateSyncLogSuccess,
  updateSyncLogFailure,
  createSuccessResponse,
  createErrorResponse,
} from '../_shared/sync-helpers.ts'
import { MIXPANEL_CONFIG } from '../_shared/mixpanel-api.ts'

serve(async (req) => {
  // Handle CORS preflight requests
  const corsResponse = handleCorsRequest(req)
  if (corsResponse) return corsResponse

  try {
    // Initialize Mixpanel credentials and Supabase client
    const credentials = initializeMixpanelCredentials()
    const supabase = initializeSupabaseClient()

    console.log('Starting first copy users sync from Mixpanel chart 86612901...')

    // Create sync log entry
    const { syncLog, syncStartTime } = await createSyncLog(supabase, 'user', 'first_copy_users')
    const syncLogId = syncLog.id

    try {
      // Note: Insights API doesn't support date filtering
      // We fetch all data from the chart and let DB upsert handle deduplication
      console.log('📦 Fetching all data from chart (date range configured in Mixpanel UI)')

      // Fetch chart 86612901
      const projectId = MIXPANEL_CONFIG.PROJECT_ID
      const chartId = '86612901'
      const chartUrl = `https://mixpanel.com/api/query/insights?project_id=${projectId}&bookmark_id=${chartId}`

      console.log(`Fetching Mixpanel chart ${chartId}...`)

      // Use Basic Auth
      const authString = `${credentials.username}:${credentials.secret}`
      const authHeader = `Basic ${btoa(authString)}`

      const chartResponse = await fetch(chartUrl, {
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/json',
        },
      })

      if (!chartResponse.ok) {
        throw new Error(`Chart API failed: ${chartResponse.status} ${chartResponse.statusText}`)
      }

      const chartData = await chartResponse.json()

      // Debug: Log full response structure to identify any pagination/limits
      console.log('📊 Chart API response keys:', Object.keys(chartData))
      if (chartData.meta) {
        console.log('📊 Response metadata:', JSON.stringify(chartData.meta, null, 2))
      }
      if (chartData.limit || chartData.total || chartData.page) {
        console.log('📊 Pagination info:', {
          limit: chartData.limit,
          total: chartData.total,
          page: chartData.page
        })
      }

      // Debug: Log chart response structure
      console.log('📊 Chart response structure:', {
        hasSeriesKey: !!chartData.series,
        seriesKeys: Object.keys(chartData.series || {}),
        totalKeysInSeries: Object.keys(chartData.series || {}).length
      })

      // Parse series object to extract first copy times
      // Chart 86612901 structure: metric -> $user_id -> $time
      // Headers: ["$metric", "$user_id", "$time"]
      const copyRows: Array<{ user_id: string; first_copy_time: string }> = []
      const series = chartData.series?.['Uniques of Copied Portfolio'] || {}

      // Check if response was limited/truncated
      const seriesLength = Object.keys(series).filter(k => k !== '$overall').length
      console.log(`⚠️ IMPORTANT: Fetched ${seriesLength} users from Insights API`)
      console.log(`⚠️ If this is exactly 3000, the Mixpanel Insights API may be limiting results`)
      console.log(`⚠️ Mixpanel Insights charts have a ~3000 row limit - consider using JQL API for full dataset`)

      // Debug: Log how many user entries we're processing
      const totalUserEntries = Object.keys(series).filter(k => k !== '$overall').length
      console.log(`📊 Processing ${totalUserEntries} user entries from series`)
      console.log(`✓ Fetched chart data (${Object.keys(chartData.series || {}).length} total keys in all series)`)

      let skippedCount = 0

      for (const [userId, userIdData] of Object.entries(series)) {
        // Skip $overall aggregation key and empty user IDs
        if (userId === '$overall' || !userId) continue

        // Quick validation: userIdData should be an object
        if (!userIdData || typeof userIdData !== 'object') {
          skippedCount++
          continue
        }

        // Extract first timestamp (first key that isn't $overall)
        const timestamps = Object.keys(userIdData as Record<string, any>)
        const firstCopyTime = timestamps.find(k => k !== '$overall')

        if (!firstCopyTime) {
          skippedCount++
          continue
        }

        // Optimized: Skip detailed validation, let Date constructor handle it
        // Invalid dates will become Invalid Date and can be filtered if needed
        try {
          const firstCopyDate = new Date(firstCopyTime)
          if (isNaN(firstCopyDate.getTime())) {
            skippedCount++
            continue
          }

          copyRows.push({
            user_id: userId,
            first_copy_time: firstCopyDate.toISOString()
          })
        } catch (error) {
          skippedCount++
          continue
        }
      }

      if (skippedCount > 0) {
        console.log(`ℹ️ Skipped ${skippedCount} entries with invalid/missing data`)
      }

      console.log(`✓ Extracted ${copyRows.length} first copy users from chart`)

      // Fetch chart 87036512 for KYC approved events
      const kycChartId = '87036512'
      const kycChartUrl = `https://mixpanel.com/api/query/insights?project_id=${projectId}&bookmark_id=${kycChartId}`

      console.log(`Fetching Mixpanel chart ${kycChartId} for KYC approved events...`)

      const kycChartResponse = await fetch(kycChartUrl, {
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/json',
        },
      })

      if (!kycChartResponse.ok) {
        throw new Error(`KYC Chart API failed: ${kycChartResponse.status} ${kycChartResponse.statusText}`)
      }

      const kycChartData = await kycChartResponse.json()

      console.log('📊 KYC Chart API response keys:', Object.keys(kycChartData))

      // Parse KYC approved times - same structure as first copy chart
      const kycApprovedMap = new Map<string, string>()
      const kycSeries = kycChartData.series?.['Uniques of Approved KYC'] || {}

      let kycSkippedCount = 0

      for (const [userId, userIdData] of Object.entries(kycSeries)) {
        // Skip $overall aggregation key and empty user IDs
        if (userId === '$overall' || !userId) continue

        // Quick validation: userIdData should be an object
        if (!userIdData || typeof userIdData !== 'object') {
          kycSkippedCount++
          continue
        }

        // Extract first timestamp (first key that isn't $overall)
        const timestamps = Object.keys(userIdData as Record<string, any>)
        const kycApprovedTime = timestamps.find(k => k !== '$overall')

        if (!kycApprovedTime) {
          kycSkippedCount++
          continue
        }

        try {
          const kycApprovedDate = new Date(kycApprovedTime)
          if (isNaN(kycApprovedDate.getTime())) {
            kycSkippedCount++
            continue
          }

          kycApprovedMap.set(userId, kycApprovedDate.toISOString())
        } catch (error) {
          kycSkippedCount++
          continue
        }
      }

      if (kycSkippedCount > 0) {
        console.log(`ℹ️ Skipped ${kycSkippedCount} KYC entries with invalid/missing data`)
      }

      console.log(`✓ Extracted ${kycApprovedMap.size} KYC approved times from chart`)

      // Map KYC approved times to copy rows
      const copyRowsWithKyc = copyRows.map(row => ({
        ...row,
        kyc_approved_time: kycApprovedMap.get(row.user_id) || null
      }))

      const rowsWithBothTimestamps = copyRowsWithKyc.filter(row => row.kyc_approved_time !== null).length
      console.log(`✓ ${rowsWithBothTimestamps} users have both first_copy_time and kyc_approved_time`)

      // Insert/update user_first_copies in batches for better performance
      if (copyRowsWithKyc.length > 0) {
        const BATCH_SIZE = 1000 // Supabase handles ~1000 rows per upsert efficiently
        let totalUpserted = 0

        for (let i = 0; i < copyRowsWithKyc.length; i += BATCH_SIZE) {
          const batch = copyRowsWithKyc.slice(i, i + BATCH_SIZE)
          const { error: copyError } = await supabase
            .from('user_first_copies')
            .upsert(batch, {
              onConflict: 'user_id'  // PRIMARY KEY - will update first_copy_time if changed
            })

          if (copyError) {
            console.error(`Error upserting batch ${i / BATCH_SIZE + 1}:`, copyError)
            throw copyError
          }

          totalUpserted += batch.length
          console.log(`✓ Upserted batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(copyRowsWithKyc.length / BATCH_SIZE)} (${totalUpserted}/${copyRowsWithKyc.length} rows)`)
        }

        console.log(`✅ Upserted ${totalUpserted} total rows to user_first_copies`)
      } else {
        console.log('ℹ️ No new first copy users to sync')
      }

      // Update sync log with success
      await updateSyncLogSuccess(supabase, syncLogId, {
        total_records_inserted: copyRowsWithKyc.length,
        metadata: {
          firstCopyChartId: '86612901',
          kycApprovedChartId: '87036512',
          usersWithBothTimestamps: rowsWithBothTimestamps
        }
      })

      return createSuccessResponse({
        message: 'First copy users synced successfully',
        stats: {
          usersSynced: copyRowsWithKyc.length,
          usersWithKycApproved: rowsWithBothTimestamps
        }
      })
    } catch (error: any) {
      // Update sync log with failure
      await updateSyncLogFailure(supabase, syncLogId, error)
      throw error
    }
  } catch (error: any) {
    console.error('Error in sync-first-copy-users function:', error)
    return createErrorResponse(error.message || String(error))
  }
})
