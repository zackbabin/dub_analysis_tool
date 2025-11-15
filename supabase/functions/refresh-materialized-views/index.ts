// Supabase Edge Function: refresh-materialized-views
// Refreshes ALL materialized views after data sync operations
// Triggered by sync-mixpanel-engagement and other sync functions
// Ensures dashboard displays latest data from underlying tables

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

    console.log('Starting materialized view refresh...')

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

    // Step 2: Refresh main_analysis (foundational view)
    // MUST run before views that depend on it (copy/subscription summaries)
    console.log('Refreshing main_analysis view...')

    const { error: mainAnalysisError } = await supabase.rpc('refresh_main_analysis')

    if (mainAnalysisError) {
      console.error('Error refreshing main_analysis:', mainAnalysisError)
      throw mainAnalysisError
    }

    console.log('✓ main_analysis refreshed successfully')

    // Step 3: Refresh portfolio engagement views
    // Includes: portfolio_creator_engagement_metrics, hidden_gems, premium_creator_stock_holdings,
    //           top_stocks_all_premium_creators, premium_creator_top_5_stocks
    console.log('Refreshing portfolio engagement views...')

    const { error: portfolioRefreshError } = await supabase.rpc('refresh_portfolio_engagement_views')

    if (portfolioRefreshError) {
      console.error('Error refreshing portfolio engagement views:', portfolioRefreshError)
      throw portfolioRefreshError
    }

    console.log('✓ Portfolio engagement views refreshed successfully')

    // Step 4: Refresh portfolio_breakdown_with_metrics
    // Depends on portfolio_creator_engagement_metrics (refreshed in step 3)
    console.log('Refreshing portfolio_breakdown_with_metrics...')

    const { error: portfolioBreakdownError } = await supabase.rpc('refresh_portfolio_breakdown_view')

    if (portfolioBreakdownError) {
      console.warn('⚠️ Error refreshing portfolio_breakdown_with_metrics:', portfolioBreakdownError)
      // Non-fatal - continue with other refreshes
    } else {
      console.log('✓ portfolio_breakdown_with_metrics refreshed successfully')
    }

    // Step 5: Refresh premium_creator_retention_analysis
    // Depends on premium_creator_retention_events table
    console.log('Refreshing premium_creator_retention_analysis...')

    const { error: retentionError } = await supabase.rpc('refresh_premium_creator_retention_analysis')

    if (retentionError) {
      console.warn('⚠️ Error refreshing premium_creator_retention_analysis:', retentionError)
      // Non-fatal - continue with other refreshes
    } else {
      console.log('✓ premium_creator_retention_analysis refreshed successfully')
    }

    // Step 6: Refresh copy engagement summary (depends on main_analysis)
    console.log('Refreshing copy engagement summary view...')

    const copyResult = await supabase.rpc('refresh_copy_engagement_summary')

    if (copyResult.error) console.error('Error refreshing copy summary:', copyResult.error)

    console.log('✓ Copy engagement summary view refreshed')

    console.log('✅ All materialized views refreshed successfully')

    return createSuccessResponse(
      'All materialized views refreshed successfully',
      {
        main_analysis_refreshed: !mainAnalysisError,
        portfolio_views_refreshed: !portfolioRefreshError,
        portfolio_breakdown_refreshed: !portfolioBreakdownError,
        retention_analysis_refreshed: !retentionError,
        copy_engagement_summary_refreshed: !copyResult.error,
        pattern_analysis_triggered: true
      }
    )
  } catch (error) {
    return createErrorResponse(error, 'refresh-materialized-views')
  }
})
