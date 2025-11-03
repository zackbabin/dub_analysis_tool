// Supabase Edge Function: sync-mixpanel-engagement
// Fetches engagement data (views, subscriptions, copies) from Mixpanel
// Part 3 of 4: Handles user_portfolio_creator_views, user_portfolio_creator_copies
// Triggers pattern analysis and refreshes materialized views
// Triggered manually by user clicking "Sync Live Data" button after sync-mixpanel-funnels completes

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4'
import {
  MIXPANEL_CONFIG,
  CORS_HEADERS,
  type MixpanelCredentials,
  pLimit,
  fetchInsightsData,
} from '../_shared/mixpanel-api.ts'
import { processPortfolioCreatorPairs } from '../_shared/data-processing.ts'

const CHART_IDS = {
  // User engagement analysis for subscriptions/copies
  profileViewsByCreator: '85165851',  // Total Profile Views
  pdpViewsByPortfolio: '85165580',     // Total PDP Views, Total Copies, Total Liquidations by creatorId, portfolioTicker, distinctId
  subscriptionsByCreator: '85165590',  // Total Subscriptions
}

interface SyncStats {
  engagementRecordsFetched: number
  totalRecordsInserted: number
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    // Get Mixpanel credentials from Supabase secrets
    const mixpanelUsername = Deno.env.get('MIXPANEL_SERVICE_USERNAME')
    const mixpanelSecret = Deno.env.get('MIXPANEL_SERVICE_SECRET')

    if (!mixpanelUsername || !mixpanelSecret) {
      throw new Error('Mixpanel credentials not configured in Supabase secrets')
    }

    console.log('Mixpanel credentials loaded from secrets')

    // Initialize Supabase client with service role key
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    console.log('Starting Mixpanel sync...')

    // Create sync log entry
    const syncStartTime = new Date()
    const { data: syncLog, error: syncLogError} = await supabase
      .from('sync_logs')
      .insert({
        tool_type: 'user',
        sync_started_at: syncStartTime.toISOString(),
        sync_status: 'in_progress',
        source: 'mixpanel_engagement',
        triggered_by: 'manual',
      })
      .select()
      .single()

    if (syncLogError) {
      console.error('Failed to create sync log:', syncLogError)
      throw syncLogError
    }

    const syncLogId = syncLog.id

    try {
      // Date range configured in Mixpanel chart settings
      console.log(`Fetching data from Mixpanel charts (date range configured in charts)`)

      const credentials: MixpanelCredentials = {
        username: mixpanelUsername,
        secret: mixpanelSecret,
      }

      // Fetch engagement data with controlled concurrency to respect Mixpanel rate limits
      // Max 5 concurrent queries allowed by Mixpanel - we use 3 for safety
      console.log('Fetching engagement charts with max 3 concurrent requests...')
      const CONCURRENCY_LIMIT = 3
      const limit = pLimit(CONCURRENCY_LIMIT)

      let profileViewsData, pdpViewsData, subscriptionsData

      try {
        [profileViewsData, pdpViewsData, subscriptionsData] = await Promise.all([
          limit(() =>
            fetchInsightsData(
              credentials,
              CHART_IDS.profileViewsByCreator,
              'Profile Views by Creator'
            )
          ),
          limit(() =>
            fetchInsightsData(credentials, CHART_IDS.pdpViewsByPortfolio, 'PDP Views by Portfolio (with Copies & Liquidations)')
          ),
          limit(() =>
            fetchInsightsData(
              credentials,
              CHART_IDS.subscriptionsByCreator,
              'Subscriptions by Creator'
            )
          ),
        ])
        console.log('✓ Engagement data fetched successfully with controlled concurrency')
      } catch (error: any) {
        // Handle Mixpanel rate limit errors gracefully
        if (error.isRateLimited || error.statusCode === 429) {
          console.warn('⚠️ Mixpanel rate limit reached - continuing workflow with existing data')

          // Update sync log to show rate limited
          await supabase
            .from('sync_logs')
            .update({
              sync_completed_at: new Date().toISOString(),
              sync_status: 'rate_limited',
              error_message: 'Mixpanel rate limit exceeded - using existing data',
              error_details: { rateLimitError: error.message },
            })
            .eq('id', syncLogId)

          return new Response(
            JSON.stringify({
              success: true,
              rateLimited: true,
              message: 'Mixpanel rate limit reached. Continuing with existing data in database.',
              stats: {
                engagementRecordsFetched: 0,
                totalRecordsInserted: 0,
              },
            }),
            {
              headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
              status: 200,
            }
          )
        }
        throw error
      }

      // Process and insert data into database
      const stats: SyncStats = {
        engagementRecordsFetched: 0,
        totalRecordsInserted: 0,
      }

      const batchSize = 500

      // Process and store engagement data (two tables: portfolio-creator and creator-level)
      console.log('Processing engagement pairs...')
      const { portfolioCreatorPairs, creatorPairs } = processPortfolioCreatorPairs(
        profileViewsData,
        pdpViewsData,
        subscriptionsData,
        syncStartTime.toISOString()
      )

      // Upsert portfolio-creator engagement pairs to user_portfolio_creator_engagement
      if (portfolioCreatorPairs.length > 0) {
        console.log(`Upserting ${portfolioCreatorPairs.length} portfolio-creator pairs...`)
        for (let i = 0; i < portfolioCreatorPairs.length; i += batchSize) {
          const batch = portfolioCreatorPairs.slice(i, i + batchSize)
          const { error: insertError } = await supabase
            .from('user_portfolio_creator_engagement')
            .upsert(batch, {
              onConflict: 'distinct_id,portfolio_ticker,creator_id',
              ignoreDuplicates: false
            })

          if (insertError) {
            console.error('Error upserting portfolio-creator pairs batch:', insertError)
            throw insertError
          }
          console.log(`Upserted batch: ${i + batch.length}/${portfolioCreatorPairs.length} portfolio-creator pairs`)
        }
        console.log('✓ Portfolio-creator pairs upserted successfully')
        stats.engagementRecordsFetched += portfolioCreatorPairs.length
        stats.totalRecordsInserted += portfolioCreatorPairs.length
      }

      // Upsert creator-level engagement pairs to user_creator_engagement
      if (creatorPairs.length > 0) {
        console.log(`Upserting ${creatorPairs.length} creator-level pairs...`)
        for (let i = 0; i < creatorPairs.length; i += batchSize) {
          const batch = creatorPairs.slice(i, i + batchSize)
          const { error: insertError } = await supabase
            .from('user_creator_engagement')
            .upsert(batch, {
              onConflict: 'distinct_id,creator_id',
              ignoreDuplicates: false
            })

          if (insertError) {
            console.error('Error upserting creator pairs batch:', insertError)
            throw insertError
          }
          console.log(`Upserted batch: ${i + batch.length}/${creatorPairs.length} creator pairs`)
        }
        console.log('✓ Creator-level pairs upserted successfully')
        stats.engagementRecordsFetched += creatorPairs.length
        stats.totalRecordsInserted += creatorPairs.length
      }

      // Trigger pattern analysis (NOW USES STORED DATA - no Mixpanel calls)
      // Fire and forget - don't wait for completion to avoid timeout
      console.log('Triggering pattern analysis (using stored data)...')

      // Trigger all 3 analyses using the merged function
      // Note: We await Promise.allSettled to ensure fetch requests are initiated,
      // but the analysis functions themselves run in background and we don't wait for completion
      console.log('Triggering pattern analysis functions (copy and creator_copy)...')

      const analysisResults = await Promise.allSettled([
        fetch(`${supabaseUrl}/functions/v1/analyze-conversion-patterns`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'apikey': supabaseServiceKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ analysis_type: 'copy' })
        }).then(async (response) => {
          if (!response.ok) {
            const errorText = await response.text()
            console.error('⚠️ Copy analysis returned error:', response.status, errorText)
            return { success: false, type: 'copy', error: errorText }
          } else {
            console.log('✓ Copy analysis invoked successfully')
            return { success: true, type: 'copy' }
          }
        }).catch((err) => {
          console.error('⚠️ Copy analysis failed to invoke:', err.message)
          return { success: false, type: 'copy', error: err.message }
        }),

        fetch(`${supabaseUrl}/functions/v1/analyze-conversion-patterns`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'apikey': supabaseServiceKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ analysis_type: 'creator_copy' })
        }).then(async (response) => {
          if (!response.ok) {
            const errorText = await response.text()
            console.error('⚠️ Creator copy analysis returned error:', response.status, errorText)
            return { success: false, type: 'creator_copy', error: errorText }
          } else {
            console.log('✓ Creator copy analysis invoked successfully')
            return { success: true, type: 'creator_copy' }
          }
        }).catch((err) => {
          console.error('⚠️ Creator copy analysis failed to invoke:', err.message)
          return { success: false, type: 'creator_copy', error: err.message }
        })
      ])

      // Log results of analysis invocations
      const successfulAnalyses = analysisResults.filter(r => r.status === 'fulfilled' && r.value.success).length
      console.log(`✓ Successfully invoked ${successfulAnalyses}/2 pattern analysis functions`)

      if (successfulAnalyses === 0) {
        console.warn('⚠️ WARNING: No analysis functions were successfully invoked')
      }

      // Note: Pattern analysis uses exhaustive search + logistic regression
      // Results stored in conversion_pattern_combinations table
      console.log('Pattern analysis functions use stored engagement data (no duplicate Mixpanel calls)')

      // Refresh materialized view asynchronously (don't block Edge Function completion)
      console.log('Triggering main_analysis materialized view refresh (async)...')
      supabase.rpc('refresh_main_analysis')
        .then(({ error: refreshError }) => {
          if (refreshError) {
            console.error('Error refreshing materialized view:', refreshError)
          } else {
            console.log('✓ Materialized view refreshed successfully')
            // Refresh summary views that depend on main_analysis
            console.log('Refreshing engagement summary views...')
            Promise.all([
              supabase.rpc('refresh_subscription_engagement_summary'),
              supabase.rpc('refresh_copy_engagement_summary'),
              supabase.rpc('refresh_portfolio_engagement_views')
            ]).then(() => {
              console.log('✓ Engagement summary views refreshed')
              console.log('✓ Portfolio engagement views refreshed (includes hidden gems)')
            }).catch(e => console.warn('Error refreshing summary views:', e))
          }
        })
        .catch(err => console.warn('Materialized view refresh failed:', err))

      // Update sync log with success
      const syncEndTime = new Date()
      await supabase
        .from('sync_logs')
        .update({
          sync_completed_at: syncEndTime.toISOString(),
          sync_status: 'completed',
          total_records_inserted: stats.totalRecordsInserted,
        })
        .eq('id', syncLogId)

      console.log('Engagement sync completed successfully')
      console.log('Note: engagement summaries will be refreshed by analyze-conversion-patterns after pattern analysis completes')

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Mixpanel engagement sync completed successfully',
          stats,
        }),
        {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          status: 200,
        }
      )
    } catch (error) {
      // Update sync log with failure
      await supabase
        .from('sync_logs')
        .update({
          sync_completed_at: new Date().toISOString(),
          sync_status: 'failed',
          error_message: error.message,
          error_details: { stack: error.stack },
        })
        .eq('id', syncLogId)

      throw error
    }
  } catch (error) {
    console.error('Error in sync-mixpanel-engagement function:', error)

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
