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

    // Prepare data for Claude with prompt caching
    // Balance converters and non-converters to equal counts for fair analysis
    // With caching, we can analyze 120 users per batch (60 converters + 60 non-converters)
    // Reduced batch size to stay under 200k token limit
    // Process up to 100 events per user for richer sequence data
    const BATCH_SIZE = 60 // Per group (converters and non-converters)
    const EVENTS_PER_USER = 100
    const MAX_BATCHES = 15 // Process up to 900 converters + 900 non-converters total

    // Balance to equal sizes
    const minSize = Math.min(converters.length, nonConverters.length)
    const balancedConverters = converters.slice(0, minSize)
    const balancedNonConverters = nonConverters.slice(0, minSize)

    console.log(`Balanced dataset: ${balancedConverters.length} converters, ${balancedNonConverters.length} non-converters`)

    // Build system prompt (will be cached across batches)
    const systemPrompt = `You are a data scientist analyzing user behavior sequences to identify predictive patterns for ${outcomeType}.

<context>
Platform: Investment social network where users copy portfolios and subscribe to creators
Outcome: ${outcomeType} (${outcomeType === 'copies' ? 'total_copies >= 3' : 'has subscribed'})
Goal: Find event sequences that PREDICT conversion (not just correlate)
</context>

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

    // Process users in batches with prompt caching
    console.log('Processing users in batches with prompt caching...')

    const totalBatches = Math.min(
      Math.ceil(balancedConverters.length / BATCH_SIZE),
      MAX_BATCHES
    )

    // Helper function to deduplicate consecutive identical events
    // e.g., ["View", "View", "View", "Click", "Click"] -> ["View", "Click"]
    const dedupeSequence = (sequence: string[]): string[] => {
      if (!sequence || sequence.length === 0) return []
      const deduped: string[] = [sequence[0]]
      for (let i = 1; i < sequence.length; i++) {
        if (sequence[i] !== sequence[i - 1]) {
          deduped.push(sequence[i])
        }
      }
      return deduped
    }

    const allBatchResults: AnalysisResult[] = []

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const start = batchIndex * BATCH_SIZE
      const end = Math.min(start + BATCH_SIZE, balancedConverters.length)

      let totalRawEvents = 0
      let totalDedupedEvents = 0

      const convertersBatch = balancedConverters.slice(start, end).map(u => {
        const rawSequence = (u.event_sequence || []).slice(0, EVENTS_PER_USER)
        const dedupedSequence = dedupeSequence(rawSequence)
        totalRawEvents += rawSequence.length
        totalDedupedEvents += dedupedSequence.length
        return {
          id: u.distinct_id?.slice(0, 8) || 'unknown',
          sequence: dedupedSequence,
          outcome_count: outcomeType === 'copies' ? u.total_copies : u.total_subscriptions
        }
      })

      const nonConvertersBatch = balancedNonConverters.slice(start, end).map(u => {
        const rawSequence = (u.event_sequence || []).slice(0, EVENTS_PER_USER)
        const dedupedSequence = dedupeSequence(rawSequence)
        totalRawEvents += rawSequence.length
        totalDedupedEvents += dedupedSequence.length
        return {
          id: u.distinct_id?.slice(0, 8) || 'unknown',
          sequence: dedupedSequence
        }
      })

      const reductionPercent = ((1 - totalDedupedEvents / totalRawEvents) * 100).toFixed(1)
      console.log(`Processing batch ${batchIndex + 1}/${totalBatches}: ${convertersBatch.length} converters, ${nonConvertersBatch.length} non-converters`)
      console.log(`Event deduplication: ${totalRawEvents} raw events → ${totalDedupedEvents} unique events (${reductionPercent}% reduction)`)

      // Build data section for this batch
      const dataPrompt = `<data>
Dataset size: ${convertersBatch.length} converters, ${nonConvertersBatch.length} non-converters (Batch ${batchIndex + 1}/${totalBatches})

HIGH CONVERTERS:
${JSON.stringify(convertersBatch, null, 2)}

NON-CONVERTERS:
${JSON.stringify(nonConvertersBatch, null, 2)}
</data>

Analyze this batch and return the top predictive patterns found.`

      // Call Claude API with prompt caching
      const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': claudeApiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'prompt-caching-2024-07-31'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 8000,
          system: [
            {
              type: 'text',
              text: systemPrompt,
              cache_control: { type: 'ephemeral' }
            }
          ],
          messages: [{
            role: 'user',
            content: dataPrompt
          }]
        })
      })

      if (!claudeResponse.ok) {
        const errorText = await claudeResponse.text()
        throw new Error(`Claude API error (batch ${batchIndex + 1}): ${claudeResponse.status} - ${errorText}`)
      }

      const claudeData = await claudeResponse.json()

      // Log cache usage
      const usage = claudeData.usage
      console.log(`Batch ${batchIndex + 1} tokens:`, {
        input: usage?.input_tokens || 0,
        cache_creation: usage?.cache_creation_input_tokens || 0,
        cache_read: usage?.cache_read_input_tokens || 0,
        output: usage?.output_tokens || 0
      })

      // Parse batch result
      try {
        const responseText = claudeData.content[0].text
        const cleanedText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
        const batchResult: AnalysisResult = JSON.parse(cleanedText)
        allBatchResults.push(batchResult)
      } catch (parseError) {
        console.error(`Failed to parse batch ${batchIndex + 1} response:`, parseError)
        console.error('Raw response:', claudeData.content[0].text)
        throw new Error(`Failed to parse batch ${batchIndex + 1} analysis results`)
      }
    }

    console.log(`✓ Completed ${totalBatches} batches, merging results...`)

    // Merge results from all batches
    const analysisResult = mergeBatchResults(allBatchResults)
    console.log('✓ Analysis completed and merged')

    // Helper function to merge batch results
    function mergeBatchResults(results: AnalysisResult[]): AnalysisResult {
      if (results.length === 1) return results[0]

      // Collect all sequences and sort by impact (lift × prevalence)
      const allSequences = results.flatMap(r => r.predictive_sequences)
      const sortedSequences = allSequences
        .sort((a, b) => {
          const impactA = a.lift * a.prevalence_in_converters
          const impactB = b.lift * b.prevalence_in_converters
          return impactB - impactA
        })
        .slice(0, 10) // Keep top 10

      // Collect all triggers and patterns
      const allTriggers = results.flatMap(r => r.critical_triggers || []).slice(0, 5)
      const allAntiPatterns = results.flatMap(r => r.anti_patterns || []).slice(0, 5)

      // Combine summaries
      const summaries = results.map(r => r.summary).filter(Boolean)
      const combinedSummary = summaries.length > 0
        ? `Analysis of ${totalBatches} batches (${balancedConverters.length} total users): ${summaries[0]}`
        : 'Combined analysis across multiple batches'

      // Combine recommendations
      const allRecommendations = results.flatMap(r => r.top_recommendations || [])
      const uniqueRecommendations = [...new Set(allRecommendations)].slice(0, 5)

      return {
        predictive_sequences: sortedSequences,
        critical_triggers: allTriggers,
        anti_patterns: allAntiPatterns,
        summary: combinedSummary,
        top_recommendations: uniqueRecommendations
      }
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
          total_converters_analyzed: balancedConverters.length,
          total_non_converters_analyzed: balancedNonConverters.length,
          batches_processed: totalBatches,
          events_per_user: EVENTS_PER_USER,
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
