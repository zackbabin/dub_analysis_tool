// Supabase Edge Function: enrich-event-sequences
// Enriches event sequences with properties from Mixpanel charts 85312972 and 85312975
// Adds portfolioTicker and creatorUsername to PDP views and creator profile views
// Should be run after sync-event-sequences and before process-event-sequences

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  initializeMixpanelCredentials,
  handleCorsRequest,
  createSuccessResponse,
  createErrorResponse,
} from '../_shared/sync-helpers.ts'
import {
  fetchPDPViewEventsWithProperties,
  fetchCreatorProfileViewEventsWithProperties,
  CORS_HEADERS
} from '../_shared/mixpanel-api.ts'

interface EnrichmentStats {
  totalEvents: number
  eventsProcessed: number
  pdpEventsEnriched: number
  creatorProfileEventsEnriched: number
  eventsUpdated: number
}

serve(async (req) => {
  // Handle CORS preflight requests
  const corsResponse = handleCorsRequest(req)
  if (corsResponse) return corsResponse

  try {
    console.log('Starting event sequence enrichment...')

    // Initialize Mixpanel credentials and Supabase client
    const credentials = initializeMixpanelCredentials()
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const stats: EnrichmentStats = {
      totalEvents: 0,
      eventsProcessed: 0,
      pdpEventsEnriched: 0,
      creatorProfileEventsEnriched: 0,
      eventsUpdated: 0,
    }

    // Fetch property data from Mixpanel
    console.log('Fetching property data from Mixpanel...')
    const [pdpEvents, creatorProfileEvents] = await Promise.all([
      fetchPDPViewEventsWithProperties(credentials),
      fetchCreatorProfileViewEventsWithProperties(credentials),
    ])

    console.log(`✓ Fetched ${pdpEvents.length} PDP events and ${creatorProfileEvents.length} creator profile events`)

    // Debug: Show sample Mixpanel event
    if (pdpEvents.length > 0) {
      const sample = pdpEvents[0]
      console.log(`[DEBUG] Sample Mixpanel PDP event:`, {
        distinct_id: sample.distinct_id,
        event: sample.event,
        time: sample.time,
        key: `${sample.distinct_id}|${sample.event}|${sample.time}`
      })
    }

    // Build lookup maps for efficient matching
    // Key format: "distinct_id|event|timestamp"
    // IMPORTANT: Both Mixpanel and database use ISO timestamp strings
    const pdpLookup = new Map<string, { portfolioTicker?: string; creatorUsername?: string }>()
    for (const event of pdpEvents) {
      const key = `${event.distinct_id}|${event.event}|${event.time}`
      pdpLookup.set(key, {
        portfolioTicker: event.portfolioTicker,
        creatorUsername: event.creatorUsername,
      })
    }

    const creatorProfileLookup = new Map<string, { creatorUsername?: string }>()
    for (const event of creatorProfileEvents) {
      const key = `${event.distinct_id}|${event.event}|${event.time}`
      creatorProfileLookup.set(key, {
        creatorUsername: event.creatorUsername,
      })
    }

    console.log('Fetching individual events from database...')
    // Fetch the 4 event types that need enrichment (PDP views and Creator Profile views)
    // Enrich ALL events of these types, regardless of current enrichment status
    // IMPORTANT: Limit to 2000 events per run to reduce disk IO and avoid timeout
    // Subsequent runs will process remaining events
    const MAX_EVENTS_PER_RUN = 2000

    const { data: rawEvents, error: fetchError } = await supabase
      .from('event_sequences_raw')
      .select('id, distinct_id, event_name, event_time, portfolio_ticker, creator_username')
      .in('event_name', [
        'Viewed Premium PDP',
        'Viewed Regular PDP',
        'Viewed Premium Creator Profile',
        'Viewed Regular Creator Profile'
      ])
      .order('event_time', { ascending: false }) // Process newest events first
      .limit(MAX_EVENTS_PER_RUN)

    // Debug: Show sample database event
    if (rawEvents && rawEvents.length > 0) {
      const sample = rawEvents[0]
      console.log(`[DEBUG] Sample database event:`, {
        distinct_id: sample.distinct_id,
        event_name: sample.event_name,
        event_time: sample.event_time,
        key: `${sample.distinct_id}|${sample.event_name}|${sample.event_time}`
      })
    }

    if (fetchError) {
      console.error('Failed to fetch event sequences:', fetchError)
      throw fetchError
    }

    stats.totalEvents = rawEvents?.length || 0
    console.log(`Processing ${stats.totalEvents} individual events for enrichment (max ${MAX_EVENTS_PER_RUN} per run)...`)

    if (stats.totalEvents === MAX_EVENTS_PER_RUN) {
      console.log(`⚠️ Reached max events limit (${MAX_EVENTS_PER_RUN}) - more events may exist. Will process remaining on next run.`)
    }

    // Enrich individual events
    const updatesToApply: Array<{
      id: number
      portfolio_ticker?: string | null
      creator_username?: string | null
    }> = []

    let debugLogCount = 0
    for (const event of rawEvents || []) {
      stats.eventsProcessed++

      const eventName = event.event_name
      const timestamp = event.event_time
      const key = `${event.distinct_id}|${eventName}|${timestamp}`

      let needsUpdate = false
      const updates: { portfolio_ticker?: string | null; creator_username?: string | null } = {}

      // Check if this is a PDP view event - enrich with portfolioTicker AND creatorUsername
      if (eventName === 'Viewed Premium PDP' || eventName === 'Viewed Regular PDP') {
        const properties = pdpLookup.get(key)
        if (properties) {
          if (properties.portfolioTicker) updates.portfolio_ticker = properties.portfolioTicker
          if (properties.creatorUsername) updates.creator_username = properties.creatorUsername
          needsUpdate = true
          stats.pdpEventsEnriched++
        } else if (debugLogCount < 3) {
          console.log(`[DEBUG] No match for PDP key: ${key}`)
          debugLogCount++
        }
      }

      // Check if this is a Creator Profile view event - enrich with creatorUsername only
      if (eventName === 'Viewed Premium Creator Profile' || eventName === 'Viewed Regular Creator Profile') {
        const properties = creatorProfileLookup.get(key)
        if (properties?.creatorUsername) {
          updates.creator_username = properties.creatorUsername
          needsUpdate = true
          stats.creatorProfileEventsEnriched++
        } else if (debugLogCount < 3) {
          console.log(`[DEBUG] No match for Creator Profile key: ${key}`)
          debugLogCount++
        }
      }

      if (needsUpdate) {
        updatesToApply.push({
          id: event.id,
          ...updates
        })
      }

      // Log progress every 10000 events
      if (stats.eventsProcessed % 10000 === 0) {
        console.log(`Processed ${stats.eventsProcessed} events...`)
      }
    }

    console.log(`✓ Found ${updatesToApply.length} events to enrich`)

    // Update database in batches with timeout protection
    let timedOut = false // Declare outside if block so it's accessible in response
    if (updatesToApply.length > 0) {
      console.log('Updating enriched events in database...')
      const startTime = Date.now()
      const TIMEOUT_MS = 120000 // 120s timeout (leave 30s buffer before Edge Function 150s limit)
      const batchSize = 50 // Reduced from 100 to lower disk IO per batch
      let totalUpdated = 0

      for (let i = 0; i < updatesToApply.length; i += batchSize) {
        // Check timeout every batch
        if (Date.now() - startTime > TIMEOUT_MS) {
          console.warn(`⚠️ Timeout approaching after ${totalUpdated} updates. Stopping early - remaining events will be processed on next run.`)
          timedOut = true
          break
        }

        const batch = updatesToApply.slice(i, i + batchSize)

        // Update each event individually (Supabase doesn't support batch updates with different values per row)
        // Use smaller concurrent batches to reduce disk IO pressure
        const updatePromises = batch.map(update =>
          supabase
            .from('event_sequences_raw')
            .update({
              portfolio_ticker: update.portfolio_ticker,
              creator_username: update.creator_username
            })
            .eq('id', update.id)
        )

        const results = await Promise.all(updatePromises)

        // Check for errors
        const errors = results.filter(r => r.error)
        if (errors.length > 0) {
          console.error(`Error updating ${errors.length} events:`, errors[0].error)
          throw errors[0].error
        }

        totalUpdated += batch.length

        if (i % 1000 === 0 || i + batchSize >= updatesToApply.length) {
          console.log(`Updated ${totalUpdated}/${updatesToApply.length} events`)
        }
      }

      stats.eventsUpdated = totalUpdated

      if (timedOut) {
        console.log(`⚠️ Enrichment incomplete: Updated ${totalUpdated} events before timeout. ${updatesToApply.length - totalUpdated} remaining.`)
      } else {
        console.log(`✓ Updated ${totalUpdated} enriched events`)
      }
    } else {
      console.log('No events needed enrichment')
    }

    console.log('Event sequence enrichment completed successfully')

    return createSuccessResponse(
      'Event sequence enrichment completed successfully',
      {
        ...stats,
        has_more: stats.totalEvents === MAX_EVENTS_PER_RUN || timedOut,
        remaining_estimate: stats.totalEvents === MAX_EVENTS_PER_RUN ? 'Unknown (limit reached)' : '0'
      }
    )
  } catch (error) {
    console.error('Error in enrich-event-sequences function:', error)
    return createErrorResponse(error, 'enrich-event-sequences')
  }
})
