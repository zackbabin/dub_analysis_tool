import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import {
  initializeSupabaseClient,
  handleCorsRequest,
  createSuccessResponse,
  createErrorResponse,
} from '../_shared/sync-helpers.ts'

serve(async (req) => {
  const corsResponse = handleCorsRequest(req)
  if (corsResponse) return corsResponse

  try {
    const supabase = initializeSupabaseClient()

    console.log('Starting materialized view refresh...')

    // Note: main_analysis is now refreshed during Mixpanel sync workflow
    // (after all source data is populated in supabase_integration.js)

    // Refresh portfolio engagement views
    // This RPC refreshes 4 materialized views:
    // - portfolio_creator_engagement_metrics
    // - hidden_gems_portfolios
    // - premium_creator_stock_holdings
    // - top_stocks_all_premium_creators
    console.log('Refreshing portfolio_engagement_views...')
    const { error: portfolioRefreshError } = await supabase.rpc('refresh_portfolio_engagement_views')
    if (portfolioRefreshError) {
      console.error('❌ portfolio_engagement_views failed:', portfolioRefreshError)
      throw portfolioRefreshError
    }
    console.log('✓ portfolio_engagement_views refreshed')

    // Refresh premium_creator_retention_analysis
    console.log('Refreshing premium_creator_retention_analysis...')
    const { error: retentionError } = await supabase.rpc('refresh_premium_creator_retention_analysis')
    if (retentionError) {
      console.warn('⚠️ retention_analysis failed:', retentionError)
    } else {
      console.log('✓ retention_analysis refreshed')
    }

    console.log('✅ Materialized views refreshed')

    return createSuccessResponse(
      'Materialized views refreshed successfully',
      {
        portfolio_views_refreshed: !portfolioRefreshError,
        retention_analysis_refreshed: !retentionError
      }
    )
  } catch (error) {
    return createErrorResponse(error, 'refresh-materialized-views')
  }
})
