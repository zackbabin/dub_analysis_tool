// Supabase Edge Function: fetch-portfolio-mapping
// Fetches portfolio ticker to ID mapping from Mixpanel Insights Chart 85877922
// Stores mapping between portfolioTicker and portfolioId for use in portfolio metrics

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4'
import { CORS_HEADERS, fetchInsightsData, type MixpanelCredentials, shouldSkipSync } from '../_shared/mixpanel-api.ts'

const PORTFOLIO_MAPPING_CHART_ID = '85877922'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    const mixpanelUsername = Deno.env.get('MIXPANEL_SERVICE_USERNAME')
    const mixpanelSecret = Deno.env.get('MIXPANEL_SERVICE_SECRET')

    if (!mixpanelUsername || !mixpanelSecret) {
      throw new Error('Mixpanel credentials not configured in Supabase secrets')
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    console.log('Starting portfolio mapping sync...')

    // Check if sync should be skipped (within 6-hour window)
    const { shouldSkip, lastSyncTime } = await shouldSkipSync(supabase, 'portfolio_mapping', 6)

    if (shouldSkip) {
      console.log('⏭️ Skipping portfolio mapping sync, using cached data')
      return new Response(
        JSON.stringify({
          success: true,
          skipped: true,
          lastSyncTime: lastSyncTime?.toISOString()
        }),
        {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          status: 200
        }
      )
    }

    // Create sync log entry
    const syncStartTime = new Date()
    const { data: syncLog, error: syncLogError } = await supabase
      .from('sync_logs')
      .insert({
        tool_type: 'creator',
        sync_started_at: syncStartTime.toISOString(),
        sync_status: 'in_progress',
        source: 'portfolio_mapping',
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
        secret: mixpanelSecret
      }

      // Fetch portfolio mapping from Mixpanel Insights Chart
      console.log(`Fetching portfolio mapping from Mixpanel Chart ${PORTFOLIO_MAPPING_CHART_ID}...`)
      const chartData = await fetchInsightsData(
        credentials,
        PORTFOLIO_MAPPING_CHART_ID,
        'Portfolio Ticker Mapping'
      )

      console.log('✅ Received portfolio mapping chart data')

      // Process and store data
      const mappingRecords = processPortfolioMappingData(chartData)
      console.log(`Processed ${mappingRecords.length} portfolio mapping records`)

      // Store in database (upsert)
      if (mappingRecords.length > 0) {
        const { error: upsertError } = await supabase
          .from('portfolio_ticker_mapping')
          .upsert(mappingRecords, {
            onConflict: 'portfolio_ticker,portfolio_id',
            ignoreDuplicates: false
          })

        if (upsertError) {
          console.error('Error upserting portfolio mapping:', upsertError)
          throw upsertError
        }

        console.log(`✅ Stored ${mappingRecords.length} portfolio mappings`)
      }

      // Update sync log with success
      const syncEndTime = new Date()
      await supabase
        .from('sync_logs')
        .update({
          sync_completed_at: syncEndTime.toISOString(),
          sync_status: 'completed',
          total_records_inserted: mappingRecords.length
        })
        .eq('id', syncLogId)

      return new Response(
        JSON.stringify({
          success: true,
          stats: {
            mappingsProcessed: mappingRecords.length
          }
        }),
        {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          status: 200
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
          error_details: { stack: error.stack }
        })
        .eq('id', syncLogId)

      throw error
    }
  } catch (error) {
    console.error('Error in fetch-portfolio-mapping function:', error)

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }),
      {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        status: 500
      }
    )
  }
})

/**
 * Process Mixpanel Insights Chart data into portfolio mapping records
 *
 * Input structure:
 * series["A. Total Events of Copied Portfolio"]["WAZZAWINS"]["5426"] = { all: 1 }
 *
 * We extract: portfolioTicker = "WAZZAWINS", portfolioId = "5426"
 */
function processPortfolioMappingData(chartData: any): any[] {
  const mappings: any[] = []
  const mappingSet = new Set<string>()

  if (!chartData.series) {
    console.warn('No series data in chart response')
    return []
  }

  // Get the first metric (we just need the structure, not the actual counts)
  const metricKeys = Object.keys(chartData.series)
  if (metricKeys.length === 0) {
    console.warn('No metrics found in series data')
    return []
  }

  const metricData = chartData.series[metricKeys[0]]
  console.log(`Found metric: ${metricKeys[0]}`)

  // Iterate through portfolioTicker -> portfolioId structure
  for (const [portfolioTicker, tickerData] of Object.entries(metricData)) {
    if (portfolioTicker === '$overall' || typeof tickerData !== 'object') continue

    for (const [portfolioId, idData] of Object.entries(tickerData as Record<string, any>)) {
      if (portfolioId === '$overall' || typeof idData !== 'object') continue

      // Create unique key to avoid duplicates
      const key = `${portfolioTicker}|${portfolioId}`
      if (mappingSet.has(key)) continue

      // Prepend "$" to portfolio ticker to match format in portfolio_creator_engagement_metrics
      const formattedTicker = portfolioTicker.startsWith('$') ? portfolioTicker : `$${portfolioTicker}`

      mappings.push({
        portfolio_ticker: formattedTicker,
        portfolio_id: String(portfolioId),
        synced_at: new Date().toISOString()
      })

      mappingSet.add(key)
      console.log(`✅ Mapped ${formattedTicker} -> ${portfolioId}`)
    }
  }

  console.log(`Processed ${mappings.length} unique portfolio mappings`)
  return mappings
}
