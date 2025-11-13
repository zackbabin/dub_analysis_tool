// Supabase Edge Function: fetch-mixpanel-marketing
// Fetches a single Mixpanel Insights chart by ID
// Used for marketing metrics (e.g., Avg Monthly Copies from chart 86100814)

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { fetchInsightsData } from '../_shared/mixpanel-api.ts'
import {
  initializeMixpanelCredentials,
  handleCorsRequest,
  createSuccessResponse,
  createErrorResponse,
} from '../_shared/sync-helpers.ts'

serve(async (req) => {
  // Handle CORS preflight requests
  const corsResponse = handleCorsRequest(req)
  if (corsResponse) return corsResponse

  try {
    // Initialize Mixpanel credentials
    const credentials = initializeMixpanelCredentials()

    // Get chart ID from request body
    const body = await req.json()
    const chartId = body.chartId

    if (!chartId) {
      throw new Error('Missing chartId parameter')
    }

    console.log(`Fetching Mixpanel chart ${chartId}...`)

    // Fetch chart data from Mixpanel
    const chartData = await fetchInsightsData(credentials, chartId, `Chart ${chartId}`)

    console.log(`✅ Successfully fetched chart ${chartId}`)

    return createSuccessResponse(
      'Chart data fetched successfully',
      chartData
    )
  } catch (error) {
    return createErrorResponse(error, 'fetch-mixpanel-marketing')
  }
})
