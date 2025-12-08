// Supabase Edge Function: analyze-subscription-sequences
// Analyzes UNIFIED creator + portfolio viewing patterns before first subscription
//
// Data sources:
//   - creator_sequences_raw: Raw creator view events
//   - portfolio_sequences_raw: Raw portfolio view events
//   - user_first_subscriptions: Users with first_subscription_time
//
// Analysis combines creator and portfolio views into one timeline

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    console.log('Starting unified subscription sequence analysis...')

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // ============================================================================
    // UNIFIED SUBSCRIPTION PATHS (CREATORS + PORTFOLIOS COMBINED)
    // ============================================================================

    console.log('Analyzing unified subscription paths (creators + portfolios) via SQL...')
    const { data: pathData, error: pathError } = await supabase
      .rpc('analyze_unified_subscription_paths')

    if (pathError) {
      console.error('Error analyzing unified subscription paths:', pathError)
      throw pathError
    }

    console.log(`✅ Unified subscription paths analyzed - ${pathData?.length || 0} results returned`)

    // Clear existing path analysis and insert new results
    if (pathData && pathData.length > 0) {
      console.log('Updating subscription_path_analysis table...')

      // Delete existing rows
      const { error: deleteError } = await supabase
        .from('subscription_path_analysis')
        .delete()
        .neq('id', 0) // Delete all rows

      if (deleteError) {
        console.error('Error clearing subscription_path_analysis:', deleteError)
      }

      // Insert new results
      const { error: insertError } = await supabase
        .from('subscription_path_analysis')
        .insert(pathData.map(row => ({
          analysis_type: row.analysis_type,
          path_rank: row.path_rank,
          view_sequence: row.view_sequence,
          converter_count: row.converter_count,
          pct_of_converters: row.pct_of_converters,
          total_converters_analyzed: row.total_converters_analyzed,
          updated_at: new Date().toISOString()
        })))

      if (insertError) {
        console.error('Error inserting subscription path analysis:', insertError)
      } else {
        console.log(`✅ Updated subscription_path_analysis with ${pathData.length} rows`)
      }
    }

    console.log('✅ Unified subscription sequence analysis complete')

    return new Response(
      JSON.stringify({
        success: true,
        paths_analyzed: pathData?.length || 0,
      }),
      {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      }
    )
  } catch (error: any) {
    console.error('Error in analyze-subscription-sequences:', error)

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
