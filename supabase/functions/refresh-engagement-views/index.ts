// Supabase Edge Function: refresh-engagement-views
// Handles materialized view refreshes and pattern analysis after engagement data sync
// Part 2 of engagement sync workflow - triggered by sync-mixpanel-engagement
// Separated to prevent timeouts by splitting compute-heavy work from data fetching

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import {
  initializeSupabaseClient,
  handleCorsRequest,
  createSuccessResponse,
  createErrorResponse,
} from '../_shared/sync-helpers.ts'

serve(async (req) => {
  // Handle CORS preflight requests
  const corsResponse = handleCorsRequest(req)
  if (corsResponse) return corsResponse

  try {
    const supabase = initializeSupabaseClient()

    console.log('Starting engagement views refresh...')

    // Get environment variables for pattern analysis triggers
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    // Step 1: Trigger pattern analysis functions (fire-and-forget)
    // These use stored engagement data - no Mixpanel calls
    console.log('Triggering pattern analysis functions...')

    if (supabaseUrl && supabaseServiceKey) {
      // Copy pattern analysis
      fetch(`${supabaseUrl}/functions/v1/analyze-conversion-patterns`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'apikey': supabaseServiceKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ analysis_type: 'copy' })
      }).catch((err) => {
        console.error('⚠️ Copy analysis failed to invoke:', err.message)
      })

      // Creator copy pattern analysis
      fetch(`${supabaseUrl}/functions/v1/analyze-conversion-patterns`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'apikey': supabaseServiceKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ analysis_type: 'creator_copy' })
      }).catch((err) => {
        console.error('⚠️ Creator copy analysis failed to invoke:', err.message)
      })

      console.log('✓ Pattern analysis functions triggered in background')
    } else {
      console.warn('⚠️ Cannot trigger pattern analysis: Supabase credentials not available')
    }

    // Step 2: Refresh main portfolio engagement views (includes premium_creator_breakdown)
    // This must run FIRST because other views depend on portfolio_creator_engagement_metrics
    console.log('Refreshing portfolio engagement views (portfolio_creator_engagement_metrics, hidden_gems, premium_creator_breakdown)...')

    const { error: portfolioRefreshError } = await supabase.rpc('refresh_portfolio_engagement_views')

    if (portfolioRefreshError) {
      console.error('Error refreshing portfolio engagement views:', portfolioRefreshError)
      throw portfolioRefreshError
    }

    console.log('✓ Portfolio engagement views refreshed successfully')

    // Step 3: Refresh dependent summary views (parallel - these don't depend on each other)
    console.log('Refreshing engagement summary views...')

    const [subResult, copyResult] = await Promise.all([
      supabase.rpc('refresh_subscription_engagement_summary'),
      supabase.rpc('refresh_copy_engagement_summary')
    ])

    if (subResult.error) console.error('Error refreshing subscription summary:', subResult.error)
    if (copyResult.error) console.error('Error refreshing copy summary:', copyResult.error)

    console.log('✓ Engagement summary views refreshed')

    console.log('Engagement views refresh completed successfully')

    return createSuccessResponse(
      'Engagement views refreshed successfully',
      {
        portfolio_views_refreshed: !portfolioRefreshError,
        summary_views_refreshed: !subResult.error && !copyResult.error,
        pattern_analysis_triggered: true
      }
    )
  } catch (error) {
    return createErrorResponse(error, 'refresh-engagement-views')
  }
})
