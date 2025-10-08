// Supabase Edge Function: analyze-event-sequences
// Uses Claude AI to analyze user event sequences and identify predictive patterns
// Analyzes sequences that lead to copies and subscriptions
// Stores analysis results in event_sequence_analysis table

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface AnalyzeRequest {
  outcome_type: 'copies' | 'subscriptions'
}

interface AnalysisResult {
  predictive_sequences: Array<{
    sequence: string[]
    prevalence_in_converters: number
    prevalence_in_non_converters: number
    lift: number
    avg_time_to_conversion_minutes: number
    avg_events_before_conversion: number
    insight: string
    recommendation: string
  }>
  critical_triggers: Array<{
    event: string
    follows_sequence: string[]
    conversion_rate_after_trigger: number
    insight: string
  }>
  anti_patterns: Array<{
    sequence: string[]
    prevalence_in_non_converters: number
    insight: string
  }>
  summary: string
  top_recommendations: string[]
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

    console.log(`Starting event sequence analysis for ${outcomeType}...`)

    // Get Claude API key from Supabase secrets
    const claudeApiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!claudeApiKey) {
      throw new Error('ANTHROPIC_API_KEY not configured in Supabase secrets')
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Fetch user event sequences with outcomes
    console.log('Fetching event sequences from database...')

    let converters, nonConverters

    if (outcomeType === 'copies') {
      // High copy users (3+ copies)
      const { data: highCopyUsers, error: highCopyError } = await supabase
        .from('user_event_sequences')
        .select('distinct_id, event_sequence, total_copies')
        .gte('total_copies', 3)
        .limit(300)

      if (highCopyError) throw highCopyError
      converters = highCopyUsers || []

      // Low/no copy users
      const { data: lowCopyUsers, error: lowCopyError } = await supabase
        .from('user_event_sequences')
        .select('distinct_id, event_sequence, total_copies')
        .lt('total_copies', 1)
        .limit(300)

      if (lowCopyError) throw lowCopyError
      nonConverters = lowCopyUsers || []
    } else {
      // Subscription users
      const { data: subUsers, error: subError } = await supabase
        .from('user_event_sequences')
        .select('distinct_id, event_sequence, total_subscriptions')
        .eq('total_subscriptions', 1)
        .limit(300)

      if (subError) throw subError
      converters = subUsers || []

      // Non-subscription users
      const { data: nonSubUsers, error: nonSubError } = await supabase
        .from('user_event_sequences')
        .select('distinct_id, event_sequence, total_subscriptions')
        .eq('total_subscriptions', 0)
        .limit(300)

      if (nonSubError) throw nonSubError
      nonConverters = nonSubUsers || []
    }

    console.log(`Loaded ${converters.length} converters and ${nonConverters.length} non-converters`)

    if (converters.length === 0) {
      throw new Error(`No converter data available for ${outcomeType}`)
    }

    // Prepare data for Claude - truncate sequences to prevent token overflow
    // With 200 converters + 100 non-converters at 40 events each, we stay well under 200k token limit
    const convertersSample = converters.slice(0, 200).map(u => ({
      id: u.distinct_id?.slice(0, 8) || 'unknown',
      sequence: (u.event_sequence || []).slice(0, 40), // Limit to first 40 events
      outcome_count: outcomeType === 'copies' ? u.total_copies : u.total_subscriptions
    }))

    const nonConvertersSample = nonConverters.slice(0, 100).map(u => ({
      id: u.distinct_id?.slice(0, 8) || 'unknown',
      sequence: (u.event_sequence || []).slice(0, 40) // Limit to first 40 events
    }))

    // Build Claude prompt
    const prompt = `You are a data scientist analyzing user behavior sequences to identify predictive patterns for ${outcomeType}.

<context>
Platform: Investment social network where users copy portfolios and subscribe to creators
Outcome: ${outcomeType} (${outcomeType === 'copies' ? 'total_copies >= 3' : 'has subscribed'})
Dataset: ${converters.length} high converters, ${nonConverters.length} non-converters
Goal: Find event sequences that PREDICT conversion (not just correlate)
</context>

<data>
HIGH CONVERTERS (sample):
${JSON.stringify(convertersSample, null, 2)}

NON-CONVERTERS (sample):
${JSON.stringify(nonConvertersSample, null, 2)}
</data>

<analysis_instructions>
1. TEMPORAL PATTERNS: Identify sequences where order matters (e.g., "Profile View → PDP View → Copy" vs "PDP View → Profile View")
2. FREQUENCY THRESHOLDS: Find minimum event counts that predict conversion (e.g., "3+ profile views before first copy")
3. KEY DIFFERENTIATORS: Events present in converters but rare in non-converters
4. TIME WINDOWS: Average time between key events in successful conversion paths
5. CRITICAL MOMENTS: Last 2-3 events before conversion (immediate triggers)
6. Focus on actionable patterns that product teams can optimize

CONSISTENCY REQUIREMENTS:
- Use the EXACT event names as they appear in the data provided - do not rename, rephrase, or clean up event names
- Maintain stable pattern identification - if data hasn't materially changed, return the same top patterns in the same order
- Keep insights and recommendations similarly worded when the underlying patterns are consistent
- Calculate metrics (lift, prevalence) using the same methodology each time
- This ensures analysis stability and makes trend tracking easier over time
</analysis_instructions>

<output_format>
Return ONLY valid JSON with this exact structure (no markdown, no code blocks):

IMPORTANT: Sort "predictive_sequences" by their impact score, calculated as:
  Impact = lift × prevalence_in_converters
This prioritizes patterns that have both high predictive power (lift) AND affect the most converters (prevalence).
Order from highest impact to lowest impact.

{
  "predictive_sequences": [
    {
      "sequence": ["Event A", "Event B", "Event C"],
      "prevalence_in_converters": 0.67,
      "prevalence_in_non_converters": 0.12,
      "lift": 5.58,
      "avg_time_to_conversion_minutes": 240,
      "avg_events_before_conversion": 8,
      "insight": "Users who view 3+ creator profiles before PDP interaction are 5.6x more likely to copy",
      "recommendation": "Encourage profile browsing before portfolio exposure"
    }
  ],
  "critical_triggers": [
    {
      "event": "Paywall View",
      "follows_sequence": ["Profile View", "PDP View"],
      "conversion_rate_after_trigger": 0.34,
      "insight": "34% of users subscribe within 24h after paywall view if they previously viewed profile + PDP"
    }
  ],
  "anti_patterns": [
    {
      "sequence": ["Direct PDP View", "Immediate Exit"],
      "prevalence_in_non_converters": 0.45,
      "insight": "Users who land directly on PDP without profile context have 45% churn rate"
    }
  ],
  "summary": "Overall predictive findings in 2-3 sentences",
  "top_recommendations": ["Action 1", "Action 2", "Action 3"]
}
</output_format>`

    // Call Claude API
    console.log('Calling Claude API for analysis...')

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8000,
        messages: [{
          role: 'user',
          content: prompt
        }]
      })
    })

    if (!claudeResponse.ok) {
      const errorText = await claudeResponse.text()
      throw new Error(`Claude API error: ${claudeResponse.status} - ${errorText}`)
    }

    const claudeData = await claudeResponse.json()
    console.log('✓ Claude analysis completed')

    // Parse Claude's response
    let analysisResult: AnalysisResult
    try {
      const responseText = claudeData.content[0].text
      // Remove markdown code blocks if present
      const cleanedText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      analysisResult = JSON.parse(cleanedText)
    } catch (parseError) {
      console.error('Failed to parse Claude response:', parseError)
      console.error('Raw response:', claudeData.content[0].text)
      throw new Error('Failed to parse Claude analysis results')
    }

    // Store results in database
    console.log('Storing analysis results...')
    const { error: insertError } = await supabase
      .from('event_sequence_analysis')
      .insert({
        analysis_type: outcomeType,
        predictive_sequences: analysisResult.predictive_sequences,
        critical_triggers: analysisResult.critical_triggers || [],
        anti_patterns: analysisResult.anti_patterns || [],
        summary: analysisResult.summary,
        recommendations: analysisResult.top_recommendations,
        model_used: 'claude-sonnet-4-20250514'
      })

    if (insertError) {
      console.error('Failed to store analysis results:', insertError)
      throw insertError
    }

    console.log('✓ Analysis results stored successfully')

    return new Response(
      JSON.stringify({
        success: true,
        message: `Event sequence analysis for ${outcomeType} completed successfully`,
        analysis: analysisResult,
        stats: {
          converters_analyzed: converters.length,
          non_converters_analyzed: nonConverters.length,
          patterns_found: analysisResult.predictive_sequences.length
        }
      }),
      {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error) {
    console.error('Error in analyze-event-sequences function:', error)

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
