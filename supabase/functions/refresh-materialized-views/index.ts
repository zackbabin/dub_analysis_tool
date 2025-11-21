// Supabase Edge Function: refresh-materialized-views
// Refreshes materialized views after data sync operations
// Triggered by sync-mixpanel-engagement and other sync functions
//
// MATERIALIZED VIEWS REFRESHED:
//   1. main_analysis - Primary user engagement view
//   2. portfolio_creator_engagement_metrics - Portfolio engagement aggregations
//   3. hidden_gems_portfolios - Low-copy high-engagement portfolios
//   4. premium_creator_stock_holdings - Stock holdings by creator (depends on engagement + CSV)
//   5. top_stocks_all_premium_creators - Top stocks across all creators
//   6. premium_creator_top_5_stocks - Top 5 stocks per creator
//   7. premium_creator_retention_analysis - Cohort retention analysis
//
// REGULAR VIEWS (no refresh needed):
//   - user_portfolio_creator_copies - Aggregates engagement by (user, portfolio)
//   - portfolio_breakdown_with_metrics - Joins engagement + CSV performance data
//   - premium_creator_breakdown - Aggregates portfolio_creator_engagement_metrics
//   - copy_engagement_summary - Aggregates main_analysis by did_copy
//
// NOTE: Stock holdings views (4-6) are refreshed both here AND in upload-portfolio-metrics
//       because they depend on engagement data (synced) AND CSV uploads (manual)

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

    // Step 2: Refresh main_analysis (contains unique_creators_viewed, unique_portfolios_viewed)
    // This is the primary materialized view for user engagement data
    console.log('Refreshing main_analysis...')

    const { error: mainAnalysisError } = await supabase.rpc('refresh_main_analysis')

    if (mainAnalysisError) {
      console.warn('⚠️ Error refreshing main_analysis:', mainAnalysisError)
      // Continue with other refreshes even if this fails
    } else {
      console.log('✓ main_analysis refreshed successfully')
    }

    // Step 3: user_portfolio_creator_copies is now a regular view (not materialized)
    // No refresh needed - updates automatically when underlying data changes
    console.log('ℹ️ user_portfolio_creator_copies is a regular view - no refresh needed')

    // Step 4: Refresh portfolio engagement views (includes stock holdings)
    // Refreshes: portfolio_creator_engagement_metrics, hidden_gems_portfolios,
    //            premium_creator_stock_holdings, top_stocks_all_premium_creators
    // Note: premium_creator_top_5_stocks is now a regular view (no refresh needed)
    // Note: Stock holdings views are also refreshed in upload-portfolio-metrics after CSV uploads
    console.log('Refreshing portfolio engagement and stock holdings views...')

    const { error: portfolioRefreshError } = await supabase.rpc('refresh_portfolio_engagement_views')

    if (portfolioRefreshError) {
      console.error('Error refreshing portfolio engagement views:', portfolioRefreshError)
      throw portfolioRefreshError
    }

    console.log('✓ Portfolio engagement and stock holdings views refreshed successfully')

    // Step 5: Regular views (no refresh needed)
    // - portfolio_breakdown_with_metrics: joins materialized views with CSV upload data
    // - premium_creator_breakdown: aggregates portfolio_creator_engagement_metrics
    console.log('ℹ️ portfolio_breakdown_with_metrics and premium_creator_breakdown are regular views - no refresh needed')

    // Step 6: Refresh premium_creator_retention_analysis
    // Depends on premium_creator_retention_events table
    console.log('Refreshing premium_creator_retention_analysis...')

    const { error: retentionError } = await supabase.rpc('refresh_premium_creator_retention_analysis')

    if (retentionError) {
      console.warn('⚠️ Error refreshing premium_creator_retention_analysis:', retentionError)
      // Non-fatal - continue with other refreshes
    } else {
      console.log('✓ premium_creator_retention_analysis refreshed successfully')
    }

    // Step 7: copy_engagement_summary is now a regular view (not materialized)
    // No refresh needed - updates automatically when main_analysis (materialized) changes
    console.log('ℹ️ copy_engagement_summary is a regular view - no refresh needed')

    // Step 8: Refresh enriched support conversations view
    // DISABLED: This view is expensive and causes database performance issues
    // Refresh manually when needed via direct RPC call
    console.log('ℹ️ enriched_support_conversations refresh skipped (refresh manually if needed)')

    console.log('✅ All materialized views refreshed successfully')

    return createSuccessResponse(
      'All materialized views refreshed successfully',
      {
        main_analysis_refreshed: !mainAnalysisError,
        user_portfolio_creator_copies: 'regular_view_no_refresh_needed',
        portfolio_views_refreshed: !portfolioRefreshError,
        portfolio_breakdown_with_metrics: 'regular_view_no_refresh_needed',
        premium_creator_breakdown: 'regular_view_no_refresh_needed',
        retention_analysis_refreshed: !retentionError,
        copy_engagement_summary: 'regular_view_no_refresh_needed',
        enriched_support_conversations_refreshed: 'skipped_manual_refresh_required',
        pattern_analysis_triggered: true
      }
    )
  } catch (error) {
    return createErrorResponse(error, 'refresh-materialized-views')
  }
})
