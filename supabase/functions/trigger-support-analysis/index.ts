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
    let syncResult
    let syncSkipped = false

    try {
      const syncResponse = await fetch(`${supabaseUrl}/functions/v1/sync-support-conversations`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
        },
      })

      if (!syncResponse.ok) {
        const errorText = await syncResponse.text()
        console.warn(`⚠️ Sync failed (${syncResponse.status}): ${errorText}`)
        console.log('💡 Continuing to analysis with existing data...')
        syncSkipped = true
        syncResult = {
          success: false,
          stats: { conversations_synced: 0, messages_synced: 0 },
          error: errorText,
        }
      } else {
        syncResult = await syncResponse.json()

        if (!syncResult.success) {
          console.warn(`⚠️ Sync returned failure: ${syncResult.error}`)
          console.log('💡 Continuing to analysis with existing data...')
          syncSkipped = true
        } else {
          console.log('✓ Sync complete:', syncResult.stats)

          // Check if sync was skipped due to recent completion
          if (syncResult.stats?.skipped) {
            console.log(`ℹ️ Sync was skipped: ${syncResult.stats.reason}`)
            syncSkipped = true
          }
        }
      }
    } catch (syncError) {
      console.error('⚠️ Sync threw exception:', syncError)
      console.log('💡 Continuing to analysis with existing data...')
      syncSkipped = true
      syncResult = {
        success: false,
        stats: { conversations_synced: 0, messages_synced: 0 },
        error: syncError instanceof Error ? syncError.message : String(syncError),
      }
    }

    // Step 2: Sync Linear issues (BEFORE analysis so view includes Linear data)
    console.log('Step 2: Syncing Linear issues...')
    let linearSyncResult
    let linearSyncSkipped = false

    try {
      const linearSyncResponse = await fetch(`${supabaseUrl}/functions/v1/sync-linear-issues`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
        },
      })

      if (!linearSyncResponse.ok) {
        const errorText = await linearSyncResponse.text()
        console.warn(`⚠️ Linear sync failed (${linearSyncResponse.status}): ${errorText}`)
        console.log('💡 Continuing without Linear data...')
        linearSyncSkipped = true
        linearSyncResult = { success: false, error: errorText }
      } else {
        linearSyncResult = await linearSyncResponse.json()

        if (!linearSyncResult.success) {
          console.warn(`⚠️ Linear sync returned failure: ${linearSyncResult.error}`)
          linearSyncSkipped = true
        } else {
          console.log('✓ Linear sync complete:', linearSyncResult.stats || linearSyncResult.message)
        }
      }
    } catch (linearSyncError) {
      console.error('⚠️ Linear sync threw exception:', linearSyncError)
      console.log('💡 Continuing without Linear data...')
      linearSyncSkipped = true
      linearSyncResult = {
        success: false,
        error: linearSyncError instanceof Error ? linearSyncError.message : String(linearSyncError),
      }
    }

    // Step 3: Refresh enriched_support_conversations view (combines Zendesk + Linear data)
    console.log('Step 3: Refreshing enriched support conversations view...')
    const { createClient } = await import('npm:@supabase/supabase-js@2')
    const supabase = createClient(supabaseUrl, serviceKey)

    try {
      const { error: refreshError } = await supabase.rpc('refresh_enriched_support_conversations')

      if (refreshError) {
        console.error('⚠️ Failed to refresh view:', refreshError)
        console.log('💡 Continuing with potentially stale data...')
      } else {
        console.log('✓ View refreshed successfully')
      }
    } catch (refreshException) {
      console.error('⚠️ Exception refreshing view:', refreshException)
      console.log('💡 Continuing with potentially stale data...')
    }

    // Step 4: Check if we should skip analysis (if already run today and no new data)
    const { data: lastAnalysis } = await supabase
      .from('support_analysis_results')
      .select('created_at, analysis_date')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    const today = new Date().toISOString().split('T')[0]
    const lastAnalysisDate = lastAnalysis?.analysis_date

    if (lastAnalysisDate === today && syncSkipped && linearSyncSkipped) {
      console.log(`⏭️ Skipping analysis - already ran today (${today}) and no new data synced`)

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Analysis skipped - already completed today with no new data',
          pipeline_duration_seconds: Math.round((Date.now() - pipelineStartTime) / 1000),
          sync_summary: syncResult.stats,
          linear_sync_summary: linearSyncResult,
          analysis_summary: { skipped: true, reason: 'Already ran today' },
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          status: 200,
        }
      )
    }

    // Step 5: Run Claude analysis on synced data (now includes Linear metadata)
    console.log('Step 4: Running Claude analysis...')
    let analysisResult

    try {
      const analysisResponse = await fetch(`${supabaseUrl}/functions/v1/analyze-support-feedback`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
        },
      })

      if (!analysisResponse.ok) {
        const errorText = await analysisResponse.text()
        console.error(`⚠️ Analysis failed (${analysisResponse.status}): ${errorText}`)
        throw new Error(`Analysis failed: ${errorText}`)
      }

      analysisResult = await analysisResponse.json()

      if (!analysisResult.success) {
        console.error(`⚠️ Analysis returned failure: ${analysisResult.error}`)
        throw new Error(`Analysis failed: ${analysisResult.error}`)
      }

      console.log('✓ Analysis complete:', analysisResult.stats)
    } catch (analysisError) {
      console.error('❌ Analysis threw exception:', analysisError)

      // Analysis failure is critical - return error response
      return new Response(
        JSON.stringify({
          success: false,
          error: analysisError instanceof Error ? analysisError.message : String(analysisError),
          message: 'Pipeline failed at analysis step',
          pipeline_duration_seconds: Math.round((Date.now() - pipelineStartTime) / 1000),
          sync_summary: syncResult.stats,
          linear_sync_summary: linearSyncResult,
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

    // Step 6: Map Linear issues to feedback (only if analysis succeeded)
    console.log('Step 5: Mapping Linear issues to feedback...')
    let mappingResult

    try {
      const mappingResponse = await fetch(`${supabaseUrl}/functions/v1/map-linear-to-feedback`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
        },
      })

      if (!mappingResponse.ok) {
        const errorText = await mappingResponse.text()
        console.warn(`⚠️ Linear mapping failed (${mappingResponse.status}): ${errorText}`)
        mappingResult = { success: false, error: errorText }
      } else {
        mappingResult = await mappingResponse.json()

        if (!mappingResult.success) {
          console.warn(`⚠️ Linear mapping returned failure: ${mappingResult.error}`)
        } else {
          console.log('✓ Linear mapping complete:', mappingResult.stats || mappingResult.message)
        }
      }
    } catch (mappingError) {
      console.error('⚠️ Linear mapping threw exception:', mappingError)
      mappingResult = {
        success: false,
        error: mappingError instanceof Error ? mappingError.message : String(mappingError),
      }
    }

    const pipelineElapsedSec = Math.round((Date.now() - pipelineStartTime) / 1000)

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Support analysis pipeline completed successfully',
        pipeline_duration_seconds: pipelineElapsedSec,
        sync_summary: syncResult.stats,
        analysis_summary: analysisResult.stats,
        linear_sync_summary: linearSyncResult,
        linear_mapping_summary: mappingResult,
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
