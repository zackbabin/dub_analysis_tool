// Supabase Edge Function: sync-stripe-subscriptions
// Fetches Connected Accounts and their Subscriptions from Stripe API
// Stores data in stripe_connected_accounts and stripe_subscriptions tables
// Triggered manually by user clicking "Sync Stripe Data" button in Premium Creator Analysis

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const STRIPE_API_BASE = 'https://api.stripe.com/v1'
const BATCH_SIZE = 100 // Stripe API limit

interface StripeAccount {
  id: string
  type: string
  charges_enabled: boolean
  payouts_enabled: boolean
  individual?: {
    first_name?: string
    last_name?: string
  }
  business_profile?: {
    name?: string
  }
  [key: string]: any
}

interface StripeSubscription {
  id: string
  customer: string
  status: string
  items: {
    data: Array<{
      price: {
        id: string
      }
    }>
  }
  created: number
  canceled_at?: number
  current_period_start: number
  current_period_end: number
  cancellation_details?: {
    reason?: string
    comment?: string
  }
  [key: string]: any
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Get Stripe API key from Supabase secrets
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY')

    if (!stripeSecretKey) {
      throw new Error('STRIPE_SECRET_KEY not configured in Supabase secrets')
    }

    console.log('Stripe API key loaded from secrets')

    // Initialize Supabase client with service role key
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Create sync log entry
    const syncStartTime = new Date()
    const { data: syncLogData, error: syncLogError } = await supabase
      .from('stripe_sync_log')
      .insert({
        sync_type: 'full',
        status: 'started',
        started_at: syncStartTime.toISOString(),
      })
      .select()
      .single()

    if (syncLogError) {
      console.error('Error creating sync log:', syncLogError)
      throw syncLogError
    }

    const syncLogId = syncLogData.id

    let accountsSynced = 0
    let subscriptionsSynced = 0
    let errorsCount = 0
    const errors: string[] = []

    try {
      console.log('Starting Stripe data sync...')

      // Step 1: Fetch all Connected Accounts
      console.log('Fetching Connected Accounts...')
      const accounts = await fetchAllConnectedAccounts(stripeSecretKey)
      console.log(`Found ${accounts.length} Connected Accounts`)

      // Step 2: Store Connected Accounts in database
      for (const account of accounts) {
        try {
          const creatorName = getCreatorName(account)

          const { error: accountError } = await supabase
            .from('stripe_connected_accounts')
            .upsert({
              stripe_account_id: account.id,
              creator_name: creatorName,
              account_type: account.type,
              charges_enabled: account.charges_enabled,
              payouts_enabled: account.payouts_enabled,
              metadata: account,
              synced_at: new Date().toISOString(),
            }, {
              onConflict: 'stripe_account_id',
            })

          if (accountError) {
            console.error(`Error storing account ${account.id}:`, accountError)
            errors.push(`Account ${account.id}: ${accountError.message}`)
            errorsCount++
          } else {
            accountsSynced++
          }
        } catch (err) {
          console.error(`Error processing account ${account.id}:`, err)
          errors.push(`Account ${account.id}: ${err.message}`)
          errorsCount++
        }
      }

      console.log(`Stored ${accountsSynced} Connected Accounts`)

      // Step 3: Fetch and store subscriptions for each account
      console.log('Fetching subscriptions for each account...')

      for (const account of accounts) {
        try {
          const subscriptions = await fetchSubscriptionsForAccount(
            stripeSecretKey,
            account.id
          )

          console.log(`Found ${subscriptions.length} subscriptions for account ${account.id}`)

          // Store each subscription
          for (const subscription of subscriptions) {
            try {
              const isRefunded = checkIfRefunded(subscription)

              const { error: subError } = await supabase
                .from('stripe_subscriptions')
                .upsert({
                  stripe_subscription_id: subscription.id,
                  stripe_account_id: account.id,
                  stripe_customer_id: subscription.customer,
                  stripe_price_id: subscription.items.data[0]?.price?.id || null,
                  status: subscription.status,
                  is_refunded: isRefunded,
                  cancellation_reason: subscription.cancellation_details?.reason || null,
                  subscription_created_at: new Date(subscription.created * 1000).toISOString(),
                  canceled_at: subscription.canceled_at
                    ? new Date(subscription.canceled_at * 1000).toISOString()
                    : null,
                  current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
                  current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
                  metadata: subscription,
                  synced_at: new Date().toISOString(),
                }, {
                  onConflict: 'stripe_subscription_id',
                })

              if (subError) {
                console.error(`Error storing subscription ${subscription.id}:`, subError)
                errors.push(`Subscription ${subscription.id}: ${subError.message}`)
                errorsCount++
              } else {
                subscriptionsSynced++
              }
            } catch (err) {
              console.error(`Error processing subscription ${subscription.id}:`, err)
              errors.push(`Subscription ${subscription.id}: ${err.message}`)
              errorsCount++
            }
          }
        } catch (err) {
          console.error(`Error fetching subscriptions for account ${account.id}:`, err)
          errors.push(`Fetching subscriptions for ${account.id}: ${err.message}`)
          errorsCount++
        }
      }

      console.log(`Stored ${subscriptionsSynced} subscriptions`)

      // Update sync log with completion
      await supabase
        .from('stripe_sync_log')
        .update({
          status: 'completed',
          accounts_synced: accountsSynced,
          subscriptions_synced: subscriptionsSynced,
          errors_count: errorsCount,
          error_message: errors.length > 0 ? errors.join('; ') : null,
          completed_at: new Date().toISOString(),
        })
        .eq('id', syncLogId)

      console.log('Stripe data sync completed successfully')

      return new Response(
        JSON.stringify({
          success: true,
          accounts_synced: accountsSynced,
          subscriptions_synced: subscriptionsSynced,
          errors_count: errorsCount,
          errors: errors.length > 0 ? errors : undefined,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      )
    } catch (error) {
      // Update sync log with failure
      await supabase
        .from('stripe_sync_log')
        .update({
          status: 'failed',
          accounts_synced: accountsSynced,
          subscriptions_synced: subscriptionsSynced,
          errors_count: errorsCount + 1,
          error_message: error.message,
          error_details: { stack: error.stack, errors },
          completed_at: new Date().toISOString(),
        })
        .eq('id', syncLogId)

      throw error
    }
  } catch (error) {
    console.error('Error in sync-stripe-subscriptions function:', error)

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    )
  }
})

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Fetch all Connected Accounts from Stripe with pagination
 */
async function fetchAllConnectedAccounts(apiKey: string): Promise<StripeAccount[]> {
  const accounts: StripeAccount[] = []
  let hasMore = true
  let startingAfter: string | null = null

  while (hasMore) {
    const params = new URLSearchParams({
      limit: BATCH_SIZE.toString(),
    })

    if (startingAfter) {
      params.append('starting_after', startingAfter)
    }

    const response = await fetch(`${STRIPE_API_BASE}/accounts?${params}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Stripe API error (${response.status}): ${errorText}`)
    }

    const data = await response.json()
    accounts.push(...data.data)

    hasMore = data.has_more
    if (hasMore && data.data.length > 0) {
      startingAfter = data.data[data.data.length - 1].id
    }

    console.log(`Fetched ${accounts.length} accounts so far...`)
  }

  return accounts
}

/**
 * Fetch all subscriptions for a specific Connected Account
 */
async function fetchSubscriptionsForAccount(
  apiKey: string,
  accountId: string
): Promise<StripeSubscription[]> {
  const subscriptions: StripeSubscription[] = []
  let hasMore = true
  let startingAfter: string | null = null

  while (hasMore) {
    const params = new URLSearchParams({
      limit: BATCH_SIZE.toString(),
      status: 'all', // Fetch all statuses (active, canceled, etc.)
    })

    if (startingAfter) {
      params.append('starting_after', startingAfter)
    }

    const response = await fetch(`${STRIPE_API_BASE}/subscriptions?${params}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Stripe-Account': accountId, // Query subscriptions for this connected account
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Stripe API error (${response.status}): ${errorText}`)
    }

    const data = await response.json()
    subscriptions.push(...data.data)

    hasMore = data.has_more
    if (hasMore && data.data.length > 0) {
      startingAfter = data.data[data.data.length - 1].id
    }
  }

  return subscriptions
}

/**
 * Extract creator name from Connected Account
 * Uses individual.first_name + individual.last_name or business_profile.name
 */
function getCreatorName(account: StripeAccount): string | null {
  // Try individual account first
  if (account.individual) {
    const firstName = account.individual.first_name || ''
    const lastName = account.individual.last_name || ''
    const fullName = `${firstName} ${lastName}`.trim()
    if (fullName) {
      return fullName
    }
  }

  // Try business profile
  if (account.business_profile?.name) {
    return account.business_profile.name
  }

  return null
}

/**
 * Check if subscription is refunded
 * Uses cancellation_details.reason === 'payment_disputed'
 */
function checkIfRefunded(subscription: StripeSubscription): boolean {
  return subscription.cancellation_details?.reason === 'payment_disputed'
}
