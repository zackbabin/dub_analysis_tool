// Supabase Edge Function: trigger-support-analysis
// Orchestrates the full support feedback analysis pipeline
// 1. Syncs conversations from Zendesk and Instabug
// 2. Runs Claude analysis on the data
// Can be triggered manually or via pg_cron weekly schedule

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { handleCorsRequest } from '../_shared/sync-helpers.ts'

serve(async (req) => {
  // Handle CORS preflight requests
  const corsResponse = handleCorsRequest(req)
  if (corsResponse) return corsResponse

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !serviceKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured')
    }

    console.log('Starting support analysis pipeline...')
    const pipelineStartTime = Date.now()

    // Step 1: Sync conversations from Zendesk and Instabug
    console.log('Step 1: Syncing support conversations...')
    const syncResponse = await fetch(`${supabaseUrl}/functions/v1/sync-support-conversations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
    })

    if (!syncResponse.ok) {
      const errorText = await syncResponse.text()
      throw new Error(`Sync failed (${syncResponse.status}): ${errorText}`)
    }

    const syncResult = await syncResponse.json()

    if (!syncResult.success) {
      throw new Error(`Sync failed: ${syncResult.error}`)
    }

    console.log('✓ Sync complete:', syncResult.stats)

    // Step 2: Run Claude analysis on synced data
    console.log('Step 2: Running Claude analysis...')
    const analysisResponse = await fetch(`${supabaseUrl}/functions/v1/analyze-support-feedback`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
    })

    if (!analysisResponse.ok) {
      const errorText = await analysisResponse.text()
      throw new Error(`Analysis failed (${analysisResponse.status}): ${errorText}`)
    }

    const analysisResult = await analysisResponse.json()

    if (!analysisResult.success) {
      throw new Error(`Analysis failed: ${analysisResult.error}`)
    }

    console.log('✓ Analysis complete:', analysisResult.stats)

    const pipelineElapsedSec = Math.round((Date.now() - pipelineStartTime) / 1000)

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Support analysis pipeline completed successfully',
        pipeline_duration_seconds: pipelineElapsedSec,
        sync_summary: syncResult.stats,
        analysis_summary: analysisResult.stats,
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        status: 200,
      }
    )
  } catch (error) {
    console.error('Pipeline error:', error)

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        details: error instanceof Error ? error.stack : undefined,
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        status: 500,
      }
    )
  }
})
