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
  totalUsers: number
  eventsProcessed: number
  pdpEventsEnriched: number
  creatorProfileEventsEnriched: number
  usersUpdated: number
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
      totalUsers: 0,
      eventsProcessed: 0,
      pdpEventsEnriched: 0,
      creatorProfileEventsEnriched: 0,
      usersUpdated: 0,
    }

    // Fetch property data from Mixpanel
    console.log('Fetching property data from Mixpanel...')
    const [pdpEvents, creatorProfileEvents] = await Promise.all([
      fetchPDPViewEventsWithProperties(credentials),
      fetchCreatorProfileViewEventsWithProperties(credentials),
    ])

    console.log(`✓ Fetched ${pdpEvents.length} PDP events and ${creatorProfileEvents.length} creator profile events`)

    // Build lookup maps for efficient matching
    // Key format: "distinct_id|event|timestamp"
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

    console.log('Fetching event sequences from database...')
    const { data: rawSequences, error: fetchError } = await supabase
      .from('event_sequences_raw')
      .select('distinct_id, event_data')

    if (fetchError) {
      console.error('Failed to fetch event sequences:', fetchError)
      throw fetchError
    }

    stats.totalUsers = rawSequences?.length || 0
    console.log(`Processing ${stats.totalUsers} user event sequences...`)

    // Enrich event sequences
    const enrichedSequences: Array<{ distinct_id: string; event_data: any[] }> = []

    for (const rawSeq of rawSequences || []) {
      const events = rawSeq.event_data || []
      let userEnriched = false

      const enrichedEvents = events.map((event: any) => {
        stats.eventsProcessed++

        const eventName = event.event
        const timestamp = event.time
        const key = `${rawSeq.distinct_id}|${eventName}|${timestamp}`

        // Check if this is a PDP view event
        if (eventName === 'Viewed Premium PDP' || eventName === 'Viewed Regular PDP') {
          const properties = pdpLookup.get(key)
          if (properties) {
            stats.pdpEventsEnriched++
            userEnriched = true
            return {
              ...event,
              portfolioTicker: properties.portfolioTicker,
              creatorUsername: properties.creatorUsername,
            }
          }
        }

        // Check if this is a Creator Profile view event
        if (eventName === 'Viewed Premium Creator Profile' || eventName === 'Viewed Regular Creator Profile') {
          const properties = creatorProfileLookup.get(key)
          if (properties) {
            stats.creatorProfileEventsEnriched++
            userEnriched = true
            return {
              ...event,
              creatorUsername: properties.creatorUsername,
            }
          }
        }

        return event
      })

      if (userEnriched) {
        stats.usersUpdated++
        enrichedSequences.push({
          distinct_id: rawSeq.distinct_id,
          event_data: enrichedEvents,
        })
      }

      // Log progress every 1000 users
      if (stats.eventsProcessed % 10000 === 0) {
        console.log(`Processed ${stats.eventsProcessed} events...`)
      }
    }

    console.log(`✓ Enriched ${enrichedSequences.length} user sequences`)

    // Update database in batches
    if (enrichedSequences.length > 0) {
      console.log('Updating enriched sequences in database...')
      const batchSize = 500
      let totalUpdated = 0

      for (let i = 0; i < enrichedSequences.length; i += batchSize) {
        const batch = enrichedSequences.slice(i, i + batchSize)

        const { error: updateError } = await supabase
          .from('event_sequences_raw')
          .upsert(batch, {
            onConflict: 'distinct_id',
            ignoreDuplicates: false,
          })

        if (updateError) {
          console.error('Error updating enriched sequences batch:', updateError)
          throw updateError
        }

        totalUpdated += batch.length
        console.log(`Updated batch: ${totalUpdated}/${enrichedSequences.length} sequences`)
      }

      console.log(`✓ Updated ${totalUpdated} enriched sequences`)
    } else {
      console.log('No sequences needed enrichment')
    }

    console.log('Event sequence enrichment completed successfully')

    return createSuccessResponse(
      'Event sequence enrichment completed successfully',
      stats
    )
  } catch (error) {
    console.error('Error in enrich-event-sequences function:', error)
    return createErrorResponse(error, 'enrich-event-sequences')
  }
})
