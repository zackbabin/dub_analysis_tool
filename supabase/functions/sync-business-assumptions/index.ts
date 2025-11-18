// Supabase Edge Function: sync-business-assumptions
// Fetches business assumptions data from Mixpanel API and stores averaged values
// Triggered manually by user clicking "Sync" button in Business Model Analysis

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Configuration
const PROJECT_ID = '2599235'
const MIXPANEL_API_BASE = 'https://mixpanel.com/api'
const CHART_ID = '85270536' // Business Assumptions Chart
const FUNNEL_ID = '85315048' // Conversion Funnel Chart

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

    console.log('Business Assumptions sync - Mixpanel API calls disabled')

    // NOTE: Mixpanel API calls commented out - business assumptions are manually maintained in database
    // const syncStartTime = new Date()
    // const credentials: MixpanelCredentials = {
    //   username: mixpanelUsername,
    //   secret: mixpanelSecret,
    // }

    // // Fetch data from Mixpanel in parallel
    // const [data, funnelData] = await Promise.all([
    //   fetchBusinessAssumptionsData(credentials),
    //   fetchConversionFunnelData(credentials)
    // ])

    // // Log available series keys for debugging
    // console.log('Available series keys:', Object.keys(data.series || {}))

    // // Calculate averages with fallback
    // const totalRebalances = calculateAverage(
    //   data.series['A. Total Rebalances'] || data.series['Rebalances per user']
    // )

    // const tradesPerUser = calculateAverage(data.series['Trades per user'])

    // const portfoliosCreatedPerUser = calculateAverage(data.series['Portfolios Created per user'])

    // console.log('Calculated averages:', {
    //   totalRebalances,
    //   tradesPerUser,
    //   portfoliosCreatedPerUser,
    // })

    // // Extract conversion rates from funnel
    // const conversionRates = extractConversionRates(funnelData)

    // console.log('Extracted conversion rates:', conversionRates)

    // // Store in database
    // const { error: upsertError } = await supabase
    //   .from('business_assumptions')
    //   .upsert({
    //     id: 1, // Single row for current values
    //     total_rebalances: totalRebalances,
    //     trades_per_user: tradesPerUser,
    //     portfolios_created_per_user: portfoliosCreatedPerUser,
    //     kyc_to_linked_bank: conversionRates.kycToLinkedBank,
    //     linked_bank_to_ach: conversionRates.linkedBankToAch,
    //     ach_to_copy: conversionRates.achToCopy,
    //     synced_at: new Date().toISOString(),
    //   })

    // if (upsertError) {
    //   console.error('Error upserting business assumptions:', upsertError)
    //   throw upsertError
    // }

    console.log('Business Assumptions sync completed (no Mixpanel fetch)')

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Business assumptions sync disabled - values manually maintained in database',
        disabled: true,
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

async function fetchConversionFunnelData(credentials: MixpanelCredentials) {
  console.log(`Fetching Conversion Funnel data (Funnel ID: ${FUNNEL_ID})...`)

  // Calculate date range: Aug 27, 2025 to today
  const fromDate = '2025-08-27'
  const toDate = new Date().toISOString().split('T')[0] // YYYY-MM-DD format

  const params = new URLSearchParams({
    project_id: PROJECT_ID,
    funnel_id: FUNNEL_ID,
    from_date: fromDate,
    to_date: toDate,
  })

  const authString = `${credentials.username}:${credentials.secret}`
  const authHeader = `Basic ${btoa(authString)}`

  const response = await fetch(`${MIXPANEL_API_BASE}/query/funnels?${params}`, {
    method: 'GET',
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Mixpanel Funnel API error (${response.status}): ${errorText}`)
  }

  const data = await response.json()
  console.log('✓ Conversion Funnel fetch successful')
  return data
}

function extractConversionRates(funnelData: any): {
  kycToLinkedBank: number
  linkedBankToAch: number
  achToCopy: number
} {
  // Initialize with defaults
  const conversionRates = {
    kycToLinkedBank: 0,
    linkedBankToAch: 0,
    achToCopy: 0,
  }

  if (!funnelData?.data) {
    console.warn('No funnel data available')
    return conversionRates
  }

  // Collect all step conversion ratios across all dates
  const kycToLinkedBankRates: number[] = []
  const linkedBankToAchRates: number[] = []
  const achToCopyRates: number[] = []

  // Iterate through all date entries
  for (const [date, dateData] of Object.entries(funnelData.data)) {
    const steps = (dateData as any)?.steps
    if (!steps || !Array.isArray(steps)) continue

    // Find the steps by their step_label
    // Step 1 -> Step 2: Approved KYC -> Linked Bank Account
    const linkedBankStep = steps.find((s: any) => s.step_label === 'Linked Bank Account')
    if (linkedBankStep?.step_conv_ratio !== undefined) {
      kycToLinkedBankRates.push(linkedBankStep.step_conv_ratio * 100) // Convert to percentage
    }

    // Step 2 -> Step 3: Linked Bank Account -> Initiated ACH Transfer
    const achStep = steps.find((s: any) => s.step_label === 'Initiated ACH Transfer')
    if (achStep?.step_conv_ratio !== undefined) {
      linkedBankToAchRates.push(achStep.step_conv_ratio * 100) // Convert to percentage
    }

    // Step 3 -> Step 4: Initiated ACH Transfer -> Copied Portfolio
    const copyStep = steps.find((s: any) => s.step_label === 'Copied Portfolio')
    if (copyStep?.step_conv_ratio !== undefined) {
      achToCopyRates.push(copyStep.step_conv_ratio * 100) // Convert to percentage
    }
  }

  // Calculate averages
  if (kycToLinkedBankRates.length > 0) {
    conversionRates.kycToLinkedBank = kycToLinkedBankRates.reduce((a, b) => a + b, 0) / kycToLinkedBankRates.length
  }

  if (linkedBankToAchRates.length > 0) {
    conversionRates.linkedBankToAch = linkedBankToAchRates.reduce((a, b) => a + b, 0) / linkedBankToAchRates.length
  }

  if (achToCopyRates.length > 0) {
    conversionRates.achToCopy = achToCopyRates.reduce((a, b) => a + b, 0) / achToCopyRates.length
  }

  console.log('Conversion rates extracted:', {
    kycToLinkedBank: `${conversionRates.kycToLinkedBank.toFixed(2)}%`,
    linkedBankToAch: `${conversionRates.linkedBankToAch.toFixed(2)}%`,
    achToCopy: `${conversionRates.achToCopy.toFixed(2)}%`,
    samplesCount: {
      kycToLinkedBank: kycToLinkedBankRates.length,
      linkedBankToAch: linkedBankToAchRates.length,
      achToCopy: achToCopyRates.length,
    }
  })

  return conversionRates
}
