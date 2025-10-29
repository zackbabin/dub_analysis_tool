// Supabase Edge Function: sync-user-creator-copies
// Fetches user-creator copy data from Mixpanel Insights API (Chart ID: 85313040)
// Stores data in user_creator_copies table for simplified copy analysis
// Triggered manually alongside other sync functions

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4'
import {
  CORS_HEADERS,
  type MixpanelCredentials,
  fetchInsightsData,
} from '../_shared/mixpanel-api.ts'

interface SyncStats {
  userCreatorCopiesFetched: number
  totalRecordsInserted: number
  chartId: string
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    // Get Mixpanel credentials from Supabase secrets
    const mixpanelUsername = Deno.env.get('MIXPANEL_SERVICE_USERNAME')
    const mixpanelSecret = Deno.env.get('MIXPANEL_SERVICE_SECRET')

    if (!mixpanelUsername || !mixpanelSecret) {
      throw new Error('Mixpanel credentials not configured in Supabase secrets')
    }

    console.log('Mixpanel credentials loaded from secrets')

    // Initialize Supabase client with service role key
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    console.log('Starting user-creator copies sync...')

    // Create sync log entry
    const syncStartTime = new Date()
    const { data: syncLog, error: syncLogError } = await supabase
      .from('sync_logs')
      .insert({
        tool_type: 'user',
        sync_started_at: syncStartTime.toISOString(),
        sync_status: 'in_progress',
        source: 'mixpanel_user_creator_copies',
        triggered_by: 'manual',
      })
      .select()
      .single()

    if (syncLogError) {
      console.error('Failed to create sync log:', syncLogError)
      throw syncLogError
    }

    const syncLogId = syncLog.id

    try {
      const credentials: MixpanelCredentials = {
        username: mixpanelUsername,
        secret: mixpanelSecret,
      }

      // Fetch user-creator copies from Insights API (chart 85313040)
      const chartId = '85313040'
      console.log(`Fetching user-creator copies from Insights API (Chart ${chartId})...`)

      const copiesData = await fetchInsightsData(
        credentials,
        chartId,
        'User Creator Copies'
      )

      console.log('✓ User-creator copies fetched successfully')

      // Process data
      const stats: SyncStats = {
        userCreatorCopiesFetched: 0,
        totalRecordsInserted: 0,
        chartId,
      }

      if (!copiesData?.series) {
        console.warn('No copy data returned from Mixpanel')
        throw new Error('No copy data available')
      }

      console.log('Processing user-creator copies...')

      // Parse Mixpanel Insights response structure:
      // series: {
      //   "A. Total Copies": { distinct_id: { creator_username: { creatorType: { "Regular": {...}, "Premium": {...} } } } },
      //   "B. Total Liquidations": { distinct_id: { creator_username: { creatorType: { "all": count } } } }
      // }

      const copyRows: any[] = []
      const copiesMetric = copiesData.series['A. Total Copies']
      const liquidationsMetric = copiesData.series['B. Total Liquidations']

      if (!copiesMetric) {
        throw new Error('Total Copies metric not found in response')
      }

      // Iterate through all distinct_ids
      for (const [distinctId, creatorData] of Object.entries(copiesMetric)) {
        // Skip $overall aggregate
        if (distinctId === '$overall') continue

        // creatorData structure: { "$overall": {...}, "creator_username": { "$overall": {...}, "Regular": {...}, "Premium": {...} }, ... }
        if (typeof creatorData !== 'object' || creatorData === null) continue

        // Iterate through creators for this user
        for (const [creatorUsername, typeData] of Object.entries(creatorData as Record<string, any>)) {
          // Skip $overall for this user
          if (creatorUsername === '$overall') continue

          if (typeof typeData !== 'object' || typeData === null) continue

          // Extract Regular and Premium copy counts
          let regularCount = 0
          let premiumCount = 0
          let totalCount = 0

          // Check for Regular copies
          if (typeData.Regular && typeof typeData.Regular === 'object') {
            regularCount = typeData.Regular.all || 0
          }

          // Check for Premium copies
          if (typeData.Premium && typeof typeData.Premium === 'object') {
            premiumCount = typeData.Premium.all || 0
          }

          // Also check for legacy format (direct "all" count without type breakdown)
          if (typeData.all && typeof typeData.all === 'number') {
            totalCount = typeData.all
            // If we have a total but no breakdown, assume it's regular
            if (regularCount === 0 && premiumCount === 0) {
              regularCount = totalCount
            }
          } else {
            totalCount = regularCount + premiumCount
          }

          // Extract liquidation count from liquidationsMetric
          let liquidationCount = 0
          if (liquidationsMetric && liquidationsMetric[distinctId]) {
            const liquidationCreatorData = liquidationsMetric[distinctId]
            if (liquidationCreatorData && typeof liquidationCreatorData === 'object') {
              const creatorLiquidations = liquidationCreatorData[creatorUsername]
              if (creatorLiquidations && typeof creatorLiquidations === 'object') {
                // Could be nested under creatorType or have direct 'all' count
                if (creatorLiquidations.all) {
                  liquidationCount = creatorLiquidations.all || 0
                } else if (creatorLiquidations.$overall && creatorLiquidations.$overall.all) {
                  liquidationCount = creatorLiquidations.$overall.all || 0
                }
              }
            }
          }

          if (totalCount > 0) {
            // Normalize username: ensure it starts with @
            const normalizedUsername = creatorUsername.startsWith('@')
              ? creatorUsername
              : '@' + creatorUsername

            copyRows.push({
              distinct_id: distinctId,
              creator_username: normalizedUsername,
              copy_count: totalCount,
              regular_copy_count: regularCount,
              premium_copy_count: premiumCount,
              liquidation_count: liquidationCount,
              synced_at: syncStartTime.toISOString()
            })
          }
        }
      }

      console.log(`Prepared ${copyRows.length} user-creator copy records`)

      // Aggregate duplicates (same user copying same creator as both Regular and Premium)
      const aggregatedRows = new Map<string, any>()

      for (const row of copyRows) {
        const key = `${row.distinct_id}|${row.creator_username}`

        if (aggregatedRows.has(key)) {
          const existing = aggregatedRows.get(key)
          existing.copy_count += row.copy_count
          existing.regular_copy_count += row.regular_copy_count
          existing.premium_copy_count += row.premium_copy_count
          existing.liquidation_count += row.liquidation_count
        } else {
          aggregatedRows.set(key, { ...row })
        }
      }

      const finalRows = Array.from(aggregatedRows.values())
      console.log(`Aggregated to ${finalRows.length} unique user-creator copy records`)
      stats.userCreatorCopiesFetched = finalRows.length

      // Upsert data in batches
      const batchSize = 500
      let totalInserted = 0

      for (let i = 0; i < finalRows.length; i += batchSize) {
        const batch = finalRows.slice(i, i + batchSize)
        const { error: insertError } = await supabase
          .from('user_creator_copies')
          .upsert(batch, {
            onConflict: 'distinct_id,creator_username',
            ignoreDuplicates: false
          })

        if (insertError) {
          console.error('Error upserting user-creator copies batch:', insertError)
          throw insertError
        }

        totalInserted += batch.length
        console.log(`Upserted batch: ${totalInserted}/${finalRows.length} records`)
      }

      stats.totalRecordsInserted = totalInserted

      // Update sync log with success
      const syncEndTime = new Date()
      await supabase
        .from('sync_logs')
        .update({
          sync_completed_at: syncEndTime.toISOString(),
          sync_status: 'completed',
          total_records_inserted: stats.totalRecordsInserted,
        })
        .eq('id', syncLogId)

      console.log('User-creator copies sync completed successfully')

      return new Response(
        JSON.stringify({
          success: true,
          message: 'User-creator copies sync completed successfully',
          stats,
        }),
        {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          status: 200,
        }
      )
    } catch (error) {
      // Update sync log with failure
      await supabase
        .from('sync_logs')
        .update({
          sync_completed_at: new Date().toISOString(),
          sync_status: 'failed',
          error_message: error.message,
          error_details: { stack: error.stack },
        })
        .eq('id', syncLogId)

      throw error
    }
  } catch (error) {
    console.error('Error in sync-user-creator-copies function:', error)

    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message || 'Unknown error occurred',
        details: error?.stack || String(error)
      }),
      {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        status: 500,
      }
    )
  }
})
