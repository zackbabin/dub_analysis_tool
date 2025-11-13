// Supabase Edge Function: process-subscribers-data
// Part 2 of 2: Loads raw subscriber data from Storage and processes it
// Handles batch upserts with timeout prevention
// Triggered by sync-mixpanel-users after raw data is stored

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

interface SyncStats {
  subscribersFetched: number
  totalRecordsInserted: number
}

serve(async (req) => {
  // Handle CORS preflight requests
  const corsResponse = handleCorsRequest(req)
  if (corsResponse) return corsResponse

  try {
    const supabase = initializeSupabaseClient()

    // Get filename from request body
    const body = await req.json()
    const filename = body.filename

    if (!filename) {
      throw new Error('Missing filename parameter')
    }

    console.log(`Starting subscriber data processing for ${filename}...`)

    // Create sync log entry
    const { syncLog, syncStartTime } = await createSyncLog(supabase, 'user', 'subscribers_processing')
    const syncLogId = syncLog.id

    try {
      // Track elapsed time with timeout prevention
      const startTime = Date.now()
      const TIMEOUT_BUFFER_MS = 130000  // Exit after 130s (20s buffer before 150s timeout)
      const logElapsed = () => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
        console.log(`⏱️  Elapsed: ${elapsed}s / 150s`)
        return elapsed
      }

      // Download raw data from Storage
      console.log('Downloading raw subscriber data from Storage...')
      const { data: fileData, error: downloadError } = await supabase.storage
        .from('mixpanel-raw-data')
        .download(filename)

      if (downloadError) {
        console.error('Error downloading from storage:', downloadError)
        throw downloadError
      }

      const rawDataText = await fileData.text()
      const rawData = JSON.parse(rawDataText)

      logElapsed()
      console.log('✓ Raw data loaded from Storage')

      const { subscribersData, syncStartTime: originalSyncTime } = rawData

      // Process and insert data into database
      const stats: SyncStats = {
        subscribersFetched: 0,
        totalRecordsInserted: 0,
      }

      // Process subscribers insights in batches to avoid memory issues
      // Optimized for speed: larger batches + more concurrency
      const batchSize = 2000  // Increased from 1000
      let totalProcessed = 0

      const allSubscribersRows = processInsightsData(subscribersData)
      console.log(`Processed ${allSubscribersRows.length} subscriber rows, inserting in batches of ${batchSize}...`)

      // Process batches in parallel (max 5 concurrent) for faster upserts
      const maxConcurrentBatches = 5  // Increased from 3
      const batches: any[][] = []

      for (let i = 0; i < allSubscribersRows.length; i += batchSize) {
        batches.push(allSubscribersRows.slice(i, i + batchSize))
      }

      console.log(`Split into ${batches.length} batches, processing ${maxConcurrentBatches} at a time...`)

      for (let i = 0; i < batches.length; i += maxConcurrentBatches) {
        // Check if we're approaching timeout
        const elapsedMs = Date.now() - startTime
        if (elapsedMs > TIMEOUT_BUFFER_MS) {
          console.warn(`⚠️ Approaching timeout (${Math.round(elapsedMs / 1000)}s elapsed). Processed ${totalProcessed}/${allSubscribersRows.length} records.`)
          console.log('Exiting early to avoid timeout. Remaining data will be processed on next sync.')
          break
        }

        const batchGroup = batches.slice(i, i + maxConcurrentBatches)

        const results = await Promise.all(
          batchGroup.map(async (batch, idx) => {
            if (batch.length > 0) {
              const { error: insertError } = await supabase
                .from('subscribers_insights')
                .upsert(batch, {
                  onConflict: 'distinct_id',
                  ignoreDuplicates: false  // Keep false to update changed records
                })

              if (insertError) {
                console.error(`Error upserting batch ${i + idx}:`, insertError)
                throw insertError
              }

              return batch.length
            }
            return 0
          })
        )

        totalProcessed += results.reduce((sum, count) => sum + count, 0)
        console.log(`Progress: ${totalProcessed}/${allSubscribersRows.length} records (${Math.round(totalProcessed / allSubscribersRows.length * 100)}%)`)
      }

      stats.subscribersFetched = totalProcessed
      stats.totalRecordsInserted += totalProcessed

      // Update sync log with success
      await updateSyncLogSuccess(supabase, syncLogId, {
        subscribers_fetched: stats.subscribersFetched,
        total_records_inserted: stats.totalRecordsInserted,
      })

      // Delete the raw data file from storage (cleanup)
      console.log('Cleaning up storage file...')
      const { error: deleteError } = await supabase.storage
        .from('mixpanel-raw-data')
        .remove([filename])

      if (deleteError) {
        console.warn('⚠️ Failed to delete storage file:', deleteError.message)
      } else {
        console.log('✓ Storage file cleaned up')
      }

      console.log('Subscriber processing completed successfully')

      return createSuccessResponse(
        'Subscriber data processed and inserted successfully',
        stats
      )
    } catch (error) {
      // Update sync log with failure
      await updateSyncLogFailure(supabase, syncLogId, error)
      throw error
    }
  } catch (error) {
    return createErrorResponse(error, 'process-subscribers-data')
  }
})

// ============================================================================
// Helper Functions - Data Processing
// ============================================================================

function processInsightsData(data: any): any[] {
  if (!data) {
    console.log('No insights data')
    return []
  }

  const rows: any[] = []

  // Check if we have headers
  if (!data.headers) {
    console.log('No headers found in Insights data')
    return []
  }

  console.log('Insights data structure:', {
    hasHeaders: !!data.headers,
    headersCount: data.headers?.length,
    seriesType: Array.isArray(data.series) ? 'array' : typeof data.series,
  })

  // Handle Query API nested object format (PRIORITY CHECK - This is what Mixpanel returns!)
  if (data.headers && data.series && typeof data.series === 'object' && !Array.isArray(data.series)) {
    console.log('Processing Query API nested object format for user profiles')
    console.log(`Headers (${data.headers.length})`)
    console.log(`Series metrics (${Object.keys(data.series).length})`)

    const userDataMap = new Map()
    const propertyHeaders = data.headers.slice(2)
    const metricNames = Object.keys(data.series)

    function extractUserDataRecursive(obj: any, pathValues: string[], currentUserId: string | null, currentMetric: string | null, depth: number) {
      if (depth > 30 || !obj || typeof obj !== 'object') return

      for (const [key, value] of Object.entries(obj)) {
        if (key === '$overall') {
          if (typeof value === 'object') {
            extractUserDataRecursive(value, pathValues, currentUserId, currentMetric, depth + 1)
          }
          continue
        }

        if (key === 'all' && typeof value === 'number' && currentUserId && currentMetric) {
          const userData = userDataMap.get(currentUserId)
          if (userData) {
            userData[currentMetric] = value
          }
          continue
        }

        const isUserId = !currentUserId && key !== '$overall' && key !== 'all'

        if (isUserId) {
          if (!userDataMap.has(key)) {
            userDataMap.set(key, { '$distinct_id': key })
          }

          if (typeof value === 'object') {
            extractUserDataRecursive(value, pathValues, key, currentMetric, depth + 1)
          } else if (typeof value === 'number' && currentMetric) {
            const userData = userDataMap.get(key)
            if (userData) userData[currentMetric] = value
          }
        } else if (currentUserId) {
          // We're inside a user's data - collect property values
          // Handle $non_numeric_values as null/0
          const actualKey = key === '$non_numeric_values' ? null : key
          const newPath = actualKey !== null ? [...pathValues, actualKey] : pathValues

          // Map path values to property headers (dimensions)
          const userData = userDataMap.get(currentUserId)
          if (userData && actualKey !== null) {
            newPath.forEach((val, idx) => {
              if (idx < propertyHeaders.length) {
                const propName = propertyHeaders[idx]
                if (propName && !userData[propName]) {
                  userData[propName] = val
                }
              }
            })
          }

          // Continue recursing
          if (typeof value === 'object') {
            extractUserDataRecursive(value, newPath, currentUserId, currentMetric, depth + 1)
          }
        } else {
          if (typeof value === 'object') {
            extractUserDataRecursive(value, pathValues, currentUserId, currentMetric, depth + 1)
          }
        }
      }
    }

    console.log(`Processing ${metricNames.length} metrics...`)
    metricNames.forEach((metricName, idx) => {
      if (idx < 3) console.log(`  Processing metric: ${metricName}`)
      extractUserDataRecursive(data.series[metricName], [], null, metricName, 0)
    })

    console.log(`Extracted ${userDataMap.size} user profiles from nested structure`)

    const allColumns = new Set(['$distinct_id'])
    propertyHeaders.forEach((h: string) => allColumns.add(h))
    metricNames.forEach((m: string) => allColumns.add(m))

    userDataMap.forEach((userData) => {
      metricNames.forEach(metricName => {
        if (!(metricName in userData)) {
          userData[metricName] = undefined
        }
      })
      rows.push(userData)
    })
  }
  // Handle Query API tabular format (fallback)
  else if (Array.isArray(data.headers) && Array.isArray(data.series)) {
    console.log('Processing Query API tabular format')
    console.log(`Processing ${data.series.length} subscriber rows`)

    const distinctIdIndex = data.headers.indexOf('$distinct_id')
    if (distinctIdIndex === -1) {
      console.error('$distinct_id column not found in headers')
      return []
    }

    data.series.forEach((rowData: any[]) => {
      if (!Array.isArray(rowData)) return

      const row: any = {}
      data.headers.forEach((header: string, idx: number) => {
        if (idx < rowData.length) {
          row[header] = rowData[idx]
        }
      })

      rows.push(row)
    })
  }

  console.log(`Processed ${rows.length} insights rows, converting to DB format...`)

  // Convert to database format
  const now = new Date().toISOString()
  return rows.map(row => ({
    distinct_id: row['$distinct_id'] || row['distinct_id'],
    income: row['income'] || null,
    net_worth: row['netWorth'] || null,
    investing_activity: row['investingActivity'] || null,
    investing_experience_years: row['investingExperienceYears'] || null,
    investing_objective: row['investingObjective'] || null,
    investment_type: row['investmentType'] || null,
    acquisition_survey: row['acquisitionSurvey'] || null,
    linked_bank_account: row['A. Linked Bank Account'] === 1 || row['A. Linked Bank Account'] === '1',
    available_copy_credits: parseFloat(row['availableCopyCredits'] || 0),
    buying_power: parseFloat(row['buyingPower'] || 0),
    total_deposits: parseFloat(row['B. Total Deposits ($)'] || 0),
    total_deposit_count: parseInt(row['C. Total Deposit Count'] || 0),
    total_withdrawals: parseFloat(row['totalWithdrawals'] || 0),
    total_withdrawal_count: parseInt(row['totalWithdrawalCount'] || 0),
    active_created_portfolios: parseInt(row['activeCreatedPortfolios'] || 0),
    lifetime_created_portfolios: parseInt(row['lifetimeCreatedPortfolios'] || 0),
    total_copies: parseInt(row['D. Total Copies'] || 0),
    total_regular_copies: parseInt(row['E. Total Regular Copies'] || 0),
    total_premium_copies: parseInt(row['F. Total Premium Copies'] || 0),
    regular_pdp_views: parseInt(row['G. Regular PDP Views'] || 0),
    premium_pdp_views: parseInt(row['H. Premium PDP Views'] || 0),
    paywall_views: parseInt(row['I. Paywall Views'] || 0),
    regular_creator_profile_views: parseInt(row['J. Regular Creator Profile Views'] || 0),
    premium_creator_profile_views: parseInt(row['K. Premium Creator Profile Views'] || 0),
    stripe_modal_views: parseInt(row['Q. Stripe Modal Views'] || 0),
    app_sessions: parseInt(row['M. App Sessions'] || 0),
    discover_tab_views: parseInt(row['N. Discover Tab Views'] || 0),
    leaderboard_tab_views: parseInt(row['O. Leaderboard Tab Views'] || 0),
    premium_tab_views: parseInt(row['P. Premium Tab Views'] || 0),
    creator_card_taps: parseInt(row['R. Creator Card Taps'] || 0),
    portfolio_card_taps: parseInt(row['S. Portfolio Card Taps'] || 0),
    total_subscriptions: parseInt(row['L. Total Subscriptions'] || 0),
    updated_at: now,
  })).filter(row => row.distinct_id)
}
