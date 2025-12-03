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

    // Use centralized refresh function that refreshes all materialized views + tables:
    // 1. main_analysis (materialized view)
    // 2. portfolio_creator_engagement_metrics (materialized view)
    // 3. premium_creator_affinity_display (materialized table)
    //
    // Note: enriched_support_conversations, copy_engagement_summary, hidden_gems_portfolios,
    // and other dependent views are regular views that auto-update
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
        views: [
          'main_analysis',
          'portfolio_creator_engagement_metrics',
          'premium_creator_affinity_display'
        ]
      }
    )
  } catch (error) {
    return createErrorResponse(error, 'refresh-materialized-views')
  }
})
