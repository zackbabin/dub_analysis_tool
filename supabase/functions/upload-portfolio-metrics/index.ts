// Supabase Edge Function: upload-portfolio-metrics
// Handles CSV upload of portfolio metrics data
// Parses CSV with columns: strategyid, totalreturnspercentage, totalposition, etc.
// Stores data in portfolio_metrics table

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4'
import { CORS_HEADERS } from '../_shared/mixpanel-api.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    console.log('Processing portfolio metrics CSV upload...')

    // Get CSV content from request body
    const contentType = req.headers.get('content-type') || ''
    let csvContent: string

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData()
      const file = formData.get('file') as File
      if (!file) {
        throw new Error('No file provided in form data')
      }
      csvContent = await file.text()
    } else {
      // Assume raw CSV text in body
      csvContent = await req.text()
    }

    if (!csvContent || csvContent.trim().length === 0) {
      throw new Error('CSV content is empty')
    }

    console.log('CSV content received, parsing...')

    // Parse CSV
    const metricsRecords = parsePortfolioMetricsCSV(csvContent)
    console.log(`Parsed ${metricsRecords.length} portfolio metrics records`)

    if (metricsRecords.length === 0) {
      throw new Error('No valid records found in CSV')
    }

    // Deduplicate by strategy_id (keep last occurrence for each strategy_id)
    const deduplicatedMap = new Map()
    metricsRecords.forEach(record => {
      deduplicatedMap.set(record.strategy_id, record)
    })
    const deduplicatedRecords = Array.from(deduplicatedMap.values())

    if (deduplicatedRecords.length < metricsRecords.length) {
      console.log(`⚠️ Removed ${metricsRecords.length - deduplicatedRecords.length} duplicate strategy_id entries`)
    }

    console.log(`Processing ${deduplicatedRecords.length} unique portfolio metrics records`)

    // Use upsert instead of delete+insert to ensure data persists even if function times out
    // This way, partial data is still saved if the function doesn't complete
    console.log('Upserting portfolio performance metrics data...')
    const batchSize = 1000
    let totalInserted = 0
    let errors = []

    for (let i = 0; i < deduplicatedRecords.length; i += batchSize) {
      const batch = deduplicatedRecords.slice(i, i + batchSize)
      const batchNum = Math.floor(i / batchSize) + 1
      const totalBatches = Math.ceil(deduplicatedRecords.length / batchSize)

      console.log(`Upserting batch ${batchNum}/${totalBatches} (${batch.length} records)`)

      try {
        const { error: upsertError } = await supabase
          .from('portfolio_performance_metrics')
          .upsert(batch, {
            onConflict: 'strategy_id',
            ignoreDuplicates: false
          })

        if (upsertError) {
          console.error(`Error upserting batch ${batchNum}:`, upsertError)
          errors.push({ batch: batchNum, error: upsertError.message })
          // Continue with next batch instead of throwing
        } else {
          totalInserted += batch.length
          console.log(`✅ Batch ${batchNum} completed`)
        }
      } catch (error) {
        console.error(`Exception in batch ${batchNum}:`, error)
        errors.push({ batch: batchNum, error: error.message })
        // Continue with next batch
      }
    }

    console.log(`✅ Uploaded ${totalInserted} of ${metricsRecords.length} portfolio metrics records`)

    if (errors.length > 0) {
      console.warn(`⚠️ ${errors.length} batch(es) had errors:`, errors)
    }

    // Refresh the materialized view to include new metrics
    console.log('Refreshing portfolio breakdown materialized view...')
    try {
      await supabase.rpc('refresh_portfolio_breakdown_view')
      console.log('✅ Materialized view refreshed')
    } catch (error) {
      console.warn('⚠️ Failed to refresh materialized view:', error)
      // Don't fail the whole upload if view refresh fails
    }

    return new Response(
      JSON.stringify({
        success: true,
        stats: {
          recordsUploaded: totalInserted,
          totalRecords: deduplicatedRecords.length,
          duplicatesRemoved: metricsRecords.length - deduplicatedRecords.length,
          errors: errors.length,
          partialUpload: errors.length > 0
        }
      }),
      {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        status: 200
      }
    )
  } catch (error) {
    console.error('Error in upload-portfolio-metrics function:', error)

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
 * Parse portfolio metrics CSV
 * Expected columns: id, createdat, createdby, accountid, strategyid, totalreturnspercentage,
 *                   totalreturnsvalue, dailyreturnspercentage, dailyreturnsvalue, totalposition, rank
 */
function parsePortfolioMetricsCSV(csvContent: string): any[] {
  const records: any[] = []
  const lines = csvContent.trim().split('\n')

  if (lines.length < 2) {
    console.warn('CSV has no data rows')
    return []
  }

  // Parse header
  const header = lines[0].split(',').map(h => h.trim().toLowerCase())
  const strategyIdIdx = header.indexOf('strategyid')
  const totalReturnsPctIdx = header.indexOf('totalreturnspercentage')
  const totalReturnsValIdx = header.indexOf('totalreturnsvalue')
  const dailyReturnsPctIdx = header.indexOf('dailyreturnspercentage')
  const dailyReturnsValIdx = header.indexOf('dailyreturnsvalue')
  const totalPositionIdx = header.indexOf('totalposition')

  if (strategyIdIdx === -1 || totalReturnsPctIdx === -1 || totalPositionIdx === -1) {
    throw new Error('CSV missing required columns: strategyid, totalreturnspercentage, totalposition')
  }

  console.log(`Found columns at indices: strategyid=${strategyIdIdx}, totalreturns%=${totalReturnsPctIdx}, totalposition=${totalPositionIdx}`)

  // Parse data rows
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    const cols = line.split(',').map(c => c.trim())

    const strategyId = cols[strategyIdIdx]
    const totalReturnsPct = cols[totalReturnsPctIdx]
    const totalReturnsVal = cols[totalReturnsValIdx]
    const dailyReturnsPct = cols[dailyReturnsPctIdx]
    const dailyReturnsVal = cols[dailyReturnsValIdx]
    const totalPosition = cols[totalPositionIdx]

    if (!strategyId) {
      console.warn(`Row ${i}: missing strategyId, skipping`)
      continue
    }

    records.push({
      strategy_id: String(strategyId),
      total_returns_percentage: totalReturnsPct ? parseFloat(totalReturnsPct) : null,
      total_returns_value: totalReturnsVal ? parseFloat(totalReturnsVal) : null,
      daily_returns_percentage: dailyReturnsPct ? parseFloat(dailyReturnsPct) : null,
      daily_returns_value: dailyReturnsVal ? parseFloat(dailyReturnsVal) : null,
      total_position: totalPosition ? parseFloat(totalPosition) : null,
      uploaded_at: new Date().toISOString()
    })
  }

  console.log(`Parsed ${records.length} valid records from ${lines.length - 1} data rows`)
  return records
}
