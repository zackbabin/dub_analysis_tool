// Supabase Edge Function: fetch-creator-retention
// Fetches creator subscription retention data from Mixpanel Retention API
// Analyzes SubscriptionCreated -> SubscriptionRenewed retention by creatorUsername

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { CORS_HEADERS } from '../_shared/mixpanel-api.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    const mixpanelUsername = Deno.env.get('MIXPANEL_SERVICE_USERNAME')
    const mixpanelSecret = Deno.env.get('MIXPANEL_SERVICE_SECRET')

    if (!mixpanelUsername || !mixpanelSecret) {
      throw new Error('Mixpanel credentials not configured in Supabase secrets')
    }

    // Create Basic Auth header
    const credentials = btoa(`${mixpanelUsername}:${mixpanelSecret}`)
    const authHeader = `Basic ${credentials}`

    // Calculate dates - from August 1, 2025 to today
    const toDate = new Date()
    const fromDate = new Date('2025-08-01')

    const formatDate = (date: Date) => {
      return date.toISOString().split('T')[0] // YYYY-MM-DD
    }

    // Build Mixpanel Retention API URL
    const params = new URLSearchParams({
      project_id: '2599235',
      from_date: formatDate(fromDate),
      to_date: formatDate(toDate),
      born_event: 'SubscriptionCreated',
      event: 'SubscriptionRenewed',
      interval_count: '6',
      unit: 'month',
      unbounded_retention: 'false',
      on: 'properties["creatorUsername"]'
    })

    const url = `https://mixpanel.com/api/query/retention?${params.toString()}`

    console.log('Fetching creator retention from Mixpanel...')
    console.log('Date range:', formatDate(fromDate), 'to', formatDate(toDate))

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'accept': 'application/json',
        'authorization': authHeader
      }
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Mixpanel API error:', response.status, errorText)
      throw new Error(`Mixpanel API error: ${response.status} - ${errorText}`)
    }

    const retentionData = await response.json()
    console.log('✅ Received retention data for', Object.keys(retentionData).length, 'cohorts')

    // Parse retention data into a more usable format
    const parsedData = parseRetentionData(retentionData)

    return new Response(
      JSON.stringify({
        success: true,
        data: parsedData,
        rawData: retentionData,
        dateRange: {
          from: formatDate(fromDate),
          to: formatDate(toDate)
        }
      }),
      {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        status: 200
      }
    )
  } catch (error) {
    console.error('Error in fetch-creator-retention function:', error)

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }),
      {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        status: 500
      }
    )
  }
})

/**
 * Parse Mixpanel retention data into a structured format
 *
 * Input format:
 * {
 *   "2025-08-01T00:00:00": {
 *     "first": 8896,
 *     "counts": [3070, 552, 251, 7]
 *   },
 *   ...
 * }
 *
 * Output format:
 * {
 *   cohorts: [
 *     {
 *       cohortDate: "2025-08-01",
 *       firstCount: 8896,
 *       retentionByPeriod: [
 *         { period: 1, count: 3070, rate: 34.5 },
 *         { period: 2, count: 552, rate: 6.2 },
 *         ...
 *       ]
 *     },
 *     ...
 *   ],
 *   summary: {
 *     totalFirstEvents: 25837,
 *     avgRetentionMonth1: 28.9,
 *     avgRetentionMonth2: 7.8,
 *     ...
 *   }
 * }
 */
function parseRetentionData(rawData: any) {
  const cohorts = []
  const summaryStats = {
    totalFirstEvents: 0,
    retentionByPeriod: [] as Array<{ period: number, totalCount: number, avgRate: number }>
  }

  // Parse each cohort
  for (const [cohortDate, cohortData] of Object.entries(rawData)) {
    const data = cohortData as any
    const firstCount = data.first || 0
    summaryStats.totalFirstEvents += firstCount

    const retentionByPeriod = (data.counts || []).map((count: number, index: number) => ({
      period: index + 1,
      count: count,
      rate: firstCount > 0 ? (count / firstCount) * 100 : 0
    }))

    cohorts.push({
      cohortDate: cohortDate.split('T')[0], // Extract YYYY-MM-DD
      firstCount,
      retentionByPeriod
    })
  }

  // Calculate average retention rates by period
  const maxPeriods = Math.max(...cohorts.map(c => c.retentionByPeriod.length))

  for (let period = 1; period <= maxPeriods; period++) {
    let totalCount = 0
    let totalRate = 0
    let cohortsWithPeriod = 0

    cohorts.forEach(cohort => {
      const periodData = cohort.retentionByPeriod.find(r => r.period === period)
      if (periodData) {
        totalCount += periodData.count
        totalRate += periodData.rate
        cohortsWithPeriod++
      }
    })

    summaryStats.retentionByPeriod.push({
      period,
      totalCount,
      avgRate: cohortsWithPeriod > 0 ? totalRate / cohortsWithPeriod : 0
    })
  }

  return {
    cohorts,
    summary: summaryStats
  }
}
