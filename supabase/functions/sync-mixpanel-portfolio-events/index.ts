// Supabase Edge Function: sync-mixpanel-portfolio-events
// Fetches raw portfolio view events from Mixpanel Event Export API
// Part 4 of 4: Handles only portfolio_view_events table (isolated due to high volume)
// Triggered manually by user clicking "Sync Live Data" button

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4'
import {
  CORS_HEADERS,
  type MixpanelCredentials,
  fetchPortfolioViewEvents,
} from '../_shared/mixpanel-api.ts'

interface SyncStats {
  portfolioEventsFetched: number
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
        source: 'mixpanel_portfolio_events',
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
      // Date range (last 7 days) - reduced from 14 to avoid timeout on high-volume events
      const today = new Date()
      const sevenDaysAgo = new Date()
      sevenDaysAgo.setDate(today.getDate() - 7)

      const toDate = today.toISOString().split('T')[0]
      const fromDate = sevenDaysAgo.toISOString().split('T')[0]

      console.log(`Fetching data from ${fromDate} to ${toDate} (7-day window)`)

      const credentials: MixpanelCredentials = {
        username: mixpanelUsername,
        secret: mixpanelSecret,
      }

      // Fetch portfolio view events only (with email filter to reduce volume)
      console.log('Fetching portfolio view events from Event Export API...')

      const portfolioViewEvents = await fetchPortfolioViewEvents(
        credentials,
        fromDate,
        toDate,
        'Viewed Portfolio Details',
        'defined(user["$email"])'
      )

      console.log('✓ Portfolio events fetched successfully')

      // Process and insert portfolio view events into database
      const stats: SyncStats = {
        portfolioEventsFetched: 0,
        totalRecordsInserted: 0,
      }

      const batchSize = 500

      // Store portfolio view events for sequence analysis
      if (portfolioViewEvents && portfolioViewEvents.length > 0) {
        console.log(`Processing ${portfolioViewEvents.length} portfolio view events...`)

        const portfolioEventRows = portfolioViewEvents.map((event: any) => ({
          distinct_id: event.properties.distinct_id,
          portfolio_ticker: event.properties.portfolioTicker,
          event_time: event.properties.time,
          synced_at: syncStartTime.toISOString()
        }))

        // Deduplicate by distinct_id + portfolio_ticker + event_time
        const uniqueEventsMap = new Map()
        portfolioEventRows.forEach((row: any) => {
          const key = `${row.distinct_id}|${row.portfolio_ticker}|${row.event_time}`
          uniqueEventsMap.set(key, row)
        })
        const uniqueEvents = Array.from(uniqueEventsMap.values())

        console.log(`Deduplicating: ${portfolioEventRows.length} events -> ${uniqueEvents.length} unique events`)

        // Upsert in batches
        for (let i = 0; i < uniqueEvents.length; i += batchSize) {
          const batch = uniqueEvents.slice(i, i + batchSize)
          const { error: insertError } = await supabase
            .from('portfolio_view_events')
            .upsert(batch, {
              onConflict: 'distinct_id,portfolio_ticker,event_time',
              ignoreDuplicates: false
            })

          if (insertError) {
            console.error('Error upserting portfolio view events batch:', insertError)
            throw insertError
          }
          console.log(`Upserted batch: ${i + batch.length}/${uniqueEvents.length} portfolio events`)
        }
        console.log('✓ Portfolio view events upserted successfully')
        stats.portfolioEventsFetched = uniqueEvents.length
        stats.totalRecordsInserted += uniqueEvents.length
      }

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

      console.log('Portfolio events sync completed successfully')

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Portfolio events sync completed successfully',
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
    console.error('Error in sync-mixpanel-engagement function:', error)

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
