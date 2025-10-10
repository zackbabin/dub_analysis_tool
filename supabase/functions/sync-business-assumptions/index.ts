// Supabase Edge Function: sync-business-assumptions
// Fetches business assumptions data from Mixpanel API and stores averaged values
// Triggered manually by user clicking "Sync" button in Business Model Analysis

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Configuration
const PROJECT_ID = '2599235'
const MIXPANEL_API_BASE = 'https://mixpanel.com/api'
const CHART_ID = '85270536' // Business Assumptions Chart

interface MixpanelCredentials {
  username: string
  secret: string
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Get Mixpanel credentials from Supabase secrets
    const mixpanelUsername = Deno.env.get('MIXPANEL_SERVICE_USERNAME')
    const mixpanelSecret = Deno.env.get('MIXPANEL_SERVICE_SECRET')

    if (!mixpanelUsername || !mixpanelSecret) {
      throw new Error('Mixpanel credentials not configured in Supabase secrets')
    }

    console.log('Mixpanel credentials loaded from secrets')

    // Initialize Supabase client with service role key
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    console.log('Starting Business Assumptions sync...')

    const syncStartTime = new Date()
    const credentials: MixpanelCredentials = {
      username: mixpanelUsername,
      secret: mixpanelSecret,
    }

    // Fetch data from Mixpanel
    const data = await fetchBusinessAssumptionsData(credentials)

    // Log available series keys for debugging
    console.log('Available series keys:', Object.keys(data.series || {}))

    // Calculate averages with fallback
    const totalRebalances = calculateAverage(
      data.series['A. Total Rebalances'] || data.series['Rebalances per user']
    )

    const tradesPerUser = calculateAverage(data.series['Trades per user'])

    const portfoliosCreatedPerUser = calculateAverage(data.series['Portfolios Created per user'])

    console.log('Calculated averages:', {
      totalRebalances,
      tradesPerUser,
      portfoliosCreatedPerUser,
    })

    // Store in database
    const { error: upsertError } = await supabase
      .from('business_assumptions')
      .upsert({
        id: 1, // Single row for current values
        total_rebalances: totalRebalances,
        trades_per_user: tradesPerUser,
        portfolios_created_per_user: portfoliosCreatedPerUser,
        synced_at: new Date().toISOString(),
      })

    if (upsertError) {
      console.error('Error upserting business assumptions:', upsertError)
      throw upsertError
    }

    console.log('Business Assumptions sync completed successfully')

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Business assumptions synced successfully',
        data: {
          totalRebalances,
          tradesPerUser,
          portfoliosCreatedPerUser,
        },
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error) {
    console.error('Error in sync-business-assumptions function:', error)

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    )
  }
})

// ============================================================================
// Helper Functions
// ============================================================================

async function fetchBusinessAssumptionsData(credentials: MixpanelCredentials) {
  console.log(`Fetching Business Assumptions data (Chart ID: ${CHART_ID})...`)

  const params = new URLSearchParams({
    project_id: PROJECT_ID,
    bookmark_id: CHART_ID,
  })

  const authString = `${credentials.username}:${credentials.secret}`
  const authHeader = `Basic ${btoa(authString)}`

  const response = await fetch(`${MIXPANEL_API_BASE}/query/insights?${params}`, {
    method: 'GET',
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Mixpanel API error (${response.status}): ${errorText}`)
  }

  const data = await response.json()
  console.log('✓ Business Assumptions fetch successful')
  return data
}

function calculateAverage(seriesData: Record<string, number> | undefined | null): number {
  if (!seriesData) return 0

  const values = Object.values(seriesData)
  if (values.length === 0) return 0

  const sum = values.reduce((acc, val) => acc + val, 0)
  return sum / values.length
}
