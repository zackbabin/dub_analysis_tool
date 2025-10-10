// Supabase Edge Function: sync-event-sequences
// Fetches user event sequences from Mixpanel Insights API (Chart ID: 85247935)
// Stores raw data in event_sequences_raw table for later processing
// Processing happens in separate process-event-sequences function
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
  totalRawRecordsInserted: number
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

      // Process event sequences data (store raw, no joining yet)
      const stats: SyncStats = {
        eventSequencesFetched: 0,
        totalRawRecordsInserted: 0,
        chartId,
      }

      if (!eventSequencesData?.series) {
        console.warn('No event sequence data returned from Mixpanel')
        throw new Error('No event sequence data available')
      }

      console.log('Processing event sequences...')

      // Parse Mixpanel Insights response structure:
      // series: { "metric_key": { "distinct_id": { "timestamp": { "all": count }, "$overall": {...} } } }

      // Build user event sequences from nested structure
      const userEventsMap = new Map<string, Array<{event: string, time: string, count: number}>>()

      for (const [metricKey, metricData] of Object.entries(eventSequencesData.series)) {
        if (typeof metricData !== 'object' || metricData === null) continue

        // Clean up metric name (remove prefix like "A. ", "B. ", etc.)
        const eventName = metricKey.replace(/^[A-Z]\.\s*/, '').replace(/^Total\s+/, '')

        for (const [distinctId, userData] of Object.entries(metricData as Record<string, any>)) {
          // Skip $overall aggregates and focus on actual distinct_ids
          if (distinctId === '$overall') continue

          // Get or create event array for this user
          if (!userEventsMap.has(distinctId)) {
            userEventsMap.set(distinctId, [])
          }
          const userEvents = userEventsMap.get(distinctId)!

          // Extract individual event occurrences with timestamps
          for (const [timestamp, data] of Object.entries(userData)) {
            // Skip $overall for this user
            if (timestamp === '$overall') continue

            const count = (data as any)?.all || 0
            if (count > 0) {
              userEvents.push({
                event: eventName,
                time: timestamp,
                count: count
              })
            }
          }
        }
      }

      console.log(`Found ${userEventsMap.size} users with event sequences`)

      // Convert to raw rows for database insertion (no processing yet)
      const rawEventRows: any[] = []

      for (const [distinctId, events] of userEventsMap.entries()) {
        // Sort events by timestamp
        events.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())

        rawEventRows.push({
          distinct_id: distinctId,
          event_data: events, // Store raw events as JSONB
          synced_at: syncStartTime.toISOString()
        })
      }

      console.log(`Prepared ${rawEventRows.length} raw event sequences`)
      stats.eventSequencesFetched = rawEventRows.length

      // Upsert raw data in batches to event_sequences_raw table
      const batchSize = 1000 // Larger batches since no processing
      let totalInserted = 0

      for (let i = 0; i < rawEventRows.length; i += batchSize) {
        const batch = rawEventRows.slice(i, i + batchSize)
        const { error: insertError } = await supabase
          .from('event_sequences_raw')
          .upsert(batch, {
            onConflict: 'distinct_id',
            ignoreDuplicates: false
          })

        if (insertError) {
          console.error('Error upserting raw event sequences batch:', insertError)
          throw insertError
        }

        totalInserted += batch.length
        console.log(`Upserted batch: ${totalInserted}/${rawEventRows.length} raw records`)
      }

      stats.totalRawRecordsInserted = totalInserted

      // Update sync log with success
      const syncEndTime = new Date()
      await supabase
        .from('sync_logs')
        .update({
          sync_completed_at: syncEndTime.toISOString(),
          sync_status: 'completed',
          total_records_inserted: stats.totalRawRecordsInserted,
        })
        .eq('id', syncLogId)

      console.log('Event sequences sync completed successfully (raw data stored)')
      console.log('Call process-event-sequences to complete processing')

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Event sequences sync completed successfully - raw data stored',
          note: 'Call process-event-sequences function to complete processing',
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
