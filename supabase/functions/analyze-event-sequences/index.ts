// Supabase Edge Function: analyze-event-sequences
// SIMPLIFIED: Analyzes raw "Viewed Portfolio Details" events to find conversion patterns
// Claude calculates average unique portfolio views before first copy
//
// Data sources:
//   - event_sequences_raw: All portfolio view events (last 14 days)
//   - user_first_copies: Users who copied at least once with first copy timestamp
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
      .select('distinct_id, first_copy_time')
      .order('first_copy_time', { ascending: false })
      .limit(300)

    if (convertersError) throw convertersError

    const converterIds = convertersData.map(c => c.distinct_id)
    console.log(`Found ${converterIds.length} converters`)

    // Fetch their view events BEFORE first copy
    const convertersWithViews = []
    for (const converter of convertersData) {
      const { data: views, error: viewsError } = await supabase
        .from('event_sequences_raw')
        .select('event_time, portfolio_ticker')
        .eq('distinct_id', converter.distinct_id)
        .lt('event_time', converter.first_copy_time) // Only events BEFORE copy
        .order('event_time')

      if (viewsError) {
        console.error(`Error fetching views for ${converter.distinct_id}:`, viewsError)
        continue
      }

      convertersWithViews.push({
        distinct_id: converter.distinct_id,
        first_copy_time: converter.first_copy_time,
        views: views.map(v => ({
          time: v.event_time,
          portfolio: v.portfolio_ticker
        }))
      })
    }

    // Fetch non-converters (users with views but no copies)
    console.log('Fetching non-converters from subscribers_insights...')
    const { data: nonConvertersData, error: nonConvertersError } = await supabase
      .from('subscribers_insights')
      .select('distinct_id')
      .eq('total_copies', 0)
      .limit(300)

    if (nonConvertersError) throw nonConvertersError

    const nonConverterIds = nonConvertersData.map(nc => nc.distinct_id)
    console.log(`Found ${nonConverterIds.length} non-converters`)

    // Fetch their view events (all views in 14-day window)
    const nonConvertersWithViews = []
    for (const nonConverter of nonConvertersData) {
      const { data: views, error: viewsError } = await supabase
        .from('event_sequences_raw')
        .select('event_time, portfolio_ticker')
        .eq('distinct_id', nonConverter.distinct_id)
        .order('event_time')

      if (viewsError) {
        console.error(`Error fetching views for ${nonConverter.distinct_id}:`, viewsError)
        continue
      }

      nonConvertersWithViews.push({
        distinct_id: nonConverter.distinct_id,
        views: views.map(v => ({
          time: v.event_time,
          portfolio: v.portfolio_ticker
        }))
      })
    }

    console.log(`Prepared data: ${convertersWithViews.length} converters, ${nonConvertersWithViews.length} non-converters`)

    // Send to Claude for analysis
    console.log('Sending data to Claude AI for analysis...')

    const systemPrompt = `You are a data scientist analyzing user behavior to identify what drives portfolio copies.

**Data provided**:
- Converters: Users who copied at least once, with their portfolio view events BEFORE first copy
- Non-converters: Users who viewed portfolios but never copied

**Your task**:
Calculate the MEAN and MEDIAN number of UNIQUE portfolio views (by portfolio ticker) before conversion.

Example:
- User A views: [$PELOSI, $AAPL, $PELOSI, $TSLA] → 3 unique portfolios
- User B views: [$AAPL, $AAPL] → 1 unique portfolio

Provide:
1. Mean unique portfolio views for converters
2. Median unique portfolio views for converters
3. Mean unique portfolio views for non-converters
4. Key insights about what differentiates converters

Format your response as JSON:
{
  "mean_unique_views_converters": number,
  "median_unique_views_converters": number,
  "mean_unique_views_non_converters": number,
  "insights": ["insight 1", "insight 2"]
}`

    const userPrompt = `Analyze these user journeys:

**CONVERTERS (${convertersWithViews.length} users)**:
${JSON.stringify(convertersWithViews.slice(0, 100), null, 2)}

**NON-CONVERTERS (${nonConvertersWithViews.length} users)**:
${JSON.stringify(nonConvertersWithViews.slice(0, 100), null, 2)}

Calculate unique portfolio views and provide insights.`

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': claudeApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: userPrompt,
          },
        ],
      }),
    })

    if (!claudeResponse.ok) {
      const errorText = await claudeResponse.text()
      throw new Error(`Claude API error: ${claudeResponse.status} - ${errorText}`)
    }

    const claudeResult = await claudeResponse.json()
    const analysisText = claudeResult.content[0].text

    // Parse JSON from Claude's response
    const jsonMatch = analysisText.match(/\{[\s\S]*\}/)
    const analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : {}

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
        non_converters_analyzed: nonConvertersWithViews.length,
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
