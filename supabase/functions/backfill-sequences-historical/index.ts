// Supabase Edge Function: backfill-sequences-historical
// HISTORICAL BACKFILL: Fetches first copy + KYC times, then events
//
// Process:
// 1. Fetch first copy times from chart 86612901 (by month to avoid 3k limit)
// 2. Fetch KYC approved times from chart 87036512 (by month to avoid 3k limit)
// 3. Upsert to user_first_copies with both timestamps
// 4. Fetch portfolio and creator view events for those users
//
// Date range splitting:
// - Splits July 1 - today into monthly chunks
// - Each month fetches separately to avoid Mixpanel segmentation limits
// - Uses upsert with deduplication for all operations
//
// Usage: POST (no body needed - always syncs everything)

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
 * Fetch first copy and KYC times from Insights API for a specific date range
 * Returns users with their timestamps
 */
async function fetchUserTimestampsForDateRange(
  credentials: { username: string; secret: string },
  fromDate: string,
  toDate: string,
  projectId: string
): Promise<{ user_id: string; first_copy_time: string | null; kyc_approved_time: string | null }[]> {
  const authString = `${credentials.username}:${credentials.secret}`
  const authHeader = `Basic ${btoa(authString)}`

  console.log(`  Fetching timestamps for ${fromDate} to ${toDate}...`)

  // Fetch first copy chart (86612901)
  const firstCopyChartUrl = `https://mixpanel.com/api/query/insights?project_id=${projectId}&bookmark_id=86612901&from_date=${fromDate}&to_date=${toDate}`
  const firstCopyResponse = await fetch(firstCopyChartUrl, {
    headers: { 'Authorization': authHeader, 'Accept': 'application/json' }
  })

  if (!firstCopyResponse.ok) {
    throw new Error(`First copy chart API failed: ${firstCopyResponse.status}`)
  }

  const firstCopyData = await firstCopyResponse.json()
  const firstCopySeries = firstCopyData.series?.['Uniques of Copied Portfolio'] || {}

  // Fetch KYC approved chart (87036512)
  const kycChartUrl = `https://mixpanel.com/api/query/insights?project_id=${projectId}&bookmark_id=87036512&from_date=${fromDate}&to_date=${toDate}`
  const kycResponse = await fetch(kycChartUrl, {
    headers: { 'Authorization': authHeader, 'Accept': 'application/json' }
  })

  if (!kycResponse.ok) {
    throw new Error(`KYC chart API failed: ${kycResponse.status}`)
  }

  const kycData = await kycResponse.json()
  const kycSeries = kycData.series?.['Uniques of Approved KYC'] || {}

  // Build a map of user_id -> timestamps
  const userMap = new Map<string, { first_copy_time: string | null; kyc_approved_time: string | null }>()

  // Parse first copy times
  for (const [userId, userIdData] of Object.entries(firstCopySeries)) {
    if (userId === '$overall' || !userId) continue
    if (!userIdData || typeof userIdData !== 'object') continue

    const timestamps = Object.keys(userIdData as Record<string, any>)
    const firstCopyTime = timestamps.find(k => k !== '$overall')

    if (firstCopyTime) {
      try {
        const date = new Date(firstCopyTime)
        if (!isNaN(date.getTime())) {
          userMap.set(userId, { first_copy_time: date.toISOString(), kyc_approved_time: null })
        }
      } catch (e) {
        // Skip invalid dates
      }
    }
  }

  // Parse KYC approved times
  for (const [userId, userIdData] of Object.entries(kycSeries)) {
    if (userId === '$overall' || !userId) continue
    if (!userIdData || typeof userIdData !== 'object') continue

    const timestamps = Object.keys(userIdData as Record<string, any>)
    const kycApprovedTime = timestamps.find(k => k !== '$overall')

    if (kycApprovedTime) {
      try {
        const date = new Date(kycApprovedTime)
        if (!isNaN(date.getTime())) {
          const existing = userMap.get(userId)
          if (existing) {
            existing.kyc_approved_time = date.toISOString()
          } else {
            userMap.set(userId, { first_copy_time: null, kyc_approved_time: date.toISOString() })
          }
        }
      } catch (e) {
        // Skip invalid dates
      }
    }
  }

  const users = Array.from(userMap.entries()).map(([user_id, timestamps]) => ({
    user_id,
    first_copy_time: timestamps.first_copy_time,
    kyc_approved_time: timestamps.kyc_approved_time
  }))

  console.log(`  ✓ Found ${users.length} users (first_copy: ${Object.keys(firstCopySeries).length - 1}, kyc: ${Object.keys(kycSeries).length - 1})`)

  return users
}

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

    console.log('🔄 Starting historical backfill...')
    console.log('Step 1: Fetch first copy + KYC times by month')
    console.log('Step 2: Fetch portfolio + creator view events')

    const projectId = MIXPANEL_CONFIG.PROJECT_ID

    // STEP 1: Fetch user timestamps by month (to avoid 3k segmentation limit)
    console.log('\n📊 Step 1: Fetching user timestamps (split by month)...')

    // Generate monthly date ranges from July 1, 2025 to today
    const startDate = new Date('2025-07-01')
    const today = new Date()
    const monthRanges: { from: string; to: string }[] = []

    let currentDate = new Date(startDate)
    while (currentDate <= today) {
      const monthStart = new Date(currentDate)
      const monthEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0) // Last day of month

      // Don't go past today
      const rangeEnd = monthEnd > today ? today : monthEnd

      monthRanges.push({
        from: monthStart.toISOString().split('T')[0],
        to: rangeEnd.toISOString().split('T')[0]
      })

      // Move to next month
      currentDate.setMonth(currentDate.getMonth() + 1)
      currentDate.setDate(1)
    }

    console.log(`Split into ${monthRanges.length} monthly ranges`)

    // Fetch timestamps for each month
    let allUserTimestamps: { user_id: string; first_copy_time: string | null; kyc_approved_time: string | null }[] = []

    for (const range of monthRanges) {
      console.log(`Fetching ${range.from} to ${range.to}...`)
      const users = await fetchUserTimestampsForDateRange(credentials, range.from, range.to, projectId)
      allUserTimestamps = allUserTimestamps.concat(users)

      // Rate limit: wait 500ms between requests
      await new Promise(resolve => setTimeout(resolve, 500))
    }

    console.log(`✓ Fetched ${allUserTimestamps.length} total user timestamp records`)

    // Deduplicate users (keep the record with most complete data)
    const userMap = new Map<string, { first_copy_time: string | null; kyc_approved_time: string | null }>()

    for (const user of allUserTimestamps) {
      const existing = userMap.get(user.user_id)
      if (!existing) {
        userMap.set(user.user_id, {
          first_copy_time: user.first_copy_time,
          kyc_approved_time: user.kyc_approved_time
        })
      } else {
        // Merge: keep non-null values
        userMap.set(user.user_id, {
          first_copy_time: user.first_copy_time || existing.first_copy_time,
          kyc_approved_time: user.kyc_approved_time || existing.kyc_approved_time
        })
      }
    }

    const uniqueUsers = Array.from(userMap.entries())
      .map(([user_id, timestamps]) => ({
        user_id,
        first_copy_time: timestamps.first_copy_time,
        kyc_approved_time: timestamps.kyc_approved_time
      }))
      .filter(u => u.first_copy_time !== null) // Only keep users with first_copy_time (required by table constraint)

    console.log(`✓ Deduped to ${uniqueUsers.length} unique users (filtered to only users with first_copy_time)`)

    // Upsert to user_first_copies
    const BATCH_SIZE = 1000
    let totalUpserted = 0

    for (let i = 0; i < uniqueUsers.length; i += BATCH_SIZE) {
      const batch = uniqueUsers.slice(i, i + BATCH_SIZE)
      const { error: upsertError } = await supabase
        .from('user_first_copies')
        .upsert(batch, { onConflict: 'user_id' })

      if (upsertError) {
        console.error(`Error upserting batch ${i / BATCH_SIZE + 1}:`, upsertError)
        throw upsertError
      }

      totalUpserted += batch.length
      console.log(`  ✓ Upserted batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(uniqueUsers.length / BATCH_SIZE)} (${totalUpserted}/${uniqueUsers.length})`)
    }

    console.log(`✅ Upserted ${totalUpserted} users to user_first_copies`)

    // STEP 2: Fetch events for users with both timestamps
    console.log('\n📊 Step 2: Fetching view events for users with both timestamps...')

    const { data: usersWithBothTimestamps, error: usersError } = await supabase
      .from('user_first_copies')
      .select('user_id, kyc_approved_time, first_copy_time')
      .not('kyc_approved_time', 'is', null)
      .not('first_copy_time', 'is', null)

    if (usersError) {
      throw usersError
    }

    if (!usersWithBothTimestamps || usersWithBothTimestamps.length === 0) {
      console.log('⚠️ No users found with both timestamps - skipping event fetch')
      return createSuccessResponse('Backfill completed - no users with both timestamps', {
        usersUpserted: totalUpserted,
        usersWithBothTimestamps: 0
      })
    }

    const targetUserIds = usersWithBothTimestamps.map(u => u.user_id)
    console.log(`✓ Found ${targetUserIds.length} users with both timestamps`)

    // Calculate date range for event fetching
    const kycTimes = usersWithBothTimestamps.map(u => new Date(u.kyc_approved_time).getTime())
    const copyTimes = usersWithBothTimestamps.map(u => new Date(u.first_copy_time).getTime())

    const earliestKyc = new Date(Math.min(...kycTimes))
    const latestFirstCopy = new Date(Math.max(...copyTimes))

    const bufferStart = new Date(earliestKyc.getTime() - 24 * 60 * 60 * 1000)
    const fromDate = bufferStart.toISOString().split('T')[0]
    const endDate = latestFirstCopy > today ? latestFirstCopy : today
    const toDate = endDate.toISOString().split('T')[0]

    const daysDiff = Math.ceil((endDate.getTime() - bufferStart.getTime()) / (24 * 60 * 60 * 1000))
    console.log(`Event date range: ${fromDate} to ${toDate} (${daysDiff} days)`)

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
      step1_users: {
        totalUpserted: totalUpserted,
        usersWithBothTimestamps: targetUserIds.length
      },
      step2_events: {
        dateRange: { from: fromDate, to: toDate, days: daysDiff },
        portfolio: portfolioStats,
        creator: creatorStats
      }
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
