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
      // series: { "Total Copies": { "distinct_id": { "$overall": {...}, "creator_username": { "all": count }, ... } } }

      const copyRows: any[] = []
      const copiesMetric = copiesData.series['Total Copies']

      if (!copiesMetric) {
        throw new Error('Total Copies metric not found in response')
      }

      // Iterate through all distinct_ids
      for (const [distinctId, creatorData] of Object.entries(copiesMetric)) {
        // Skip $overall aggregate
        if (distinctId === '$overall') continue

        // creatorData structure: { "$overall": {...}, "creator_username": { "all": count }, ... }
        if (typeof creatorData !== 'object' || creatorData === null) continue

        // Iterate through creators for this user
        for (const [creatorUsername, countData] of Object.entries(creatorData as Record<string, any>)) {
          // Skip $overall for this user
          if (creatorUsername === '$overall') continue

          // Extract copy count
          const count = (countData as any)?.all || 0
          if (count > 0) {
            copyRows.push({
              distinct_id: distinctId,
              creator_username: creatorUsername,
              copy_count: count,
              synced_at: syncStartTime.toISOString()
            })
          }
        }
      }

      console.log(`Prepared ${copyRows.length} user-creator copy records`)
      stats.userCreatorCopiesFetched = copyRows.length

      // Upsert data in batches
      const batchSize = 500
      let totalInserted = 0

      for (let i = 0; i < copyRows.length; i += batchSize) {
        const batch = copyRows.slice(i, i + batchSize)
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
        console.log(`Upserted batch: ${totalInserted}/${copyRows.length} records`)
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
