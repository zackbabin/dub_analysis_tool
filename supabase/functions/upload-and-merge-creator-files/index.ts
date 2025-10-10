// Supabase Edge Function: upload-and-merge-creator-files
// Accepts 3 CSV files and merges them using two-stage matching logic
// Stage 1: Match Deals to Creator List by name
// Stage 2: Merge with Public Creators by email
// Applies all transformations and stores in uploaded_creators table

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface MergedCreator {
  email: string
  creatorUsername?: string
  fullName?: string
  description?: string
  descriptionCharacterCount: number
  age?: number
  dubTenure?: number
  employer?: string
  industryProfessionalsExperience?: number
  isRIA?: string
  type?: string
  revenueShare?: string
  [key: string]: any
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const body = await req.json()
    const { creatorListCsv, dealsCsv, publicCreatorsCsv } = body

    if (!creatorListCsv || !dealsCsv || !publicCreatorsCsv) {
      throw new Error('All 3 CSV files are required: creatorListCsv, dealsCsv, publicCreatorsCsv')
    }

    console.log('Parsing CSV files...')

    // Parse CSV files
    const creatorList = parseCSV(creatorListCsv)
    const deals = parseCSV(dealsCsv)
    const publicCreators = parseCSV(publicCreatorsCsv)

    console.log(`Parsed: ${creatorList.length} creators, ${deals.length} deals, ${publicCreators.length} public creators`)

    // ===== STAGE 1: Match Deals to Creator List =====
    console.log('Stage 1: Matching deals to creators by name...')

    const creatorByName = new Map<string, any>()
    creatorList.forEach(creator => {
      const name = creator['Name']
      const fundName = creator['Premium: Name of Fund']

      if (name) {
        const normalizedName = name.toLowerCase().trim()
        creatorByName.set(normalizedName, creator)
      }
      if (fundName && fundName !== 'N/A') {
        const normalizedFund = fundName.toLowerCase().trim()
        creatorByName.set(normalizedFund, creator)
      }
    })

    const stage1Merged: any[] = []
    let dealsMatched = 0

    deals.forEach(deal => {
      const contactPerson = deal['Deal - Contact person']
      const organization = deal['Deal - Organization']
      const title = deal['Deal - Title']

      let matchedCreator = null

      if (contactPerson) {
        const normalized = contactPerson.toLowerCase().trim()
        if (creatorByName.has(normalized)) {
          matchedCreator = creatorByName.get(normalized)
        }
      }

      if (!matchedCreator && organization) {
        const normalized = organization.toLowerCase().trim()
        if (creatorByName.has(normalized)) {
          matchedCreator = creatorByName.get(normalized)
        }
      }

      if (!matchedCreator && title) {
        const normalized = title.toLowerCase().trim()
        if (creatorByName.has(normalized)) {
          matchedCreator = creatorByName.get(normalized)
        }
      }

      if (matchedCreator) {
        dealsMatched++
        stage1Merged.push({ ...matchedCreator, ...deal })
      }
    })

    // Add creators that didn't match any deals
    creatorList.forEach(creator => {
      const alreadyAdded = stage1Merged.some(row => row['Name'] === creator['Name'])
      if (!alreadyAdded) {
        stage1Merged.push(creator)
      }
    })

    console.log(`Stage 1: ${stage1Merged.length} rows, ${dealsMatched} deals matched`)

    // ===== STAGE 2: Merge with Public Creators =====
    console.log('Stage 2: Matching with public creators by email...')

    const normEmail = (email: any) => {
      if (!email || email === 'N/A') return null
      return String(email).toLowerCase().trim()
    }

    const stage1ByEmail = new Map<string, any>()
    stage1Merged.forEach(row => {
      const email = normEmail(row['Registered dub Account Email'])
      if (email) {
        stage1ByEmail.set(email, row)
      }
    })

    const publicByEmail = new Map<string, any>()
    publicCreators.forEach(creator => {
      const email = normEmail(creator['email'])
      if (email) {
        publicByEmail.set(email, creator)
      }
    })

    const allEmails = new Set([
      ...Array.from(stage1ByEmail.keys()),
      ...Array.from(publicByEmail.keys())
    ])

    const finalMerged: any[] = []
    let emailMatches = 0

    allEmails.forEach(email => {
      const row: any = {}

      if (stage1ByEmail.has(email)) {
        Object.assign(row, stage1ByEmail.get(email))
      }

      if (publicByEmail.has(email)) {
        Object.assign(row, publicByEmail.get(email))
        if (stage1ByEmail.has(email)) emailMatches++
      }

      finalMerged.push(row)
    })

    console.log(`Stage 2: ${finalMerged.length} rows, ${emailMatches} email matches`)

    // ===== Remove empty columns =====
    const columnsToRemove = new Set([
      'Status', 'Premium: Fund Logo', 'Stripe Setup?', 'Industry Professionals: Currently',
      'Rev Share (Fee Adjusted)', 'Deal - Title', 'Deal - Status', 'Deal - Pipeline',
      'Deal - % Rev Share', 'Deal - Investment Process', 'Deal - Stage',
      'Deal - Contact person', 'Deal - Owner', 'Deal - Source', 'Deal - Deal created',
      'useruuid', 'accountuuid', 'report7: kycapplicationrequestid', 'phone',
      'postal', 'state', 'createdat', 'bio', 'id', 'kyccategorycontentid',
      'status', 'report10: createdat', 'report11: createdat', 'externalid',
      'submittedat', 'apexaccountid', 'apexinternalid', 'investmentobjective',
      'report12: kycapplicationrequestid', 'accounttype'
    ])

    const allColumns = new Set<string>()
    finalMerged.forEach(row => {
      Object.keys(row).forEach(col => allColumns.add(col))
    })

    const nonEmptyCols = Array.from(allColumns).filter(col => {
      if (columnsToRemove.has(col)) return false

      return finalMerged.some(row => {
        const val = row[col]
        return val !== null && val !== undefined && val !== '' && val !== 'N/A'
      })
    })

    console.log('Enriching and transforming data...')

    // Transform data
    const transformedCreators: MergedCreator[] = finalMerged.map(row => {
      const cleaned: MergedCreator = {
        descriptionCharacterCount: 0
      }

      // Email (first column)
      const email = normEmail(row['Registered dub Account Email']) || normEmail(row['email'])
      if (!email) return null // Skip rows without email
      cleaned.email = email

      // Merge firstname, lastname, displayname → fullName
      const firstname = row['firstname'] || ''
      const lastname = row['lastname'] || ''
      const displayname = row['displayname'] || ''

      let fullName = ''
      if (firstname && lastname) {
        fullName = `${firstname} ${lastname}`.trim()
      } else if (displayname) {
        fullName = displayname
      } else if (firstname) {
        fullName = firstname
      } else if (lastname) {
        fullName = lastname
      }
      if (fullName) cleaned.fullName = fullName

      // Merge Profile Bio → description
      const profileBio = row['Profile Bio'] || ''
      const description = row['description'] || ''
      let mergedDescription = profileBio || description
      if (mergedDescription) {
        cleaned.description = mergedDescription
        cleaned.descriptionCharacterCount = mergedDescription.length
      }

      // Convert birthdate → age
      if (row['birthdate']) {
        try {
          const birthDate = new Date(row['birthdate'])
          const today = new Date()
          let age = today.getFullYear() - birthDate.getFullYear()
          const monthDiff = today.getMonth() - birthDate.getMonth()
          if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
            age--
          }
          cleaned.age = age
        } catch (e) {
          // Invalid date, skip
        }
      }

      // Convert joindate → dubTenure (months)
      if (row['joindate']) {
        try {
          const joinDate = new Date(row['joindate'])
          const today = new Date()
          const monthsDiff = (today.getFullYear() - joinDate.getFullYear()) * 12 +
            (today.getMonth() - joinDate.getMonth())
          cleaned.dubTenure = monthsDiff
        } catch (e) {
          // Invalid date, skip
        }
      }

      // Handle creatorUsername (rename from handle)
      if (row['handle']) {
        let username = row['handle'].trim()
        if (!username.startsWith('@')) {
          username = '@' + username
        }
        cleaned.creatorUsername = username
      }

      // Merge premiumNameOfFund with employer
      const premiumFund = row['Premium: Name of Fund'] || ''
      const employer = row['employer'] || ''
      const mergedEmployer = (premiumFund && premiumFund !== 'N/A') ? premiumFund : employer
      if (mergedEmployer) cleaned.employer = mergedEmployer

      // Extract numeric experience
      const experience = row['Industry Professionals: Experience ']
      if (experience && experience !== 'N/A') {
        const numMatch = String(experience).match(/\d+/)
        if (numMatch) {
          cleaned.industryProfessionalsExperience = parseInt(numMatch[0], 10)
        }
      }

      // Add all other non-empty columns with transformations
      nonEmptyCols.forEach(col => {
        if (['email', 'Registered dub Account Email', 'firstname', 'lastname', 'displayname',
             'Profile Bio', 'description', 'handle', 'Premium: Name of Fund', 'employer',
             'Industry Professionals: Experience ', 'Name', 'birthdate', 'joindate'].includes(col)) {
          return
        }

        if (row[col] !== undefined) {
          let camelKey = toCamelCase(col)

          // Special handling
          if (col === 'RIA?' || col === 'Person - RIA?') {
            cleaned.isRIA = row[col]
          } else if (col === 'Type') {
            cleaned.type = row[col] || 'Regular'
          } else if (col === 'Revenue Share') {
            cleaned.revenueShare = row[col] || '0%'
          } else {
            cleaned[camelKey] = row[col]
          }
        }
      })

      return cleaned
    }).filter(Boolean) as MergedCreator[]

    console.log(`Transformed ${transformedCreators.length} creators`)

    // Validate uniqueness
    const emailSet = new Set<string>()
    const usernameSet = new Set<string>()
    const duplicateEmails: string[] = []
    const duplicateUsernames: string[] = []

    transformedCreators.forEach(creator => {
      if (emailSet.has(creator.email)) {
        duplicateEmails.push(creator.email)
      } else {
        emailSet.add(creator.email)
      }

      if (creator.creatorUsername) {
        if (usernameSet.has(creator.creatorUsername)) {
          duplicateUsernames.push(creator.creatorUsername)
        } else {
          usernameSet.add(creator.creatorUsername)
        }
      }
    })

    if (duplicateEmails.length > 0) {
      console.warn(`⚠️ Found ${duplicateEmails.length} duplicate emails (will keep first occurrence):`, duplicateEmails.slice(0, 5))
    }
    if (duplicateUsernames.length > 0) {
      console.warn(`⚠️ Found ${duplicateUsernames.length} duplicate usernames (will keep first occurrence):`, duplicateUsernames.slice(0, 5))
    }

    // Deduplicate by email (keep first occurrence)
    const deduped = new Map<string, MergedCreator>()
    transformedCreators.forEach(creator => {
      if (!deduped.has(creator.email)) {
        deduped.set(creator.email, creator)
      }
    })

    const finalCreators = Array.from(deduped.values())
    console.log(`After deduplication: ${finalCreators.length} unique creators`)

    // Store in database
    console.log('Storing in database...')
    const uploadedAt = new Date().toISOString()

    const dbRows = finalCreators.map(creator => ({
      creator_username: creator.creatorUsername || null,
      email: creator.email,
      raw_data: creator, // Store entire object as JSONB
      uploaded_at: uploadedAt
    }))

    // Insert in batches
    const batchSize = 500
    let totalInserted = 0

    for (let i = 0; i < dbRows.length; i += batchSize) {
      const batch = dbRows.slice(i, i + batchSize)

      const { error: insertError } = await supabase
        .from('uploaded_creators')
        .insert(batch)

      if (insertError) {
        console.error('Insert error:', insertError)
        throw new Error(`Failed to insert creators: ${insertError.message}`)
      }

      totalInserted += batch.length
      console.log(`Inserted batch: ${totalInserted}/${dbRows.length}`)
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Creator files uploaded and merged successfully',
        stats: {
          creatorListRows: creatorList.length,
          dealsRows: deals.length,
          publicCreatorsRows: publicCreators.length,
          dealsMatched,
          emailMatches,
          finalCreatorsCount: finalCreators.length,
          duplicateEmails: duplicateEmails.length,
          duplicateUsernames: duplicateUsernames.length,
          inserted: totalInserted
        }
      }),
      {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error) {
    console.error('Error in upload-and-merge-creator-files:', error)

    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message || 'Unknown error occurred',
        details: error?.stack || String(error)
      }),
      {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        status: 500,
      }
    )
  }
})

// ============================================================================
// Helper Functions
// ============================================================================

function parseCSV(csvContent: string): any[] {
  const lines = csvContent.trim().split('\n')
  if (lines.length === 0) return []

  const headers = parseCSVLine(lines[0])
  const data: any[] = []

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i])
    if (values.length === 0) continue

    const row: any = {}
    headers.forEach((header, index) => {
      row[header] = values[index] || ''
    })
    data.push(row)
  }

  return data
}

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }

  result.push(current.trim())
  return result
}

function toCamelCase(str: string): string {
  return str
    .replace(/[:\s-]+(.)?/g, (_, char) => char ? char.toUpperCase() : '')
    .replace(/^(.)/, (char) => char.toLowerCase())
}
