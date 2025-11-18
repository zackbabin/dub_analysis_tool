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

      // Fetch raw event sequences
      console.log('Fetching raw event sequences from event_sequences_raw...')
      const { data: rawSequences, error: rawError } = await supabase
        .from('event_sequences_raw')
        .select('*')
        .order('synced_at', { ascending: false })
        .limit(10000) // Process in chunks if needed

      if (rawError) {
        console.error('Failed to fetch raw sequences:', rawError)
        throw rawError
      }

      stats.rawRecordsFetched = rawSequences?.length || 0
      console.log(`✓ Fetched ${stats.rawRecordsFetched} raw event sequences`)

      if (!rawSequences || rawSequences.length === 0) {
        console.warn('No raw event sequences found. Run sync-event-sequences first.')

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
            message: 'No raw event sequences to process',
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

      // Process event sequences
      console.log('Processing event sequences...')
      const eventSequenceRows: any[] = []

      for (const raw of rawSequences) {
        const subscriber = subscriberMap.get(raw.distinct_id)

        // Parse event_data JSONB field
        const events = raw.event_data || []

        // Sort events by timestamp
        events.sort((a: any, b: any) =>
          new Date(a.time).getTime() - new Date(b.time).getTime()
        )

        // Determine if user has subscribed
        const hasSubscribed =
          (subscriber?.paywall_views || 0) > 0 ||
          (subscriber?.stripe_modal_views || 0) > 0

        eventSequenceRows.push({
          distinct_id: raw.distinct_id,
          event_sequence: events,
          total_copies: subscriber?.total_copies || 0,
          total_subscriptions: hasSubscribed ? 1 : 0,
          synced_at: raw.synced_at || syncStartTime.toISOString()
        })

        stats.eventSequencesProcessed++

        // Log progress every 1000 records
        if (stats.eventSequencesProcessed % 1000 === 0) {
          console.log(`Processed ${stats.eventSequencesProcessed}/${stats.rawRecordsFetched} sequences...`)
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
