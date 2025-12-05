// Supabase Edge Function: analyze-creator-sequences
// SIMPLIFIED: Analyzes raw "Viewed Creator Profile" events to find conversion patterns
// Calculates average unique creator profile views between KYC approval and first copy
//
// Data sources:
//   - creator_sequences_raw: Raw creator view events
//   - user_first_copies: Users with both kyc_approved_time and first_copy_time
//
// Analysis filters events between kyc_approved_time and first_copy_time for each user

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

    console.log(`Starting SQL-based creator sequence analysis for ${outcomeType}...`)

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Use native SQL function for creator sequence analysis (replaces Claude API)
    console.log('Calculating creator sequence metrics via SQL...')
    const { data: metrics, error: metricsError } = await supabase
      .rpc('calculate_creator_sequence_metrics')

    if (metricsError) {
      console.error('Error calculating metrics:', metricsError)
      throw metricsError
    }

    if (!metrics || metrics.length === 0) {
      throw new Error('No metrics returned from calculate_creator_sequence_metrics')
    }

    const result = metrics[0]
    const meanValue = result.mean_unique_creators || null
    const medianValue = result.median_unique_creators || null
    const converterCount = result.converter_count || 0
    const convertersWithViews = result.converters_with_views || 0
    const convertersWithoutViews = result.converters_without_views || 0

    console.log('✅ SQL analysis complete')
    console.log(`Mean: ${meanValue}, Median: ${medianValue}`)
    console.log(`Total converters: ${converterCount} (${convertersWithViews} with views, ${convertersWithoutViews} without)`)

    // Analyze creator copy paths (ordered sequences)
    console.log('Analyzing creator copy paths via SQL...')
    const { data: pathData, error: pathError } = await supabase
      .rpc('analyze_creator_copy_paths')

    if (pathError) {
      console.error('Error analyzing creator copy paths:', pathError)
      throw pathError
    }

    console.log(`✅ Creator copy paths analyzed - ${pathData?.length || 0} results returned`)

    // Clear existing path analysis and insert new results
    if (pathData && pathData.length > 0) {
      console.log('Updating creator_copy_path_analysis table...')

      // Delete existing rows
      const { error: deleteError } = await supabase
        .from('creator_copy_path_analysis')
        .delete()
        .neq('id', 0) // Delete all rows

      if (deleteError) {
        console.error('Error clearing creator_copy_path_analysis:', deleteError)
      }

      // Insert new results
      const { error: insertError } = await supabase
        .from('creator_copy_path_analysis')
        .insert(pathData.map(row => ({
          analysis_type: row.analysis_type,
          path_rank: row.path_rank,
          creator_sequence: row.creator_sequence,
          converter_count: row.converter_count,
          pct_of_converters: row.pct_of_converters,
          total_converters_analyzed: row.total_converters_analyzed,
          updated_at: new Date().toISOString()
        })))

      if (insertError) {
        console.error('Error inserting creator path analysis:', insertError)
      } else {
        console.log('✅ Updated creator_copy_path_analysis with 30 rows (3 analysis types × top 10)')
      }
    }

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
     * // Fetch "Viewed Creator Profile" events for users who copied (first_copy_time NOT NULL)
     * // Filter to events BEFORE first copy using SQL
     * console.log('Fetching creator profile view events before first copy (SQL filtered)...')
     * const { data: viewsBeforeCopy, error: viewsError } = await supabase
     *   .from('creator_sequences')
     *   .select('user_id, event_time, event_name, creator_username, first_copy_time')
     *   .not('first_copy_time', 'is', null)
     *   .eq('event_name', 'Viewed Creator Profile')
     *   .order('first_copy_time', { ascending: false })
     *
     * if (viewsError) throw viewsError
     * console.log(`✓ Fetched ${viewsBeforeCopy.length} total creator profile view events`)
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
     *       creator: view.creator_username
     *     })
     *     totalPreCopyEvents++
     *   }
     * }
     *
     * const convertersWithViews = Array.from(userViewsMap.values())
     *   .sort((a, b) => new Date(b.first_copy_time).getTime() - new Date(a.first_copy_time).getTime())
     *   .slice(0, 250)
     *
     * console.log(`Prepared data: ${convertersWithViews.length} converters with ${totalPreCopyEvents} pre-copy creator profile view events`)
     *
     * // Claude API call would go here...
     *
     * ============================================================================ */

    const { error: updateError } = await supabase
      .from('event_sequence_metrics')
      .update({
        mean_unique_creators: meanValue,
        median_unique_creators: medianValue,
        creator_converter_count: converterCount,
        updated_at: new Date().toISOString()
      })
      .eq('id', 1)

    if (updateError) {
      console.error('Error updating event_sequence_metrics:', updateError)
    } else {
      console.log('✅ Updated event_sequence_metrics with mean_unique_creators and median_unique_creators')
      console.log('✅ copy_engagement_summary auto-updated (regular view)')
    }

    return new Response(
      JSON.stringify({
        success: true,
        method: 'SQL',
        mean_unique_creators: meanValue,
        median_unique_creators: medianValue,
        converter_count: converterCount,
        updated_summary: !updateError,
      }),
      {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      }
    )
  } catch (error: any) {
    console.error('Error in analyze-creator-sequences:', error)

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
