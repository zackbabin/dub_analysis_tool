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
  pdpViewsByPortfolio: '85165580',     // Total PDP Views by creatorId, portfolioTicker, distinctId
  subscriptionsByCreator: '85165590',  // Total Subscriptions
  copiesByCreator: '85172578',  // Total Copies
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
      // Max 5 concurrent queries allowed by Mixpanel - we use 4 for safety
      console.log('Fetching engagement charts with max 4 concurrent requests...')
      const CONCURRENCY_LIMIT = 4
      const limit = pLimit(CONCURRENCY_LIMIT)

      const [
        profileViewsData,
        pdpViewsData,
        subscriptionsData,
        copiesData,
      ]: [any, any, any, any] = await Promise.all([
        limit(() =>
          fetchInsightsData(
            credentials,
            CHART_IDS.profileViewsByCreator,
            'Profile Views by Creator'
          )
        ),
        limit(() =>
          fetchInsightsData(credentials, CHART_IDS.pdpViewsByPortfolio, 'PDP Views by Portfolio')
        ),
        limit(() =>
          fetchInsightsData(
            credentials,
            CHART_IDS.subscriptionsByCreator,
            'Subscriptions by Creator'
          )
        ),
        limit(() =>
          fetchInsightsData(credentials, CHART_IDS.copiesByCreator, 'Copies by Creator')
        ),
      ])

      console.log('✓ Engagement data fetched successfully with controlled concurrency')

      // Process and insert data into database
      const stats: SyncStats = {
        engagementRecordsFetched: 0,
        totalRecordsInserted: 0,
      }

      const batchSize = 500

      // Process and store portfolio-creator engagement pairs
      console.log('Processing portfolio-creator engagement pairs...')
      const [subscriptionPairs, copyPairs] = processPortfolioCreatorPairs(
        profileViewsData,
        pdpViewsData,
        subscriptionsData,
        copiesData,
        syncStartTime.toISOString()
      )

      // Upsert subscription pairs in batches
      if (subscriptionPairs.length > 0) {
        console.log(`Upserting ${subscriptionPairs.length} subscription pairs...`)
        for (let i = 0; i < subscriptionPairs.length; i += batchSize) {
          const batch = subscriptionPairs.slice(i, i + batchSize)
          const { error: insertError } = await supabase
            .from('user_portfolio_creator_views')
            .upsert(batch, {
              onConflict: 'distinct_id,portfolio_ticker,creator_id',
              ignoreDuplicates: false
            })

          if (insertError) {
            console.error('Error upserting subscription pairs batch:', insertError)
            throw insertError
          }
          console.log(`Upserted batch: ${i + batch.length}/${subscriptionPairs.length} subscription pairs`)
        }
        console.log('✓ Subscription pairs upserted successfully')
        stats.engagementRecordsFetched += subscriptionPairs.length
        stats.totalRecordsInserted += subscriptionPairs.length
      }

      // Upsert copy pairs in batches
      if (copyPairs.length > 0) {
        console.log(`Upserting ${copyPairs.length} copy pairs...`)
        for (let i = 0; i < copyPairs.length; i += batchSize) {
          const batch = copyPairs.slice(i, i + batchSize)
          const { error: insertError } = await supabase
            .from('user_portfolio_creator_copies')
            .upsert(batch, {
              onConflict: 'distinct_id,portfolio_ticker,creator_id',
              ignoreDuplicates: false
            })

          if (insertError) {
            console.error('Error upserting copy pairs batch:', insertError)
            throw insertError
          }
          console.log(`Upserted batch: ${i + batch.length}/${copyPairs.length} copy pairs`)
        }
        console.log('✓ Copy pairs upserted successfully')
      }

      // Portfolio events are now handled by separate sync-mixpanel-portfolio-events function

      // Trigger pattern analysis (NOW USES STORED DATA - no Mixpanel calls)
      // Fire and forget - don't wait for completion to avoid timeout
      console.log('Triggering pattern analysis (using stored data)...')

      // Trigger all three analyses and keep promises alive but don't await
      const analysisPromises = [
        fetch(`${supabaseUrl}/functions/v1/analyze-subscription-patterns`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'apikey': supabaseServiceKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({})
        }).then(() => console.log('✓ Subscription analysis invoked'))
          .catch((err) => console.warn('⚠️ Subscription analysis failed:', err)),

        fetch(`${supabaseUrl}/functions/v1/analyze-copy-patterns`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'apikey': supabaseServiceKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({})
        }).then(() => console.log('✓ Copy analysis invoked'))
          .catch((err) => console.warn('⚠️ Copy analysis failed:', err)),

        fetch(`${supabaseUrl}/functions/v1/analyze-portfolio-sequences`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'apikey': supabaseServiceKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({})
        }).then(() => console.log('✓ Portfolio sequence analysis invoked'))
          .catch((err) => console.warn('⚠️ Portfolio sequence analysis failed:', err))
      ]

      // Keep promises referenced but don't await (fire-and-forget that survives function return)
      Promise.allSettled(analysisPromises)

      console.log('✓ Pattern analysis functions triggered (running in background)')

      // Note: Pattern analysis uses exhaustive search + logistic regression
      // Results stored in conversion_pattern_combinations table
      console.log('Pattern analysis functions use stored engagement data (no duplicate Mixpanel calls)')

      // Refresh materialized view
      console.log('Refreshing main_analysis materialized view...')
      const { error: refreshError } = await supabase.rpc('refresh_main_analysis')
      if (refreshError) {
        console.error('Error refreshing materialized view:', refreshError)
        // Don't throw - this is not critical
      }

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
      console.log('Note: subscription_engagement_summary will be refreshed by analyze-subscription-patterns after pattern analysis completes')

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
