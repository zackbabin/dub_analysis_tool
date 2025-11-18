// Supabase Edge Function: trigger-support-analysis
// DEPRECATED: This function is deprecated in favor of function chaining
// The workflow now chains automatically: sync-support-conversations → sync-linear-issues → analyze-support-feedback → map-linear-to-feedback
// This function now simply triggers sync-support-conversations for backward compatibility

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { handleCorsRequest } from '../_shared/sync-helpers.ts'

serve(async (req) => {
  // Handle CORS preflight requests
  const corsResponse = handleCorsRequest(req)
  if (corsResponse) return corsResponse

  try {
    console.log('⚠️ DEPRECATION WARNING: trigger-support-analysis is deprecated')
    console.log('   The workflow now uses function chaining for better reliability')
    console.log('   Redirecting to sync-support-conversations which triggers the full chain...')

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !serviceKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured')
    }

    const pipelineStartTime = Date.now()

    // Call sync-support-conversations which will automatically trigger the chain:
    // sync-support-conversations → sync-linear-issues → analyze-support-feedback → map-linear-to-feedback
    const response = await fetch(`${supabaseUrl}/functions/v1/sync-support-conversations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
    })

    const result = await response.json()

    const pipelineElapsedSec = Math.round((Date.now() - pipelineStartTime) / 1000)

    if (!response.ok) {
      return new Response(
        JSON.stringify({
          success: false,
          error: result.error || 'Failed to start support analysis workflow',
          message: 'Pipeline failed at sync-support-conversations step',
          pipeline_duration_seconds: pipelineElapsedSec,
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          status: response.status,
        }
      )
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Support analysis workflow started (chained execution)',
        note: 'This function is deprecated. Use sync-support-conversations directly instead.',
        pipeline_duration_seconds: pipelineElapsedSec,
        sync_result: result,
        workflow_chain: [
          'sync-support-conversations (completed)',
          'sync-linear-issues (triggered)',
          'analyze-support-feedback (will run next)',
          'map-linear-to-feedback (will run last)',
        ],
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
