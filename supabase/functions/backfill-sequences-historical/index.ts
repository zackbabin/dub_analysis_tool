// Supabase Edge Function: backfill-sequences-historical
// HISTORICAL BACKFILL: Fetches events for all users with KYC/first copy timestamps
//
// Dynamically calculates date range from user_first_copies:
// - fromDate: earliest kyc_approved_time (with 1 day buffer)
// - toDate: latest first_copy_time (or today)
//
// Safe to run alongside live syncs:
// - Uses same upsert logic with deduplication via unique constraints
// - Only fetches for users with both kyc_approved_time and first_copy_time
// - Batches requests to avoid timeouts and rate limits
//
// Usage: POST (no body needed - always syncs both portfolio and creator events)

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import {
  initializeMixpanelCredentials,
  initializeSupabaseClient,
  handleCorsRequest,
  createSuccessResponse,
  createErrorResponse,
} from '../_shared/sync-helpers.ts'
import { MIXPANEL_CONFIG } from '../_shared/mixpanel-api.ts'

interface MixpanelExportEvent {
  event: string
  properties: {
    time: number
    distinct_id?: string
    $distinct_id_before_identity?: string
    $insert_id: string
    $email?: string
    portfolioTicker?: string
    creatorUsername?: string
    [key: string]: any
  }
}

// No request interface needed - always syncs both types

/**
 * Fetch events from Mixpanel Export API with streaming processing
 */
async function fetchAndProcessEventsStreaming(
  credentials: { username: string; secret: string },
  fromDate: string,
  toDate: string,
  eventNames: string[],
  userIds: string[] | undefined,
  onBatch: (events: MixpanelExportEvent[]) => Promise<void>,
  batchSize = 5000
): Promise<{ totalEvents: number }> {
  const { username, secret } = credentials
  const projectId = MIXPANEL_CONFIG.PROJECT_ID

  const eventArray = JSON.stringify(eventNames)
  const eventParam = `event=${encodeURIComponent(eventArray)}`

  let whereParam = ''
  if (userIds && userIds.length > 0) {
    const idsArray = JSON.stringify(userIds)
    const whereClause = `properties["$user_id"] in ${idsArray}`
    whereParam = `&where=${encodeURIComponent(whereClause)}`
  }

  const url = `https://data.mixpanel.com/api/2.0/export?project_id=${projectId}&from_date=${fromDate}&to_date=${toDate}&${eventParam}${whereParam}`

  console.log(`Fetching from Export API: ${fromDate} to ${toDate}`)
  console.log(`Events: ${eventNames.join(', ')}`)
  if (userIds && userIds.length > 0) {
    console.log(`User filter: ${userIds.length} user_ids`)
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 300000) // 5 min timeout for backfill

  let lineCount = 0

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'text/plain',
        'Authorization': `Basic ${btoa(`${username}:${secret}`)}`,
      },
      signal: controller.signal,
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`Mixpanel Export API error (${response.status}):`, errorText)
      throw new Error(`Mixpanel Export API failed: ${response.status}`)
    }

    console.log('Streaming response...')
    let eventBatch: MixpanelExportEvent[] = []
    let buffer = ''

    const reader = response.body?.getReader()
    if (!reader) throw new Error('Response body not readable')

    const decoder = new TextDecoder()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value, { stream: true })
      buffer += chunk

      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmedLine = line.trim()
        if (!trimmedLine) continue

        try {
          const event = JSON.parse(trimmedLine)
          eventBatch.push(event)
          lineCount++

          if (eventBatch.length >= batchSize) {
            console.log(`Processing batch at ${lineCount} events`)
            await onBatch(eventBatch)
            eventBatch = []
          }
        } catch (parseError) {
          // Skip unparseable lines
        }
      }
    }

    // Process remaining buffer
    if (buffer.trim()) {
      try {
        const event = JSON.parse(buffer.trim())
        eventBatch.push(event)
        lineCount++
      } catch (parseError) {
        // Skip
      }
    }

    // Process final batch
    if (eventBatch.length > 0) {
      console.log(`Processing final batch of ${eventBatch.length} events`)
      await onBatch(eventBatch)
    }

    clearTimeout(timeoutId)
    console.log(`✓ Fetched and processed ${lineCount} events`)
    return { totalEvents: lineCount }
  } catch (error: any) {
    clearTimeout(timeoutId)
    if (error.name === 'AbortError') {
      throw new Error('Mixpanel Export API request timed out')
    }
    throw error
  }
}

/**
 * Backfill portfolio sequences
 */
async function backfillPortfolioSequences(
  supabase: any,
  credentials: any,
  fromDate: string,
  toDate: string,
  targetUserIds: string[]
) {
  console.log('\n📊 Backfilling Portfolio Sequences...')

  const eventNames = ['Viewed Portfolio Details']
  let totalInserted = 0

  const processBatch = async (events: MixpanelExportEvent[]) => {
    const rawEventRows = []
    for (const event of events) {
      const eventTime = new Date(event.properties.time * 1000).toISOString()
      const userId = event.properties.$user_id
      const portfolioTicker = event.properties.portfolioTicker

      if (!userId || !portfolioTicker) continue

      rawEventRows.push({
        user_id: userId,
        event_name: event.event,
        event_time: eventTime,
        portfolio_ticker: portfolioTicker
      })
    }

    if (rawEventRows.length === 0) return

    const { error: insertError } = await supabase
      .from('portfolio_sequences_raw')
      .upsert(rawEventRows, {
        onConflict: 'user_id,event_time,portfolio_ticker',
        ignoreDuplicates: true
      })

    if (insertError) {
      console.error('Error inserting batch:', insertError)
      throw insertError
    }

    totalInserted += rawEventRows.length
    console.log(`  ✓ Inserted ${rawEventRows.length} portfolio events (${totalInserted} total)`)
  }

  // Batch user IDs to avoid URL length limits
  const MAX_USER_IDS_PER_REQUEST = 500
  let totalEventsFetched = 0

  if (targetUserIds.length > MAX_USER_IDS_PER_REQUEST) {
    console.log(`Batching ${targetUserIds.length} user IDs into chunks of ${MAX_USER_IDS_PER_REQUEST}`)

    for (let i = 0; i < targetUserIds.length; i += MAX_USER_IDS_PER_REQUEST) {
      const batchUserIds = targetUserIds.slice(i, Math.min(i + MAX_USER_IDS_PER_REQUEST, targetUserIds.length))
      console.log(`  Batch ${Math.floor(i / MAX_USER_IDS_PER_REQUEST) + 1}/${Math.ceil(targetUserIds.length / MAX_USER_IDS_PER_REQUEST)} (${batchUserIds.length} users)`)

      const result = await fetchAndProcessEventsStreaming(
        credentials,
        fromDate,
        toDate,
        eventNames,
        batchUserIds,
        processBatch,
        2500
      )
      totalEventsFetched += result.totalEvents
      console.log(`  ✓ Batch fetched ${result.totalEvents} events`)

      // Rate limit delay
      if (i + MAX_USER_IDS_PER_REQUEST < targetUserIds.length) {
        await new Promise(resolve => setTimeout(resolve, 500))
      }
    }
  } else {
    const result = await fetchAndProcessEventsStreaming(
      credentials,
      fromDate,
      toDate,
      eventNames,
      targetUserIds,
      processBatch,
      2500
    )
    totalEventsFetched = result.totalEvents
  }

  console.log(`✅ Portfolio backfill complete: ${totalInserted} events inserted`)
  return { eventsFetched: totalEventsFetched, eventsInserted: totalInserted }
}

/**
 * Backfill creator sequences
 */
async function backfillCreatorSequences(
  supabase: any,
  credentials: any,
  fromDate: string,
  toDate: string,
  targetUserIds: string[]
) {
  console.log('\n📊 Backfilling Creator Sequences...')

  const eventNames = ['Viewed Creator Profile']
  let totalInserted = 0

  const processBatch = async (events: MixpanelExportEvent[]) => {
    const rawEventRows = []
    for (const event of events) {
      const eventTime = new Date(event.properties.time * 1000).toISOString()
      const userId = event.properties.$user_id
      const creatorUsername = event.properties.creatorUsername

      if (!userId || !creatorUsername) continue

      rawEventRows.push({
        user_id: userId,
        event_name: event.event,
        event_time: eventTime,
        creator_username: creatorUsername
      })
    }

    if (rawEventRows.length === 0) return

    const { error: insertError } = await supabase
      .from('creator_sequences_raw')
      .upsert(rawEventRows, {
        onConflict: 'user_id,event_time,creator_username',
        ignoreDuplicates: true
      })

    if (insertError) {
      console.error('Error inserting batch:', insertError)
      throw insertError
    }

    totalInserted += rawEventRows.length
    console.log(`  ✓ Inserted ${rawEventRows.length} creator events (${totalInserted} total)`)
  }

  // Batch user IDs
  const MAX_USER_IDS_PER_REQUEST = 500
  let totalEventsFetched = 0

  if (targetUserIds.length > MAX_USER_IDS_PER_REQUEST) {
    console.log(`Batching ${targetUserIds.length} user IDs into chunks of ${MAX_USER_IDS_PER_REQUEST}`)

    for (let i = 0; i < targetUserIds.length; i += MAX_USER_IDS_PER_REQUEST) {
      const batchUserIds = targetUserIds.slice(i, Math.min(i + MAX_USER_IDS_PER_REQUEST, targetUserIds.length))
      console.log(`  Batch ${Math.floor(i / MAX_USER_IDS_PER_REQUEST) + 1}/${Math.ceil(targetUserIds.length / MAX_USER_IDS_PER_REQUEST)} (${batchUserIds.length} users)`)

      const result = await fetchAndProcessEventsStreaming(
        credentials,
        fromDate,
        toDate,
        eventNames,
        batchUserIds,
        processBatch,
        2500
      )
      totalEventsFetched += result.totalEvents
      console.log(`  ✓ Batch fetched ${result.totalEvents} events`)

      // Rate limit delay
      if (i + MAX_USER_IDS_PER_REQUEST < targetUserIds.length) {
        await new Promise(resolve => setTimeout(resolve, 500))
      }
    }
  } else {
    const result = await fetchAndProcessEventsStreaming(
      credentials,
      fromDate,
      toDate,
      eventNames,
      targetUserIds,
      processBatch,
      2500
    )
    totalEventsFetched = result.totalEvents
  }

  console.log(`✅ Creator backfill complete: ${totalInserted} events inserted`)
  return { eventsFetched: totalEventsFetched, eventsInserted: totalInserted }
}

serve(async (req) => {
  const corsResponse = handleCorsRequest(req)
  if (corsResponse) return corsResponse

  try {
    const credentials = initializeMixpanelCredentials()
    const supabase = initializeSupabaseClient()

    console.log('🔄 Starting historical backfill (portfolio + creator events)...')

    // Get target user IDs AND date range from user_first_copies
    console.log('\n📊 Fetching users and calculating date range from user_first_copies...')
    const { data: firstCopyUsers, error: usersError } = await supabase
      .from('user_first_copies')
      .select('user_id, kyc_approved_time, first_copy_time')
      .not('kyc_approved_time', 'is', null)
      .not('first_copy_time', 'is', null)

    if (usersError) {
      console.error('Error fetching user_first_copies:', usersError)
      throw usersError
    }

    if (!firstCopyUsers || firstCopyUsers.length === 0) {
      throw new Error('No users found with both kyc_approved_time and first_copy_time')
    }

    const targetUserIds = firstCopyUsers.map(u => u.user_id)
    console.log(`✓ Found ${targetUserIds.length} users with both timestamps`)

    // Calculate date range from actual user data
    const kycTimes = firstCopyUsers.map(u => new Date(u.kyc_approved_time).getTime())
    const copyTimes = firstCopyUsers.map(u => new Date(u.first_copy_time).getTime())

    const earliestKyc = new Date(Math.min(...kycTimes))
    const latestFirstCopy = new Date(Math.max(...copyTimes))
    const today = new Date()

    // Add 1 day buffer before earliest KYC
    const bufferStart = new Date(earliestKyc.getTime() - 24 * 60 * 60 * 1000)
    const fromDate = bufferStart.toISOString().split('T')[0]

    // Use today or latest first copy, whichever is later
    const endDate = latestFirstCopy > today ? latestFirstCopy : today
    const toDate = endDate.toISOString().split('T')[0]

    const daysDiff = Math.ceil((endDate.getTime() - bufferStart.getTime()) / (24 * 60 * 60 * 1000))
    console.log(`Date range: ${fromDate} to ${toDate} (${daysDiff} days)`)
    console.log(`   Earliest KYC: ${earliestKyc.toISOString().split('T')[0]}`)
    console.log(`   Latest first copy: ${latestFirstCopy.toISOString().split('T')[0]}`)

    // Execute both backfills
    const portfolioStats = await backfillPortfolioSequences(
      supabase,
      credentials,
      fromDate,
      toDate,
      targetUserIds
    )

    const creatorStats = await backfillCreatorSequences(
      supabase,
      credentials,
      fromDate,
      toDate,
      targetUserIds
    )

    const results = {
      fromDate,
      toDate,
      targetUsers: targetUserIds.length,
      portfolio: portfolioStats,
      creator: creatorStats,
    }

    console.log('\n✅ Historical backfill completed successfully!')
    console.log('Results:', JSON.stringify(results, null, 2))

    return createSuccessResponse(
      'Historical backfill completed',
      results
    )
  } catch (error) {
    return createErrorResponse(error, 'backfill-sequences-historical')
  }
})
