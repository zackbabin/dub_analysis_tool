// Supabase Edge Function: sync-event-sequences-v2
// Fetches user event sequences from Mixpanel Export API
// Stores raw events with all properties (portfolioTicker, creatorUsername, creatorType) directly
// No enrichment step needed - all data comes from Export API
// Triggered manually alongside other sync functions

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import {
  initializeMixpanelCredentials,
  initializeSupabaseClient,
  handleCorsRequest,
  checkAndHandleSkipSync,
  createSyncLog,
  updateSyncLogSuccess,
  updateSyncLogFailure,
  handleRateLimitError,
  createSuccessResponse,
  createErrorResponse,
} from '../_shared/sync-helpers.ts'

interface MixpanelExportEvent {
  event: string
  properties: {
    time: number
    distinct_id: string
    $insert_id: string
    $email?: string
    portfolioTicker?: string
    creatorUsername?: string
    creatorType?: string
    [key: string]: any
  }
}

interface SyncStats {
  eventsFetched: number
  eventsInserted: number
  duplicatesSkipped: number
}

/**
 * Fetch events from Mixpanel Export API
 * https://developer.mixpanel.com/reference/raw-event-export
 */
async function fetchEventsFromExportAPI(
  credentials: { projectId: string; serviceAccountUsername: string; serviceAccountSecret: string },
  fromDate: string,
  toDate: string,
  eventNames: string[]
): Promise<MixpanelExportEvent[]> {
  const { projectId, serviceAccountUsername, serviceAccountSecret } = credentials

  // Build where clause to filter by email existence
  const whereClause = encodeURIComponent('(properties["$email"])')

  // Build event parameter as a single JSON array (per Mixpanel API docs)
  // The API expects: event=["event1","event2","event3"]
  const eventParam = `event=${encodeURIComponent(JSON.stringify(eventNames))}`

  const url = `https://data.mixpanel.com/api/2.0/export?project_id=${projectId}&from_date=${fromDate}&to_date=${toDate}&${eventParam}&where=${whereClause}`

  console.log(`Fetching from Export API: ${fromDate} to ${toDate}`)
  console.log(`Events: ${eventNames.length} event types`)

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Authorization': `Basic ${btoa(`${serviceAccountUsername}:${serviceAccountSecret}`)}`,
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`Mixpanel Export API error (${response.status}):`, errorText)

    if (response.status === 429) {
      throw new Error('RATE_LIMIT_EXCEEDED: Mixpanel API rate limit reached')
    }

    throw new Error(`Mixpanel Export API failed: ${response.status} - ${errorText}`)
  }

  // Parse JSONL response (newline-delimited JSON)
  const text = await response.text()
  const lines = text.trim().split('\n').filter(line => line.trim())

  const events: MixpanelExportEvent[] = []
  for (const line of lines) {
    try {
      const event = JSON.parse(line)
      events.push(event)
    } catch (parseError) {
      console.warn('Failed to parse JSONL line:', line.substring(0, 100))
    }
  }

  console.log(`✓ Fetched ${events.length} events from Export API`)
  return events
}

serve(async (req) => {
  // Handle CORS preflight requests
  const corsResponse = handleCorsRequest(req)
  if (corsResponse) return corsResponse

  try {
    // Initialize Mixpanel credentials and Supabase client
    const credentials = initializeMixpanelCredentials()
    const supabase = initializeSupabaseClient()

    console.log('Starting event sequences sync v2 (Export API)...')

    // Check if sync should be skipped (within 1-hour window for event sequences)
    const skipResponse = await checkAndHandleSkipSync(supabase, 'mixpanel_event_sequences_v2', 1)
    if (skipResponse) return skipResponse

    // Create sync log entry
    const { syncLog, syncStartTime } = await createSyncLog(supabase, 'user', 'mixpanel_event_sequences_v2')
    const syncLogId = syncLog.id

    try {
      // Calculate date range (last 30 days)
      const now = new Date()
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      const fromDate = thirtyDaysAgo.toISOString().split('T')[0] // YYYY-MM-DD
      const toDate = now.toISOString().split('T')[0] // YYYY-MM-DD

      // Event names to fetch from Mixpanel Export API
      const eventNames = [
        'Viewed Creator Profile',        // Has creatorType property
        'Viewed Portfolio Details',      // Has creatorType property
        'Started Copy Portfolio',         // Has creatorType property
        'Viewed Leaderboard Tab',
        'Viewed Premium Tab',
        'Viewed Discover Tab',
        'Added Portfolio To Watchlist',
        'Tapped Portfolio Card',
        'Tapped Creator Card',
        'AchTransferInitiated',
        'StrategyCreated',
        'Viewed Stripe Modal',
        'Viewed Creator Paywall'
      ]

      // Map Export API event names to our internal event names
      // Some events need to be split into Premium/Regular variants based on creatorType
      const mapEventName = (exportEventName: string, creatorType?: string): string => {
        // Events that need Premium/Regular split
        if (exportEventName === 'Viewed Portfolio Details') {
          return creatorType === 'premiumCreator' ? 'Viewed Premium PDP' : 'Viewed Regular PDP'
        }
        if (exportEventName === 'Viewed Creator Profile') {
          return creatorType === 'premiumCreator' ? 'Viewed Premium Creator Profile' : 'Viewed Regular Creator Profile'
        }
        if (exportEventName === 'Started Copy Portfolio') {
          // Keep as "Started Copy Portfolio" but store creator_type separately
          // The subscribers_insights aggregation will split into premium_copies and regular_copies
          return 'Started Copy Portfolio'
        }

        // All other events map directly
        return exportEventName
      }

      console.log(`Fetching events from ${fromDate} to ${toDate}...`)

      let events: MixpanelExportEvent[] = []

      try {
        events = await fetchEventsFromExportAPI(credentials, fromDate, toDate, eventNames)
      } catch (error: any) {
        // Handle Mixpanel rate limit errors gracefully
        const rateLimitResponse = await handleRateLimitError(supabase, syncLogId, error, {
          eventsFetched: 0,
          eventsInserted: 0,
          duplicatesSkipped: 0,
        })
        if (rateLimitResponse) return rateLimitResponse
        throw error
      }

      const stats: SyncStats = {
        eventsFetched: events.length,
        eventsInserted: 0,
        duplicatesSkipped: 0,
      }

      if (events.length === 0) {
        console.log('No events to process - sync complete')

        await updateSyncLogSuccess(supabase, syncLogId, {
          total_records_inserted: 0,
        })

        return createSuccessResponse(
          'Event sequences sync v2 completed - no events to process',
          stats
        )
      }

      console.log('Processing events for storage...')

      // Transform Mixpanel events to database format
      const rawEventRows = events.map((event) => {
        // Convert Unix timestamp (seconds) to ISO string
        const eventTime = new Date(event.properties.time * 1000).toISOString()

        // Map Export API event name to internal event name
        const exportEventName = event.event
        const creatorType = event.properties.creatorType
        const internalEventName = mapEventName(exportEventName, creatorType)

        return {
          distinct_id: event.properties.distinct_id,
          event_name: internalEventName, // Use mapped internal event name
          event_time: eventTime,
          event_count: 1, // Each Export API event is a single occurrence
          portfolio_ticker: event.properties.portfolioTicker || null,
          creator_username: event.properties.creatorUsername || null,
          creator_type: creatorType || null, // Store creatorType for premium/regular distinction
          event_data: {
            event_name: exportEventName, // Store original Export API event name
            event_time: eventTime,
            event_count: 1,
            portfolioTicker: event.properties.portfolioTicker,
            creatorUsername: event.properties.creatorUsername,
            creatorType: event.properties.creatorType,
            email: event.properties.$email,
            insert_id: event.properties.$insert_id,
          },
          synced_at: syncStartTime.toISOString()
        }
      })

      console.log(`Prepared ${rawEventRows.length} event records for insertion`)

      // Insert events in batches (deduplication via unique index)
      const batchSize = 500
      let totalInserted = 0
      let totalDuplicatesSkipped = 0
      let skippedBatches = 0

      for (let i = 0; i < rawEventRows.length; i += batchSize) {
        const batch = rawEventRows.slice(i, i + batchSize)
        const batchNum = Math.floor(i / batchSize) + 1
        const totalBatches = Math.ceil(rawEventRows.length / batchSize)

        try {
          // Use INSERT with ignoreDuplicates=true to leverage unique index for deduplication
          // Unique index on (distinct_id, event_name, event_time) ensures no duplicate events
          const { data, error: insertError, count } = await supabase
            .from('event_sequences_raw')
            .insert(batch, {
              ignoreDuplicates: true,
              count: 'exact'
            })

          if (insertError) {
            // Handle statement timeout gracefully
            const errorCode = insertError.code || insertError.error_code || insertError.message
            console.log(`Batch ${batchNum}/${totalBatches} error: code=${errorCode}, message=${insertError.message}`)

            if (errorCode === '57014' || errorCode?.includes('57014') || insertError.message?.includes('statement timeout')) {
              console.warn(`⚠️ Statement timeout on batch ${batchNum}/${totalBatches} - skipping and continuing...`)
              skippedBatches++
              continue // Skip this batch but don't fail the whole sync
            }

            console.error('Error inserting event sequences batch:', insertError)
            throw insertError
          }

          // count returns number of rows actually inserted (excluding duplicates)
          const insertedInBatch = count ?? batch.length
          const duplicatesInBatch = batch.length - insertedInBatch

          totalInserted += insertedInBatch
          totalDuplicatesSkipped += duplicatesInBatch

          if (batchNum % 10 === 0 || batchNum === totalBatches) {
            console.log(`  ✓ Batch ${batchNum}/${totalBatches}: ${insertedInBatch} inserted, ${duplicatesInBatch} duplicates skipped (${totalInserted} total)`)
          }
        } catch (err) {
          // Catch any timeout or connection errors
          const errorCode = err?.code || err?.error_code || err?.message
          console.log(`Caught exception in batch ${batchNum}/${totalBatches}: code=${errorCode}, message=${err?.message}`)

          if (errorCode === '57014' || errorCode?.includes('57014') || err?.message?.includes('statement timeout')) {
            console.warn(`⚠️ Caught statement timeout exception on batch ${batchNum}/${totalBatches} - continuing...`)
            skippedBatches++
            continue // Skip this batch but don't fail
          }
          throw err
        }
      }

      if (skippedBatches > 0) {
        console.warn(`⚠️ Skipped ${skippedBatches} batch(es) due to timeouts`)
      }

      console.log(`✅ Inserted ${totalInserted} new events (${totalDuplicatesSkipped} duplicates skipped)`)
      stats.eventsInserted = totalInserted
      stats.duplicatesSkipped = totalDuplicatesSkipped

      // Update sync log with success
      await updateSyncLogSuccess(supabase, syncLogId, {
        total_records_inserted: stats.eventsInserted,
      })

      console.log('Event sequences sync v2 completed successfully')
      console.log('Call process-event-sequences to aggregate user-level sequences')

      return createSuccessResponse(
        'Event sequences sync v2 completed successfully - events stored with all properties',
        stats,
        {
          note: 'Events fetched from Export API with portfolioTicker and creatorUsername included. No enrichment needed.',
          nextSteps: 'Call process-event-sequences to aggregate user-level sequences'
        }
      )
    } catch (error) {
      // Update sync log with failure
      await updateSyncLogFailure(supabase, syncLogId, error)
      throw error
    }
  } catch (error) {
    return createErrorResponse(error, 'sync-event-sequences-v2')
  }
})
