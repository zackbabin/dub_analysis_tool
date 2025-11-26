// Supabase Edge Function: analyze-event-sequences
// SIMPLIFIED: Analyzes raw "Viewed Portfolio Details" events to find conversion patterns
// Claude calculates average unique portfolio views before first copy
//
// Data sources:
//   - event_sequences: View joining event_sequences_raw + user_first_copies (complete event history)
//   - user_first_copies: 200 most recent users who copied at least once
//
// No pre-aggregation - Claude analyzes raw events directly

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface AnalyzeRequest {
  outcome_type: 'copies' | 'subscriptions'
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    // Parse request body
    const body: AnalyzeRequest = await req.json()
    const outcomeType = body.outcome_type || 'copies'

    console.log(`Starting simplified event sequence analysis for ${outcomeType}...`)

    // Get Claude API key from Supabase secrets
    const claudeApiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!claudeApiKey) {
      throw new Error('ANTHROPIC_API_KEY not configured in Supabase secrets')
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Fetch converters (users who copied at least once)
    console.log('Fetching converters from user_first_copies...')
    const { data: convertersData, error: convertersError } = await supabase
      .from('user_first_copies')
      .select('user_id, first_copy_time')
      .order('first_copy_time', { ascending: false })
      .limit(200)

    if (convertersError) throw convertersError

    console.log(`Found ${convertersData.length} converters`)

    // Fetch ALL view events for these converters (complete event history)
    const converterIds = convertersData.map(c => c.user_id)

    console.log('Fetching ALL view events for converters (complete event history)...')
    const { data: allViews, error: viewsError } = await supabase
      .from('event_sequences')
      .select('user_id, event_time, portfolio_ticker')
      .in('user_id', converterIds)
      .order('user_id, event_time')

    if (viewsError) throw viewsError

    console.log(`✓ Fetched ${allViews.length} total view events`)

    // Group views by user and filter to BEFORE first copy
    const userViewsMap = new Map()
    for (const view of allViews) {
      if (!userViewsMap.has(view.user_id)) {
        userViewsMap.set(view.user_id, [])
      }
      userViewsMap.get(view.user_id).push(view)
    }

    // Build final dataset with views BEFORE first copy
    const convertersWithViews = []
    for (const converter of convertersData) {
      const allUserViews = userViewsMap.get(converter.user_id) || []
      const viewsBeforeCopy = allUserViews.filter(v =>
        new Date(v.event_time) < new Date(converter.first_copy_time)
      )

      convertersWithViews.push({
        user_id: converter.user_id,
        first_copy_time: converter.first_copy_time,
        views: viewsBeforeCopy.map(v => ({
          time: v.event_time,
          portfolio: v.portfolio_ticker
        }))
      })
    }

    console.log(`Prepared data: ${convertersWithViews.length} converters with ${allViews.length} total view events`)

    // Send to Claude for analysis
    console.log('Sending data to Claude AI for analysis...')

    const systemPrompt = `You are a data scientist analyzing user behavior to identify portfolio copy patterns.

**Data provided**:
- Users who copied at least once, with their "Viewed Portfolio Details" events BEFORE first copy

**Your task**:
Calculate the MEAN and MEDIAN number of UNIQUE portfolio views (by portfolio ticker) before first copy.

Example:
- User A views: [$PELOSI, $AAPL, $PELOSI, $TSLA] → 3 unique portfolios
- User B views: [$AAPL, $AAPL] → 1 unique portfolio

For each user, count the unique portfolio tickers they viewed BEFORE copying, then calculate:
1. Mean across all users
2. Median across all users

Format your response as JSON:
{
  "mean_unique_views_converters": number,
  "median_unique_views_converters": number
}`

    const userPrompt = `Analyze portfolio views before first copy for ${convertersWithViews.length} users:

${JSON.stringify(convertersWithViews, null, 2)}

Calculate mean and median unique portfolio views (by ticker) before first copy.`

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': claudeApiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'structured-outputs-2025-11-13',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5-20251101',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: userPrompt,
          },
        ],
        output_format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              mean_unique_views_converters: {
                type: 'number',
                description: 'Mean number of unique portfolio views before first copy'
              },
              median_unique_views_converters: {
                type: 'number',
                description: 'Median number of unique portfolio views before first copy'
              }
            },
            required: ['mean_unique_views_converters', 'median_unique_views_converters'],
            additionalProperties: false
          }
        }
      }),
    })

    if (!claudeResponse.ok) {
      const errorText = await claudeResponse.text()
      throw new Error(`Claude API error: ${claudeResponse.status} - ${errorText}`)
    }

    const claudeResult = await claudeResponse.json()

    // With structured outputs, the JSON is directly in the content[0].text field
    // No need to parse markdown or extract - it's already valid JSON
    const analysisText = claudeResult.content[0].text

    console.log('Claude structured output response:', analysisText.substring(0, 200))

    let analysis: any = {}
    try {
      analysis = JSON.parse(analysisText)
      console.log('✅ Parsed structured output:', analysis)
    } catch (parseError: any) {
      console.error('Failed to parse structured output:', parseError)
      console.error('Raw response:', analysisText)
      throw new Error(`Failed to parse Claude structured output: ${parseError?.message || String(parseError)}`)
    }

    console.log('✅ Analysis complete')
    console.log(`Mean: ${analysis.mean_unique_views_converters}, Median: ${analysis.median_unique_views_converters}`)

    // Update event_sequence_metrics table (which feeds into copy_engagement_summary view)
    console.log('Updating event_sequence_metrics table...')

    const meanValue = analysis.mean_unique_views_converters || null
    const medianValue = analysis.median_unique_views_converters || null

    const { error: updateError } = await supabase
      .from('event_sequence_metrics')
      .update({
        mean_unique_portfolios: meanValue,
        median_unique_portfolios: medianValue,
        updated_at: new Date().toISOString()
      })
      .eq('id', 1)

    if (updateError) {
      console.error('Error updating event_sequence_metrics:', updateError)
    } else {
      console.log('✅ Updated event_sequence_metrics with mean and median values')
    }

    return new Response(
      JSON.stringify({
        success: true,
        analysis: analysis,
        raw_response: analysisText,
        converters_analyzed: convertersWithViews.length,
        total_view_events: allViews.length,
        updated_summary: !updateError,
      }),
      {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      }
    )
  } catch (error: any) {
    console.error('Error in analyze-event-sequences:', error)

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        details: error.stack,
      }),
      {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      }
    )
  }
})
