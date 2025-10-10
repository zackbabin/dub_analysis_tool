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
  pdpPropertiesFetched: number
  profilePropertiesFetched: number
}

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

      // Fetch event properties in parallel (non-blocking - graceful degradation if fails)
      let pdpPropertiesData = null
      let profilePropertiesData = null

      try {
        console.log('Fetching event properties for enrichment...')
        // Fetch sequentially to avoid exceeding Mixpanel rate limit (max 5 concurrent)
        pdpPropertiesData = await fetchInsightsData(credentials, '85312972', 'PDP Properties')
        profilePropertiesData = await fetchInsightsData(credentials, '85312975', 'Profile Properties')
        console.log('✓ Event properties fetched successfully')
      } catch (error) {
        console.warn('⚠️ Failed to fetch event properties - will proceed with non-enriched events:', error.message)
        // Continue without enrichment - pdpPropertiesData and profilePropertiesData remain null
      }

      // Process event sequences data (store raw, no joining yet)
      const stats: SyncStats = {
        eventSequencesFetched: 0,
        totalRawRecordsInserted: 0,
        chartId,
        pdpPropertiesFetched: 0,
        profilePropertiesFetched: 0,
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

      // Build property lookup maps for event enrichment
      console.log('Building property lookup maps...')

      // Key: `${distinct_id}|${event_name}|${timestamp}`
      const pdpPropertyMap = new Map<string, EventProperties>()
      const profilePropertyMap = new Map<string, EventProperties>()

      try {
        // Parse PDP properties (Chart 85312972)
      // Structure: series -> metric -> distinct_id -> time -> portfolioTicker -> creatorId -> creatorUsername -> all
      if (pdpPropertiesData?.series) {
        let pdpEventsProcessed = 0
        const startTime = Date.now()

        for (const [metricKey, metricData] of Object.entries(pdpPropertiesData.series)) {
          if (typeof metricData !== 'object' || metricData === null) continue

          const eventName = metricKey.replace(/^[A-Z]\.\s*/, '').replace(/^Total\s+/, '')

          for (const [distinctId, distinctData] of Object.entries(metricData as Record<string, any>)) {
            if (distinctId === '$overall') continue

            for (const [timestamp, timeData] of Object.entries(distinctData)) {
              if (timestamp === '$overall') continue

              // Navigate through nested structure: portfolioTicker -> creatorId -> creatorUsername
              for (const [ticker, tickerData] of Object.entries(timeData as Record<string, any>)) {
                if (ticker === '$overall') continue

                for (const [creatorId, creatorData] of Object.entries(tickerData as Record<string, any>)) {
                  if (creatorId === '$overall') continue

                  for (const [username, countData] of Object.entries(creatorData as Record<string, any>)) {
                    if (username === 'all') continue

                    const key = `${distinctId}|${eventName}|${timestamp}`

                    // Store first occurrence (deduplicate if multiple at same timestamp)
                    if (!pdpPropertyMap.has(key)) {
                      pdpPropertyMap.set(key, {
                        portfolioTicker: ticker,
                        creatorUsername: username
                      })
                      stats.pdpPropertiesFetched++
                    }

                    pdpEventsProcessed++
                    // Progress logging every 10k events
                    if (pdpEventsProcessed % 10000 === 0) {
                      console.log(`PDP properties: processed ${pdpEventsProcessed} events, ${pdpPropertyMap.size} unique...`)
                    }
                  }
                }
              }
            }
          }
        }

        const pdpParseTime = ((Date.now() - startTime) / 1000).toFixed(1)
        console.log(`✓ Parsed PDP properties in ${pdpParseTime}s (${pdpEventsProcessed} events, ${pdpPropertyMap.size} unique)`)
      }

      // Parse Profile properties (Chart 85312975)
      // Structure: series -> metric -> distinct_id -> time -> creatorId -> creatorUsername -> all
      if (profilePropertiesData?.series) {
        let profileEventsProcessed = 0
        const startTime = Date.now()

        for (const [metricKey, metricData] of Object.entries(profilePropertiesData.series)) {
          if (typeof metricData !== 'object' || metricData === null) continue

          const eventName = metricKey.replace(/^[A-Z]\.\s*/, '').replace(/^Total\s+/, '')

          for (const [distinctId, distinctData] of Object.entries(metricData as Record<string, any>)) {
            if (distinctId === '$overall') continue

            for (const [timestamp, timeData] of Object.entries(distinctData)) {
              if (timestamp === '$overall') continue

              // Navigate through nested structure: creatorId -> creatorUsername
              for (const [creatorId, creatorData] of Object.entries(timeData as Record<string, any>)) {
                if (creatorId === '$overall') continue

                for (const [username, countData] of Object.entries(creatorData as Record<string, any>)) {
                  if (username === 'all') continue

                  const key = `${distinctId}|${eventName}|${timestamp}`

                  // Store first occurrence (deduplicate if multiple at same timestamp)
                  if (!profilePropertyMap.has(key)) {
                    profilePropertyMap.set(key, {
                      creatorUsername: username
                    })
                    stats.profilePropertiesFetched++
                  }

                  profileEventsProcessed++
                  // Progress logging every 10k events
                  if (profileEventsProcessed % 10000 === 0) {
                    console.log(`Profile properties: processed ${profileEventsProcessed} events, ${profilePropertyMap.size} unique...`)
                  }
                }
              }
            }
          }
        }

        const profileParseTime = ((Date.now() - startTime) / 1000).toFixed(1)
        console.log(`✓ Parsed Profile properties in ${profileParseTime}s (${profileEventsProcessed} events, ${profilePropertyMap.size} unique)`)
      }

        console.log(`✓ Built property maps: ${pdpPropertyMap.size} PDP properties, ${profilePropertyMap.size} profile properties`)
      } catch (error) {
        console.warn('⚠️ Failed to parse event properties - will proceed with non-enriched events:', error.message)
        // Continue without enrichment - maps remain empty
      }

      // Helper function to enrich event name with properties
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

        // Return unchanged if no properties found
        return event
      }

      // Convert to raw rows for database insertion with enrichment
      console.log('Enriching event sequences with properties...')
      const enrichStartTime = Date.now()
      const rawEventRows: any[] = []
      let totalEventsEnriched = 0
      let eventsWithProperties = 0

      for (const [distinctId, events] of userEventsMap.entries()) {
        // Sort events by timestamp
        events.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())

        // Enrich events with properties
        const enrichedEvents = events.map(evt => {
          const originalEvent = evt.event
          const enrichedEvent = enrichEventName(evt.event, evt.time, distinctId)

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

        rawEventRows.push({
          distinct_id: distinctId,
          event_data: enrichedEvents, // Store enriched events as JSONB
          synced_at: syncStartTime.toISOString()
        })
      }

      const enrichTime = ((Date.now() - enrichStartTime) / 1000).toFixed(1)
      const enrichmentRate = ((eventsWithProperties / totalEventsEnriched) * 100).toFixed(1)
      console.log(`✓ Enriched ${totalEventsEnriched} events in ${enrichTime}s (${eventsWithProperties} enriched, ${enrichmentRate}% coverage)`)

      console.log(`Prepared ${rawEventRows.length} raw event sequences`)
      stats.eventSequencesFetched = rawEventRows.length

      // Upsert raw data in batches to event_sequences_raw table
      const batchSize = 250 // Further reduced to avoid statement timeout (was 500)
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
