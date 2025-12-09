// Supabase Edge Function: analyze-copy-sequences
// Analyzes unified copy conversion paths (combining creator + portfolio views)
// Populates unified_copy_path_analysis table with top combinations and sequences
//
// Data sources:
//   - creator_sequences_raw: Raw creator view events
//   - portfolio_sequences_raw: Raw portfolio view events
//   - user_first_copies: Users with both kyc_approved_time and first_copy_time

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
    console.log('Starting unified copy sequence analysis...')

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Analyze unified copy paths (combines creator + portfolio views)
    console.log('Analyzing unified copy paths via SQL...')
    const { data: pathData, error: pathError } = await supabase
      .rpc('analyze_unified_copy_paths')

    if (pathError) {
      console.error('Error analyzing unified copy paths:', pathError)
      throw pathError
    }

    console.log(`✅ Unified copy paths analyzed - ${pathData?.length || 0} results returned`)

    // Clear existing path analysis and insert new results
    if (pathData && pathData.length > 0) {
      console.log('Updating unified_copy_path_analysis table...')

      // Delete existing rows
      const { error: deleteError } = await supabase
        .from('unified_copy_path_analysis')
        .delete()
        .neq('id', 0) // Delete all rows

      if (deleteError) {
        console.error('Error clearing unified_copy_path_analysis:', deleteError)
      }

      // Insert new results
      const { error: insertError } = await supabase
        .from('unified_copy_path_analysis')
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
        console.error('Error inserting unified copy path analysis:', insertError)
        throw insertError
      } else {
        console.log(`✅ Updated unified_copy_path_analysis with ${pathData.length} rows (2 analysis types × top 10)`)
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        rows_inserted: pathData?.length || 0,
        message: 'Unified copy path analysis complete'
      }),
      {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      }
    )
  } catch (error: any) {
    console.error('Error in analyze-copy-sequences:', error)

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
