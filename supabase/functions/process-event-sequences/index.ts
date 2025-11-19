// Supabase Edge Function: process-event-sequences
// Processes raw event sequences from event_sequences_raw table
// Joins with subscribers_insights to get conversion outcomes
// Stores processed data in user_event_sequences table
// Called after sync-event-sequences completes

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { CORS_HEADERS } from '../_shared/mixpanel-api.ts'

interface ProcessStats {
  rawRecordsFetched: number
  subscriberRecordsFetched: number
  eventSequencesProcessed: number
  totalRecordsUpserted: number
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    console.log('Starting event sequences processing...')

    // Initialize Supabase client with service role key
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Create sync log entry
    const syncStartTime = new Date()
    const { data: syncLog, error: syncLogError } = await supabase
      .from('sync_logs')
      .insert({
        tool_type: 'user',
        sync_started_at: syncStartTime.toISOString(),
        sync_status: 'in_progress',
        source: 'process_event_sequences',
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
      const stats: ProcessStats = {
        rawRecordsFetched: 0,
        subscriberRecordsFetched: 0,
        eventSequencesProcessed: 0,
        totalRecordsUpserted: 0,
      }

      // Fetch individual event rows from event_sequences_raw
      // IMPORTANT: Only fetch unprocessed events (processed_at IS NULL)
      // This ensures we don't keep reprocessing the same old events on every run
      console.log('Fetching unprocessed individual events from event_sequences_raw...')
      const { data: rawEvents, error: rawError } = await supabase
        .from('event_sequences_raw')
        .select('id, distinct_id, event_name, event_time, event_count, portfolio_ticker, creator_username, synced_at')
        .is('processed_at', null) // Only fetch unprocessed events
        .order('event_time', { ascending: true })
        .limit(100000) // Fetch up to 100k unprocessed events

      if (rawError) {
        console.error('Failed to fetch raw events:', rawError)
        throw rawError
      }

      stats.rawRecordsFetched = rawEvents?.length || 0
      console.log(`✓ Fetched ${stats.rawRecordsFetched} unprocessed event records`)

      if (stats.rawRecordsFetched === 100000) {
        console.log(`⚠️ Reached 100k event limit - more unprocessed events may exist. Will process remaining on next run.`)
      }

      if (!rawEvents || rawEvents.length === 0) {
        console.warn('No raw events found. Run sync-event-sequences first.')

        await supabase
          .from('sync_logs')
          .update({
            sync_completed_at: new Date().toISOString(),
            sync_status: 'completed',
            total_records_inserted: 0,
          })
          .eq('id', syncLogId)

        return new Response(
          JSON.stringify({
            success: true,
            message: 'No raw events to process',
            stats,
          }),
          {
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
            status: 200,
          }
        )
      }

      // Fetch subscribers_insights for conversion outcomes
      console.log('Fetching conversion outcomes from subscribers_insights...')
      const { data: subscribers, error: subscribersError } = await supabase
        .from('subscribers_insights')
        .select('distinct_id, total_copies, paywall_views, stripe_modal_views')

      if (subscribersError) {
        console.error('Failed to fetch subscribers:', subscribersError)
        throw subscribersError
      }

      stats.subscriberRecordsFetched = subscribers?.length || 0
      console.log(`✓ Fetched ${stats.subscriberRecordsFetched} subscriber records`)

      // Create lookup map for fast joining
      const subscriberMap = new Map(
        (subscribers || []).map(s => [s.distinct_id, s])
      )

      // Group individual events by user and track event IDs for marking as processed
      console.log('Grouping events by user...')
      const userEventsMap = new Map<string, Array<{
        event: string
        time: string
        count: number
        portfolioTicker?: string
        creatorUsername?: string
      }>>()
      const processedEventIds: number[] = []

      for (const event of rawEvents) {
        let userEvents = userEventsMap.get(event.distinct_id)
        if (!userEvents) {
          userEvents = []
          userEventsMap.set(event.distinct_id, userEvents)
        }

        userEvents.push({
          event: event.event_name,
          time: event.event_time,
          count: event.event_count || 1,
          ...(event.portfolio_ticker && { portfolioTicker: event.portfolio_ticker }),
          ...(event.creator_username && { creatorUsername: event.creator_username })
        })

        // Track event ID for marking as processed
        processedEventIds.push(event.id)
      }

      console.log(`✓ Grouped events into ${userEventsMap.size} user sequences`)

      // Process event sequences
      console.log('Building user event sequences...')
      const eventSequenceRows: any[] = []

      for (const [distinctId, events] of userEventsMap.entries()) {
        const subscriber = subscriberMap.get(distinctId)

        // Events are already sorted by event_time from query
        // No need to sort again

        // Determine if user has subscribed
        const hasSubscribed =
          (subscriber?.paywall_views || 0) > 0 ||
          (subscriber?.stripe_modal_views || 0) > 0

        eventSequenceRows.push({
          distinct_id: distinctId,
          event_sequence: events,
          total_copies: subscriber?.total_copies || 0,
          total_subscriptions: hasSubscribed ? 1 : 0,
          synced_at: syncStartTime.toISOString()
        })

        stats.eventSequencesProcessed++

        // Log progress every 1000 records
        if (stats.eventSequencesProcessed % 1000 === 0) {
          console.log(`Processed ${stats.eventSequencesProcessed}/${userEventsMap.size} sequences...`)
        }
      }

      console.log(`✓ Processed ${eventSequenceRows.length} event sequences`)

      // Upsert in batches
      console.log('Upserting to user_event_sequences...')
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

      stats.totalRecordsUpserted = totalInserted

      // Mark all processed events as processed in event_sequences_raw
      // This prevents reprocessing the same events on future runs
      if (processedEventIds.length > 0) {
        console.log(`Marking ${processedEventIds.length} events as processed...`)
        const processedAt = new Date().toISOString()
        const markBatchSize = 1000

        for (let i = 0; i < processedEventIds.length; i += markBatchSize) {
          const idBatch = processedEventIds.slice(i, i + markBatchSize)
          const { error: markError } = await supabase
            .from('event_sequences_raw')
            .update({ processed_at: processedAt })
            .in('id', idBatch)

          if (markError) {
            console.error('Error marking events as processed:', markError)
            // Don't throw - this is not critical, events will just be reprocessed next time
          }
        }

        console.log(`✓ Marked ${processedEventIds.length} events as processed`)
      }

      // Update sync log with success
      const syncEndTime = new Date()
      await supabase
        .from('sync_logs')
        .update({
          sync_completed_at: syncEndTime.toISOString(),
          sync_status: 'completed',
          total_records_inserted: stats.totalRecordsUpserted,
        })
        .eq('id', syncLogId)

      console.log('Event sequences processing completed successfully')

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Event sequences processing completed successfully',
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
    console.error('Error in process-event-sequences function:', error)

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
