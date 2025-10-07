// Test script for Mixpanel Export API
// Run with: deno run --allow-net --allow-env test_mixpanel_export.ts

const PROJECT_ID = '2599235'

// Get credentials from environment
const username = Deno.env.get('MIXPANEL_SERVICE_USERNAME')
const secret = Deno.env.get('MIXPANEL_SERVICE_SECRET')

if (!username || !secret) {
  console.error('Error: MIXPANEL_SERVICE_USERNAME and MIXPANEL_SERVICE_SECRET environment variables required')
  Deno.exit(1)
}

// Date range: last 3 days (small window for quick test)
const today = new Date()
const threeDaysAgo = new Date()
threeDaysAgo.setDate(today.getDate() - 3)

const toDate = today.toISOString().split('T')[0]
const fromDate = threeDaysAgo.toISOString().split('T')[0]

console.log(`Testing Mixpanel Export API`)
console.log(`Date range: ${fromDate} to ${toDate}`)
console.log(`Project ID: ${PROJECT_ID}`)
console.log('='.repeat(60))

// Test 1: Without filter
console.log('\n📋 Test 1: Fetching WITHOUT filter')
console.log('-'.repeat(60))

const params1 = new URLSearchParams({
  project_id: PROJECT_ID,
  from_date: fromDate,
  to_date: toDate,
  event: '["Viewed Portfolio Details"]',
})

const authString = `${username}:${secret}`
const authHeader = `Basic ${btoa(authString)}`

console.log(`URL: https://data.mixpanel.com/api/2.0/export?${params1}`)

const startTime1 = Date.now()
const response1 = await fetch(`https://data.mixpanel.com/api/2.0/export?${params1}`, {
  method: 'GET',
  headers: {
    Authorization: authHeader,
    Accept: 'application/json',
  },
})

const elapsed1 = Date.now() - startTime1

if (!response1.ok) {
  const errorText = await response1.text()
  console.error(`❌ API Error (${response1.status}): ${errorText}`)
} else {
  const text1 = await response1.text()
  const lines1 = text1.trim().split('\n').filter(line => line.trim())

  console.log(`✅ Response received in ${elapsed1}ms`)
  console.log(`   Total events: ${lines1.length}`)
  console.log(`   Response size: ${text1.length} characters`)

  if (lines1.length > 0) {
    const firstEvent = JSON.parse(lines1[0])
    console.log(`   First event properties:`, Object.keys(firstEvent.properties || {}).slice(0, 10))
    console.log(`   Has $email: ${!!firstEvent.properties?.$email}`)
    console.log(`   First event sample:`, JSON.stringify(firstEvent).substring(0, 300) + '...')
  }
}

// Test 2: With user["$email"] filter
console.log('\n📋 Test 2: Fetching WITH user["$email"] filter')
console.log('-'.repeat(60))

const params2 = new URLSearchParams({
  project_id: PROJECT_ID,
  from_date: fromDate,
  to_date: toDate,
  event: '["Viewed Portfolio Details"]',
  where: 'defined(user["$email"])',
})

console.log(`URL: https://data.mixpanel.com/api/2.0/export?${params2}`)

const startTime2 = Date.now()
const response2 = await fetch(`https://data.mixpanel.com/api/2.0/export?${params2}`, {
  method: 'GET',
  headers: {
    Authorization: authHeader,
    Accept: 'application/json',
  },
})

const elapsed2 = Date.now() - startTime2

if (!response2.ok) {
  const errorText = await response2.text()
  console.error(`❌ API Error (${response2.status}): ${errorText}`)
} else {
  const text2 = await response2.text()
  const lines2 = text2.trim().split('\n').filter(line => line.trim())

  console.log(`✅ Response received in ${elapsed2}ms`)
  console.log(`   Total events: ${lines2.length}`)
  console.log(`   Response size: ${text2.length} characters`)

  if (lines2.length > 0) {
    const firstEvent = JSON.parse(lines2[0])
    console.log(`   First event properties:`, Object.keys(firstEvent.properties || {}).slice(0, 10))
    console.log(`   Has $email: ${!!firstEvent.properties?.$email}`)
    console.log(`   First event sample:`, JSON.stringify(firstEvent).substring(0, 300) + '...')
  }
}

// Test 3: With properties["$email"] filter (old syntax)
console.log('\n📋 Test 3: Fetching WITH properties["$email"] filter (for comparison)')
console.log('-'.repeat(60))

const params3 = new URLSearchParams({
  project_id: PROJECT_ID,
  from_date: fromDate,
  to_date: toDate,
  event: '["Viewed Portfolio Details"]',
  where: 'defined(properties["$email"])',
})

console.log(`URL: https://data.mixpanel.com/api/2.0/export?${params3}`)

const startTime3 = Date.now()
const response3 = await fetch(`https://data.mixpanel.com/api/2.0/export?${params3}`, {
  method: 'GET',
  headers: {
    Authorization: authHeader,
    Accept: 'application/json',
  },
})

const elapsed3 = Date.now() - startTime3

if (!response3.ok) {
  const errorText = await response3.text()
  console.error(`❌ API Error (${response3.status}): ${errorText}`)
} else {
  const text3 = await response3.text()
  const lines3 = text3.trim().split('\n').filter(line => line.trim())

  console.log(`✅ Response received in ${elapsed3}ms`)
  console.log(`   Total events: ${lines3.length}`)
  console.log(`   Response size: ${text3.length} characters`)

  if (lines3.length > 0) {
    const firstEvent = JSON.parse(lines3[0])
    console.log(`   First event properties:`, Object.keys(firstEvent.properties || {}).slice(0, 10))
    console.log(`   Has $email: ${!!firstEvent.properties?.$email}`)
    console.log(`   First event sample:`, JSON.stringify(firstEvent).substring(0, 300) + '...')
  }
}

console.log('\n' + '='.repeat(60))
console.log('Test completed')
