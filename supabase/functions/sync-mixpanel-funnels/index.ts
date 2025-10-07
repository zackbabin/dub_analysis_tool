// Supabase Edge Function: sync-mixpanel-funnels
// Fetches time funnel data from Mixpanel
// Part 2 of 4: Handles only time_funnels table
// Triggered manually by user clicking "Sync Live Data" button after sync-mixpanel-users completes

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4'
import {
  MIXPANEL_CONFIG,
  CORS_HEADERS,
  type MixpanelCredentials,
  pLimit,
  fetchFunnelData,
} from '../_shared/mixpanel-api.ts'
import { processFunnelData } from '../_shared/data-processing.ts'

const CHART_IDS = {
  timeToFirstCopy: '84999271',
  timeToFundedAccount: '84999267',
  timeToLinkedBank: '84999265',
}

interface SyncStats {
  timeFunnelsFetched: number
  totalRecordsInserted: number
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

    console.log('Starting Mixpanel sync...')

    // Create sync log entry
    const syncStartTime = new Date()
    const { data: syncLog, error: syncLogError} = await supabase
      .from('sync_logs')
      .insert({
        tool_type: 'user',
        sync_started_at: syncStartTime.toISOString(),
        sync_status: 'in_progress',
        source: 'mixpanel_funnels',
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
      // Date range (last 30 days)
      const today = new Date()
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(today.getDate() - 30)

      const toDate = today.toISOString().split('T')[0]
      const fromDate = thirtyDaysAgo.toISOString().split('T')[0]

      console.log(`Fetching data from ${fromDate} to ${toDate}`)

      const credentials: MixpanelCredentials = {
        username: mixpanelUsername,
        secret: mixpanelSecret,
      }

      // Fetch funnel data with controlled concurrency to respect Mixpanel rate limits
      // Max 5 concurrent queries allowed by Mixpanel - we use 3 for safety
      console.log('Fetching time funnels with max 3 concurrent requests...')
      const CONCURRENCY_LIMIT = 3
      const limit = pLimit(CONCURRENCY_LIMIT)

      const [
        timeToFirstCopyData,
        timeToFundedData,
        timeToLinkedData,
      ]: [any, any, any] = await Promise.all([
        limit(() =>
          fetchFunnelData(
            credentials,
            CHART_IDS.timeToFirstCopy,
            'Time to First Copy',
            fromDate,
            toDate
          )
        ),
        limit(() =>
          fetchFunnelData(
            credentials,
            CHART_IDS.timeToFundedAccount,
            'Time to Funded Account',
            fromDate,
            toDate
          )
        ),
        limit(() =>
          fetchFunnelData(
            credentials,
            CHART_IDS.timeToLinkedBank,
            'Time to Linked Bank',
            fromDate,
            toDate
          )
        ),
      ])

      console.log('✓ Funnel data fetched successfully with controlled concurrency')

      // Process and insert data into database
      const stats: SyncStats = {
        timeFunnelsFetched: 0,
        totalRecordsInserted: 0,
      }

      const batchSize = 500

      // Process time funnels
      const timeFunnelRows = [
        ...processFunnelData(timeToFirstCopyData, 'time_to_first_copy'),
        ...processFunnelData(timeToFundedData, 'time_to_funded_account'),
        ...processFunnelData(timeToLinkedData, 'time_to_linked_bank'),
      ]

      if (timeFunnelRows.length > 0) {
        // Deduplicate rows by distinct_id + funnel_type + synced_at (keep last occurrence)
        const uniqueRowsMap = new Map()
        timeFunnelRows.forEach(row => {
          const key = `${row.distinct_id}|${row.funnel_type}|${row.synced_at}`
          uniqueRowsMap.set(key, row)
        })
        const uniqueRows = Array.from(uniqueRowsMap.values())

        console.log(`Deduplicating: ${timeFunnelRows.length} rows -> ${uniqueRows.length} unique rows`)

        // Use upsert to handle duplicates
        const { error: insertError } = await supabase
          .from('time_funnels')
          .upsert(uniqueRows, {
            onConflict: 'distinct_id,funnel_type,synced_at',
            ignoreDuplicates: false
          })

        if (insertError) {
          console.error('Error upserting time funnels:', insertError)
          throw insertError
        }

        stats.timeFunnelsFetched = uniqueRows.length
        stats.totalRecordsInserted += uniqueRows.length
        console.log(`Upserted ${uniqueRows.length} time funnel records`)
      }

      // Update sync log with success
      const syncEndTime = new Date()
      await supabase
        .from('sync_logs')
        .update({
          sync_completed_at: syncEndTime.toISOString(),
          sync_status: 'completed',
          time_funnels_fetched: stats.timeFunnelsFetched,
          total_records_inserted: stats.totalRecordsInserted,
        })
        .eq('id', syncLogId)

      console.log('Funnel sync completed successfully')

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Mixpanel funnel sync completed successfully',
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
    console.error('Error in sync-mixpanel-funnels function:', error)

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
