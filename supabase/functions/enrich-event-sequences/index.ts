// Supabase Edge Function: enrich-event-sequences
// Enriches raw event sequences with portfolio and creator context
// Fetches property data from Mixpanel and updates event_sequences_raw table
// Runs separately after sync-event-sequences to avoid timeout

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4'
import {
  CORS_HEADERS,
  type MixpanelCredentials,
  fetchInsightsData,
} from '../_shared/mixpanel-api.ts'

interface EventProperties {
  portfolioTicker?: string
  creatorUsername?: string
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

    console.log('Starting event sequence enrichment...')

    const credentials: MixpanelCredentials = {
      username: mixpanelUsername,
      secret: mixpanelSecret,
    }

    // Fetch event properties for enrichment
    console.log('Fetching event properties from Mixpanel...')
    const pdpPropertiesData = await fetchInsightsData(credentials, '85312972', 'PDP Properties')
    const profilePropertiesData = await fetchInsightsData(credentials, '85312975', 'Profile Properties')
    console.log('✓ Event properties fetched successfully')

    // Build property lookup maps
    console.log('Building property lookup maps...')
    const pdpPropertyMap = new Map<string, EventProperties>()
    const profilePropertyMap = new Map<string, EventProperties>()

    // Parse PDP properties - OPTIMIZED with early breaks
    if (pdpPropertiesData?.series) {
      const startTime = Date.now()

      for (const [metricKey, metricData] of Object.entries(pdpPropertiesData.series)) {
        if (typeof metricData !== 'object' || metricData === null) continue

        const eventName = metricKey.replace(/^[A-Z]\.\s*/, '').replace(/^Total\s+/, '')

        for (const [distinctId, distinctData] of Object.entries(metricData as Record<string, any>)) {
          if (distinctId === '$overall') continue

          for (const [timestamp, timeData] of Object.entries(distinctData)) {
            if (timestamp === '$overall') continue

            const key = `${distinctId}|${eventName}|${timestamp}`
            if (pdpPropertyMap.has(key)) continue

            // Only take first valid entry
            let found = false
            for (const [ticker, tickerData] of Object.entries(timeData as Record<string, any>)) {
              if (ticker === '$overall' || found) continue

              for (const [creatorId, creatorData] of Object.entries(tickerData as Record<string, any>)) {
                if (creatorId === '$overall' || found) continue

                for (const [username] of Object.entries(creatorData as Record<string, any>)) {
                  if (username === 'all' || found) continue

                  pdpPropertyMap.set(key, {
                    portfolioTicker: ticker,
                    creatorUsername: username
                  })
                  found = true
                  break
                }
                if (found) break
              }
              if (found) break
            }
          }
        }
      }

      const pdpParseTime = ((Date.now() - startTime) / 1000).toFixed(1)
      console.log(`✓ Parsed ${pdpPropertyMap.size} PDP properties in ${pdpParseTime}s`)
    }

    // Parse Profile properties - OPTIMIZED with early breaks
    if (profilePropertiesData?.series) {
      const startTime = Date.now()

      for (const [metricKey, metricData] of Object.entries(profilePropertiesData.series)) {
        if (typeof metricData !== 'object' || metricData === null) continue

        const eventName = metricKey.replace(/^[A-Z]\.\s*/, '').replace(/^Total\s+/, '')

        for (const [distinctId, distinctData] of Object.entries(metricData as Record<string, any>)) {
          if (distinctId === '$overall') continue

          for (const [timestamp, timeData] of Object.entries(distinctData)) {
            if (timestamp === '$overall') continue

            const key = `${distinctId}|${eventName}|${timestamp}`
            if (profilePropertyMap.has(key)) continue

            // Only take first valid entry
            let found = false
            for (const [creatorId, creatorData] of Object.entries(timeData as Record<string, any>)) {
              if (creatorId === '$overall' || found) continue

              for (const [username] of Object.entries(creatorData as Record<string, any>)) {
                if (username === 'all' || found) continue

                profilePropertyMap.set(key, {
                  creatorUsername: username
                })
                found = true
                break
              }
              if (found) break
            }
          }
        }
      }

      const profileParseTime = ((Date.now() - startTime) / 1000).toFixed(1)
      console.log(`✓ Parsed ${profilePropertyMap.size} profile properties in ${profileParseTime}s`)
    }

    console.log(`✓ Built property maps: ${pdpPropertyMap.size} PDP properties, ${profilePropertyMap.size} profile properties`)

    // Enrich event function
    function enrichEventName(event: string, timestamp: string, distinctId: string): string {
      const key = `${distinctId}|${event}|${timestamp}`

      // Check if event is a PDP view
      if (event.includes('PDP')) {
        const props = pdpPropertyMap.get(key)
        if (props?.portfolioTicker && props?.creatorUsername) {
          return `${event} (${props.portfolioTicker} by ${props.creatorUsername})`
        }
      }

      // Check if event is a Creator Profile view
      if (event.includes('Creator Profile')) {
        const props = profilePropertyMap.get(key)
        if (props?.creatorUsername) {
          return `${event} (${props.creatorUsername})`
        }
      }

      return event
    }

    // Load and enrich event sequences from database
    console.log('Loading raw event sequences from database...')
    const { data: rawSequences, error: loadError } = await supabase
      .from('event_sequences_raw')
      .select('*')

    if (loadError) {
      console.error('Error loading raw sequences:', loadError)
      throw loadError
    }

    console.log(`Loaded ${rawSequences.length} raw event sequences`)

    // Enrich sequences
    console.log('Enriching event sequences...')
    const enrichStartTime = Date.now()
    let totalEventsEnriched = 0
    let eventsWithProperties = 0
    const batchSize = 500

    for (let i = 0; i < rawSequences.length; i += batchSize) {
      const batch = rawSequences.slice(i, i + batchSize)
      const updates = []

      for (const row of batch) {
        const events = row.event_data || []
        const enrichedEvents = events.map((evt: any) => {
          const originalEvent = evt.event
          const enrichedEvent = enrichEventName(evt.event, evt.time, row.distinct_id)

          totalEventsEnriched++
          if (enrichedEvent !== originalEvent) {
            eventsWithProperties++
          }

          return {
            event: enrichedEvent,
            time: evt.time,
            count: evt.count
          }
        })

        updates.push({
          distinct_id: row.distinct_id,
          event_data: enrichedEvents
        })
      }

      // Update batch
      for (const update of updates) {
        const { error: updateError } = await supabase
          .from('event_sequences_raw')
          .update({ event_data: update.event_data })
          .eq('distinct_id', update.distinct_id)

        if (updateError) {
          console.error('Error updating enriched events:', updateError)
          throw updateError
        }
      }

      console.log(`Enriched batch: ${i + batch.length}/${rawSequences.length} sequences`)
    }

    const enrichTime = ((Date.now() - enrichStartTime) / 1000).toFixed(1)
    const enrichmentRate = totalEventsEnriched > 0 ? ((eventsWithProperties / totalEventsEnriched) * 100).toFixed(1) : '0'
    console.log(`✓ Enriched ${totalEventsEnriched} events in ${enrichTime}s (${eventsWithProperties} enriched, ${enrichmentRate}% coverage)`)

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Event sequences enriched successfully',
        stats: {
          sequences_enriched: rawSequences.length,
          total_events_enriched: totalEventsEnriched,
          events_with_properties: eventsWithProperties,
          enrichment_rate: parseFloat(enrichmentRate)
        }
      }),
      {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error) {
    console.error('Error in enrich-event-sequences function:', error)

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
