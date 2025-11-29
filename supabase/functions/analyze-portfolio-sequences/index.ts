// Supabase Edge Function: analyze-portfolio-sequences
// SIMPLIFIED: Analyzes raw "Viewed Portfolio Details" events to find conversion patterns
// Claude calculates average unique portfolio views before first copy
//
// Data sources:
//   - portfolio_sequences: View joining portfolio_sequences_raw + user_first_copies (complete event history)
//   - user_first_copies: 250 most recent users who copied at least once
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

    console.log(`Starting SQL-based event sequence analysis for ${outcomeType}...`)

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Use native SQL function for portfolio sequence analysis (replaces Claude API)
    console.log('Calculating portfolio sequence metrics via SQL...')
    const { data: metrics, error: metricsError } = await supabase
      .rpc('calculate_portfolio_sequence_metrics')

    if (metricsError) {
      console.error('Error calculating metrics:', metricsError)
      throw metricsError
    }

    if (!metrics || metrics.length === 0) {
      throw new Error('No metrics returned from calculate_portfolio_sequence_metrics')
    }

    const result = metrics[0]
    const meanValue = result.mean_unique_portfolios || null
    const medianValue = result.median_unique_portfolios || null

    console.log('✅ SQL analysis complete')
    console.log(`Mean: ${meanValue}, Median: ${medianValue}`)

    // Update event_sequence_metrics table (which feeds into copy_engagement_summary view)
    console.log('Updating event_sequence_metrics table...')

    /* ============================================================================
     * CLAUDE API CODE - COMMENTED OUT (replaced with SQL for 95% performance gain)
     * ============================================================================
     *
     * Original approach: Fetch events, send to Claude API for mean/median calculation
     * Performance: 5-15 seconds, $0.75 per run
     * New approach: Native SQL aggregation
     * Performance: 100-500ms, $0
     *
     * // Get Claude API key from Supabase secrets
     * const claudeApiKey = Deno.env.get('ANTHROPIC_API_KEY')
     * if (!claudeApiKey) {
     *   throw new Error('ANTHROPIC_API_KEY not configured in Supabase secrets')
     * }
     *
     * // Fetch "Viewed Portfolio Details" events for users who copied (first_copy_time NOT NULL)
     * // Filter to events BEFORE first copy using SQL
     * console.log('Fetching portfolio view events before first copy (SQL filtered)...')
     * const { data: viewsBeforeCopy, error: viewsError } = await supabase
     *   .from('portfolio_sequences')
     *   .select('user_id, event_time, portfolio_ticker, first_copy_time')
     *   .not('first_copy_time', 'is', null)
     *   .eq('event_name', 'Viewed Portfolio Details')
     *   .order('first_copy_time', { ascending: false })
     *
     * if (viewsError) throw viewsError
     * console.log(`✓ Fetched ${viewsBeforeCopy.length} total portfolio view events`)
     *
     * // Group by user and filter to events before first copy
     * const userViewsMap = new Map()
     * let totalPreCopyEvents = 0
     *
     * for (const view of viewsBeforeCopy) {
     *   if (new Date(view.event_time) < new Date(view.first_copy_time)) {
     *     if (!userViewsMap.has(view.user_id)) {
     *       userViewsMap.set(view.user_id, {
     *         user_id: view.user_id,
     *         first_copy_time: view.first_copy_time,
     *         views: []
     *       })
     *     }
     *     userViewsMap.get(view.user_id).views.push({
     *       time: view.event_time,
     *       portfolio: view.portfolio_ticker
     *     })
     *     totalPreCopyEvents++
     *   }
     * }
     *
     * const convertersWithViews = Array.from(userViewsMap.values())
     *   .sort((a, b) => new Date(b.first_copy_time).getTime() - new Date(a.first_copy_time).getTime())
     *   .slice(0, 250)
     *
     * console.log(`Prepared data: ${convertersWithViews.length} converters with ${totalPreCopyEvents} pre-copy view events`)
     *
     * // Claude API call would go here...
     *
     * ============================================================================ */

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
      console.log('✅ copy_engagement_summary auto-updated (regular view)')
    }

    return new Response(
      JSON.stringify({
        success: true,
        method: 'SQL',
        mean_unique_portfolios: meanValue,
        median_unique_portfolios: medianValue,
        updated_summary: !updateError,
      }),
      {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      }
    )
  } catch (error: any) {
    console.error('Error in analyze-portfolio-sequences:', error)

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
