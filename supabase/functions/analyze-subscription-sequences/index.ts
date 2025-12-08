// Supabase Edge Function: analyze-subscription-sequences
// Analyzes creator and portfolio viewing patterns before first subscription
// Mirrors analyze-creator-sequences and analyze-portfolio-sequences but for subscriptions
//
// Data sources:
//   - creator_sequences_raw: Raw creator view events
//   - portfolio_sequences_raw: Raw portfolio view events
//   - user_first_subscriptions: Users with first_subscription_time
//
// Analysis filters events before first_subscription_time for each user

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
    console.log('Starting subscription sequence analysis...')

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // ============================================================================
    // CREATOR SUBSCRIPTION PATHS
    // ============================================================================

    console.log('Analyzing creator subscription paths via SQL...')
    const { data: creatorPathData, error: creatorPathError } = await supabase
      .rpc('analyze_creator_subscription_paths')

    if (creatorPathError) {
      console.error('Error analyzing creator subscription paths:', creatorPathError)
      throw creatorPathError
    }

    console.log(`✅ Creator subscription paths analyzed - ${creatorPathData?.length || 0} results returned`)

    // Clear existing path analysis and insert new results
    if (creatorPathData && creatorPathData.length > 0) {
      console.log('Updating creator_subscription_path_analysis table...')

      // Delete existing rows
      const { error: deleteError } = await supabase
        .from('creator_subscription_path_analysis')
        .delete()
        .neq('id', 0) // Delete all rows

      if (deleteError) {
        console.error('Error clearing creator_subscription_path_analysis:', deleteError)
      }

      // Insert new results
      const { error: insertError } = await supabase
        .from('creator_subscription_path_analysis')
        .insert(creatorPathData.map(row => ({
          analysis_type: row.analysis_type,
          path_rank: row.path_rank,
          creator_sequence: row.creator_sequence,
          converter_count: row.converter_count,
          pct_of_converters: row.pct_of_converters,
          total_converters_analyzed: row.total_converters_analyzed,
          updated_at: new Date().toISOString()
        })))

      if (insertError) {
        console.error('Error inserting creator subscription path analysis:', insertError)
      } else {
        console.log(`✅ Updated creator_subscription_path_analysis with ${creatorPathData.length} rows`)
      }
    }

    // ============================================================================
    // PORTFOLIO SUBSCRIPTION PATHS
    // ============================================================================

    console.log('Analyzing portfolio subscription paths via SQL...')
    const { data: portfolioPathData, error: portfolioPathError } = await supabase
      .rpc('analyze_portfolio_subscription_paths')

    if (portfolioPathError) {
      console.error('Error analyzing portfolio subscription paths:', portfolioPathError)
      throw portfolioPathError
    }

    console.log(`✅ Portfolio subscription paths analyzed - ${portfolioPathData?.length || 0} results returned`)

    // Clear existing path analysis and insert new results
    if (portfolioPathData && portfolioPathData.length > 0) {
      console.log('Updating portfolio_subscription_path_analysis table...')

      // Delete existing rows
      const { error: deleteError } = await supabase
        .from('portfolio_subscription_path_analysis')
        .delete()
        .neq('id', 0) // Delete all rows

      if (deleteError) {
        console.error('Error clearing portfolio_subscription_path_analysis:', deleteError)
      }

      // Insert new results
      const { error: insertError } = await supabase
        .from('portfolio_subscription_path_analysis')
        .insert(portfolioPathData.map(row => ({
          analysis_type: row.analysis_type,
          path_rank: row.path_rank,
          portfolio_sequence: row.portfolio_sequence,
          converter_count: row.converter_count,
          pct_of_converters: row.pct_of_converters,
          total_converters_analyzed: row.total_converters_analyzed,
          updated_at: new Date().toISOString()
        })))

      if (insertError) {
        console.error('Error inserting portfolio subscription path analysis:', insertError)
      } else {
        console.log(`✅ Updated portfolio_subscription_path_analysis with ${portfolioPathData.length} rows`)
      }
    }

    console.log('✅ Subscription sequence analysis complete')

    return new Response(
      JSON.stringify({
        success: true,
        creator_paths_analyzed: creatorPathData?.length || 0,
        portfolio_paths_analyzed: portfolioPathData?.length || 0,
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
