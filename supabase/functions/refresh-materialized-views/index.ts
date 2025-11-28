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

    // Use centralized refresh function that refreshes all 3 materialized views:
    // 1. main_analysis
    // 2. portfolio_creator_engagement_metrics
    // 3. enriched_support_conversations
    //
    // Note: copy_engagement_summary, subscription_engagement_summary, and hidden_gems_portfolios
    // are now regular views that auto-update when their underlying materialized views refresh
    console.log('Calling refresh_all_materialized_views...')
    const { data: refreshResult, error: refreshError } = await supabase.rpc('refresh_all_materialized_views')
    if (refreshError) {
      console.error('❌ refresh_all_materialized_views failed:', refreshError)
      throw refreshError
    }
    console.log('✓ All materialized views refreshed:', refreshResult)

    console.log('✅ Materialized view refresh complete')

    return createSuccessResponse(
      'Materialized views refreshed successfully',
      {
        result: refreshResult,
        views_refreshed: 3,
        views: ['main_analysis', 'portfolio_creator_engagement_metrics', 'enriched_support_conversations']
      }
    )
  } catch (error) {
    return createErrorResponse(error, 'refresh-materialized-views')
  }
})
