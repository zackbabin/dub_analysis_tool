// Supabase Edge Function: sync-event-sequences
// Fetches user event sequences from Mixpanel Insights API (Chart ID: 85247935)
// Joins with subscribers_insights to get conversion outcomes (total_copies, subscriptions)
// Stores in user_event_sequences table for Claude analysis
// Triggered manually alongside other sync functions

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4'
import {
  CORS_HEADERS,
  type MixpanelCredentials,
  fetchInsightsData,
} from '../_shared/mixpanel-api.ts'

interface SyncStats {
  eventSequencesFetched: number
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

    console.log('Starting event sequences sync...')

    // Create sync log entry
    const syncStartTime = new Date()
    const { data: syncLog, error: syncLogError } = await supabase
      .from('sync_logs')
      .insert({
        tool_type: 'user',
        sync_started_at: syncStartTime.toISOString(),
        sync_status: 'in_progress',
        source: 'mixpanel_event_sequences',
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

      // Fetch event sequences from Insights API (chart 85247935)
      const chartId = '85247935'
      console.log(`Fetching event sequences from Insights API (Chart ${chartId})...`)

      const eventSequencesData = await fetchInsightsData(
        credentials,
        chartId,
        'User Event Sequences'
      )

      console.log('✓ Event sequences fetched successfully')

      // Fetch subscribers_insights to get conversion outcomes
      console.log('Fetching conversion outcomes from subscribers_insights...')
      const { data: subscribers, error: subscribersError } = await supabase
        .from('subscribers_insights')
        .select('distinct_id, total_copies, paywall_views, stripe_modal_views')

      if (subscribersError) {
        console.error('Failed to fetch subscribers:', subscribersError)
        throw subscribersError
      }

      console.log(`✓ Fetched ${subscribers?.length || 0} subscriber records`)

      // Create lookup map for fast joining
      const subscriberMap = new Map(
        (subscribers || []).map(s => [s.distinct_id, s])
      )

      // Process event sequences data
      // Expected format from Mixpanel chart: array of objects with distinct_id and events array
      const stats: SyncStats = {
        eventSequencesFetched: 0,
        totalRecordsInserted: 0,
        chartId,
      }

      if (!eventSequencesData?.series || eventSequencesData.series.length === 0) {
        console.warn('No event sequence data returned from Mixpanel')
        throw new Error('No event sequence data available')
      }

      // Process the Insights API response
      // The structure depends on how chart 85247935 is configured
      // Typically: { series: [...], labels: [...], data: { values: {...} } }
      console.log('Processing event sequences...')

      const eventSequenceRows: any[] = []

      // Parse the response based on Mixpanel Insights API structure
      // This may need adjustment based on actual chart configuration
      if (eventSequencesData.data && eventSequencesData.data.values) {
        const values = eventSequencesData.data.values

        // Iterate through distinct_ids in the response
        for (const [distinctId, events] of Object.entries(values)) {
          const subscriber = subscriberMap.get(distinctId as string)

          // Determine if user has subscribed (paywall_views or stripe_modal_views > 0)
          const hasSubscribed =
            (subscriber?.paywall_views || 0) > 0 ||
            (subscriber?.stripe_modal_views || 0) > 0

          eventSequenceRows.push({
            distinct_id: distinctId,
            event_sequence: events, // Store as JSONB
            total_copies: subscriber?.total_copies || 0,
            total_subscriptions: hasSubscribed ? 1 : 0,
            synced_at: syncStartTime.toISOString()
          })
        }
      }

      console.log(`Processed ${eventSequenceRows.length} event sequences`)
      stats.eventSequencesFetched = eventSequenceRows.length

      // Upsert in batches
      const batchSize = 500
      let totalInserted = 0

      for (let i = 0; i < eventSequenceRows.length; i += batchSize) {
        const batch = eventSequenceRows.slice(i, i + batchSize)
        const { error: insertError } = await supabase
          .from('user_event_sequences')
          .upsert(batch, {
            onConflict: 'distinct_id',
            ignoreDuplicates: false
          })

        if (insertError) {
          console.error('Error upserting event sequences batch:', insertError)
          throw insertError
        }

        totalInserted += batch.length
        console.log(`Upserted batch: ${totalInserted}/${eventSequenceRows.length} records`)
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

      console.log('Event sequences sync completed successfully')

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Event sequences sync completed successfully',
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
    console.error('Error in sync-event-sequences function:', error)

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
