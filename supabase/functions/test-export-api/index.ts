// Test Edge Function for Mixpanel Export API
// Deploy and invoke to test the API response

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const PROJECT_ID = '2599235'

serve(async (_req) => {
  try {
    const username = Deno.env.get('MIXPANEL_SERVICE_USERNAME')
    const secret = Deno.env.get('MIXPANEL_SERVICE_SECRET')

    if (!username || !secret) {
      throw new Error('Mixpanel credentials not configured')
    }

    // Date range: last 3 days (small window for quick test)
    const today = new Date()
    const threeDaysAgo = new Date()
    threeDaysAgo.setDate(today.getDate() - 3)

    const toDate = today.toISOString().split('T')[0]
    const fromDate = threeDaysAgo.toISOString().split('T')[0]

    console.log(`Testing Mixpanel Export API from ${fromDate} to ${toDate}`)

    const authString = `${username}:${secret}`
    const authHeader = `Basic ${btoa(authString)}`

    const results = []

    // Test 1: Without filter
    console.log('\n=== Test 1: Without filter ===')
    const params1 = new URLSearchParams({
      project_id: PROJECT_ID,
      from_date: fromDate,
      to_date: toDate,
      event: '["Viewed Portfolio Details"]',
    })

    const start1 = Date.now()
    const response1 = await fetch(`https://data.mixpanel.com/api/2.0/export?${params1}`, {
      method: 'GET',
      headers: {
        Authorization: authHeader,
        Accept: 'application/json',
      },
    })

    if (!response1.ok) {
      const errorText = await response1.text()
      results.push({
        test: 'Without filter',
        status: 'error',
        error: `${response1.status}: ${errorText}`,
      })
    } else {
      const text1 = await response1.text()
      const lines1 = text1.trim().split('\n').filter(line => line.trim())
      const elapsed1 = Date.now() - start1

      let firstEventSample = null
      let hasEmail = false
      if (lines1.length > 0) {
        const firstEvent = JSON.parse(lines1[0])
        hasEmail = !!firstEvent.properties?.$email
        firstEventSample = {
          event: firstEvent.event,
          properties: Object.keys(firstEvent.properties || {}).slice(0, 15),
          has_email: hasEmail,
          distinct_id: firstEvent.properties?.distinct_id?.substring(0, 20) + '...',
          portfolio_ticker: firstEvent.properties?.portfolioTicker,
        }
      }

      results.push({
        test: 'Without filter',
        status: 'success',
        elapsed_ms: elapsed1,
        total_events: lines1.length,
        response_size_chars: text1.length,
        first_event: firstEventSample,
      })

      console.log(`✅ Fetched ${lines1.length} events in ${elapsed1}ms`)
    }

    // Test 2: With user["$email"] filter
    console.log('\n=== Test 2: With user["$email"] filter ===')
    const params2 = new URLSearchParams({
      project_id: PROJECT_ID,
      from_date: fromDate,
      to_date: toDate,
      event: '["Viewed Portfolio Details"]',
      where: 'defined(user["$email"])',
    })

    const start2 = Date.now()
    const response2 = await fetch(`https://data.mixpanel.com/api/2.0/export?${params2}`, {
      method: 'GET',
      headers: {
        Authorization: authHeader,
        Accept: 'application/json',
      },
    })

    if (!response2.ok) {
      const errorText = await response2.text()
      results.push({
        test: 'With user["$email"]',
        status: 'error',
        error: `${response2.status}: ${errorText}`,
      })
    } else {
      const text2 = await response2.text()
      const lines2 = text2.trim().split('\n').filter(line => line.trim())
      const elapsed2 = Date.now() - start2

      let firstEventSample = null
      let hasEmail = false
      if (lines2.length > 0) {
        const firstEvent = JSON.parse(lines2[0])
        hasEmail = !!firstEvent.properties?.$email
        firstEventSample = {
          event: firstEvent.event,
          properties: Object.keys(firstEvent.properties || {}).slice(0, 15),
          has_email: hasEmail,
          distinct_id: firstEvent.properties?.distinct_id?.substring(0, 20) + '...',
          portfolio_ticker: firstEvent.properties?.portfolioTicker,
        }
      }

      results.push({
        test: 'With user["$email"]',
        status: 'success',
        elapsed_ms: elapsed2,
        total_events: lines2.length,
        response_size_chars: text2.length,
        first_event: firstEventSample,
      })

      console.log(`✅ Fetched ${lines2.length} events in ${elapsed2}ms`)
    }

    // Test 3: With properties["$email"] filter (old syntax)
    console.log('\n=== Test 3: With properties["$email"] filter (old syntax) ===')
    const params3 = new URLSearchParams({
      project_id: PROJECT_ID,
      from_date: fromDate,
      to_date: toDate,
      event: '["Viewed Portfolio Details"]',
      where: 'defined(properties["$email"])',
    })

    const start3 = Date.now()
    const response3 = await fetch(`https://data.mixpanel.com/api/2.0/export?${params3}`, {
      method: 'GET',
      headers: {
        Authorization: authHeader,
        Accept: 'application/json',
      },
    })

    if (!response3.ok) {
      const errorText = await response3.text()
      results.push({
        test: 'With properties["$email"]',
        status: 'error',
        error: `${response3.status}: ${errorText}`,
      })
    } else {
      const text3 = await response3.text()
      const lines3 = text3.trim().split('\n').filter(line => line.trim())
      const elapsed3 = Date.now() - start3

      let firstEventSample = null
      let hasEmail = false
      if (lines3.length > 0) {
        const firstEvent = JSON.parse(lines3[0])
        hasEmail = !!firstEvent.properties?.$email
        firstEventSample = {
          event: firstEvent.event,
          properties: Object.keys(firstEvent.properties || {}).slice(0, 15),
          has_email: hasEmail,
          distinct_id: firstEvent.properties?.distinct_id?.substring(0, 20) + '...',
          portfolio_ticker: firstEvent.properties?.portfolioTicker,
        }
      }

      results.push({
        test: 'With properties["$email"]',
        status: 'success',
        elapsed_ms: elapsed3,
        total_events: lines3.length,
        response_size_chars: text3.length,
        first_event: firstEventSample,
      })

      console.log(`✅ Fetched ${lines3.length} events in ${elapsed3}ms`)
    }

    return new Response(
      JSON.stringify({
        success: true,
        date_range: { from: fromDate, to: toDate },
        results,
      }, null, 2),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error) {
    console.error('Test failed:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message || String(error),
        details: error?.stack || '',
      }, null, 2),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 500,
      }
    )
  }
})
