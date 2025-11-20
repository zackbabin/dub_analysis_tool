/**
 * Shared Sync Utilities
 *
 * Common patterns for Edge Functions that sync data from Mixpanel to Supabase.
 * Consolidates repetitive initialization, sync log management, and response handling.
 *
 * Used by: sync-creator-data, sync-mixpanel-user-events, sync-mixpanel-engagement, sync-event-sequences
 */

import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { CORS_HEADERS, type MixpanelCredentials, shouldSkipSync } from './mixpanel-api.ts'

// ============================================================================
// 0. TIMEOUT MANAGEMENT
// ============================================================================

// Edge Functions have a 150-second hard timeout
// We check at 140 seconds to gracefully handle timeout and return partial results
export const EDGE_FUNCTION_TIMEOUT_MS = 150000 // 150 seconds (hard limit)
export const PREEMPTIVE_TIMEOUT_MS = 140000    // 140 seconds (our check threshold)

/**
 * Timeout Guard - Tracks execution time and checks if we're approaching timeout
 *
 * Usage:
 *   const timeoutGuard = new TimeoutGuard(startTime);
 *   if (timeoutGuard.isApproachingTimeout()) {
 *     console.warn('⏱️ Approaching timeout, returning partial results');
 *     return createSuccessResponse(...);
 *   }
 */
export class TimeoutGuard {
  private startTime: number

  constructor(startTime: number = Date.now()) {
    this.startTime = startTime
  }

  /**
   * Check if we're within 10 seconds of the hard timeout (140+ seconds elapsed)
   */
  isApproachingTimeout(): boolean {
    const elapsed = Date.now() - this.startTime
    return elapsed >= PREEMPTIVE_TIMEOUT_MS
  }

  /**
   * Get elapsed time in milliseconds
   */
  getElapsedMs(): number {
    return Date.now() - this.startTime
  }

  /**
   * Get elapsed time in seconds
   */
  getElapsedSeconds(): number {
    return Math.round(this.getElapsedMs() / 1000)
  }

  /**
   * Get remaining time before preemptive timeout in milliseconds
   */
  getRemainingMs(): number {
    return Math.max(0, PREEMPTIVE_TIMEOUT_MS - this.getElapsedMs())
  }

  /**
   * Log current timeout status
   */
  logStatus(context: string): void {
    const elapsed = this.getElapsedSeconds()
    const remaining = Math.round(this.getRemainingMs() / 1000)
    console.log(`⏱️ [${context}] Elapsed: ${elapsed}s, Remaining: ${remaining}s`)
  }
}

// ============================================================================
// 1. INITIALIZATION UTILITIES
// ============================================================================

/**
 * Initialize Mixpanel credentials from environment variables
 * @throws {Error} If credentials are not configured in Supabase secrets
 * @returns {MixpanelCredentials} Mixpanel username and secret
 */
export function initializeMixpanelCredentials(): MixpanelCredentials {
  const mixpanelUsername = Deno.env.get('MIXPANEL_SERVICE_USERNAME')
  const mixpanelSecret = Deno.env.get('MIXPANEL_SERVICE_SECRET')

  if (!mixpanelUsername || !mixpanelSecret) {
    throw new Error('Mixpanel credentials not configured in Supabase secrets')
  }

  console.log('Mixpanel credentials loaded from secrets')

  return {
    username: mixpanelUsername,
    secret: mixpanelSecret,
  }
}

/**
 * Initialize Supabase client with service role key
 * @throws {Error} If Supabase URL or service key not configured
 * @returns {SupabaseClient} Authenticated Supabase client
 */
export function initializeSupabaseClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Supabase URL and service key must be configured')
  }

  return createClient(supabaseUrl, supabaseServiceKey)
}

// ============================================================================
// 2. HTTP HANDLING UTILITIES
// ============================================================================

/**
 * Handle CORS preflight requests
 * @param {Request} req - Incoming HTTP request
 * @returns {Response | null} Response for OPTIONS requests, or null for other methods
 */
export function handleCorsRequest(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }
  return null
}

/**
 * Check if sync should be skipped and return skip response if needed
 * @param {SupabaseClient} supabase - Supabase client instance
 * @param {string} source - Source identifier for sync logs (e.g., 'mixpanel_users')
 * @param {number} lookbackHours - Hours to look back for recent syncs (default: 1)
 * @returns {Promise<Response | null>} Skip response if should skip, null otherwise
 */
export async function checkAndHandleSkipSync(
  supabase: SupabaseClient,
  source: string,
  lookbackHours: number = 1
): Promise<Response | null> {
  // TEMPORARILY DISABLED FOR TESTING - ALWAYS ALLOW SYNC
  // UNCOMMENT THE CODE BELOW AFTER TESTING IS COMPLETE
  /*
  const { shouldSkip, lastSyncTime } = await shouldSkipSync(supabase, source, lookbackHours)

  if (shouldSkip) {
    return new Response(
      JSON.stringify({
        success: true,
        skipped: true,
        message: `Sync skipped - data refreshed within last ${lookbackHours} hour${lookbackHours > 1 ? 's' : ''}`,
        lastSyncTime: lastSyncTime?.toISOString(),
        stats: { skipped: true, reason: `Data synced within last ${lookbackHours} hour${lookbackHours > 1 ? 's' : ''}` }
      }),
      {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  }
  */

  console.log('⚠️ SKIP LOGIC TEMPORARILY DISABLED - ALWAYS ALLOWING SYNC')
  return null
}

// ============================================================================
// 3. SYNC LOG MANAGEMENT UTILITIES
// ============================================================================

/**
 * Create a new sync log entry in sync_logs table
 * @param {SupabaseClient} supabase - Supabase client instance
 * @param {string} toolType - Type of tool ('user' or 'creator')
 * @param {string} source - Source identifier (e.g., 'mixpanel_users', 'mixpanel_user_profiles')
 * @returns {Promise<{syncLog: any, syncStartTime: Date}>} Sync log record and start timestamp
 * @throws {Error} If sync log creation fails
 */
export async function createSyncLog(
  supabase: SupabaseClient,
  toolType: string,
  source: string
): Promise<{ syncLog: any; syncStartTime: Date }> {
  const syncStartTime = new Date()

  const { data: syncLog, error: syncLogError } = await supabase
    .from('sync_logs')
    .insert({
      tool_type: toolType,
      sync_started_at: syncStartTime.toISOString(),
      sync_status: 'in_progress',
      source: source,
      triggered_by: 'manual',
    })
    .select()
    .single()

  if (syncLogError) {
    console.error('Failed to create sync log:', syncLogError)
    throw syncLogError
  }

  console.log(`Created sync log with ID: ${syncLog.id}`)

  return { syncLog, syncStartTime }
}

/**
 * Update sync log entry with success status and stats
 * @param {SupabaseClient} supabase - Supabase client instance
 * @param {string} syncLogId - ID of sync log entry to update
 * @param {Record<string, any>} stats - Statistics to store (varies per function)
 * @param {Date} syncStartTime - Optional start time to calculate duration
 */
export async function updateSyncLogSuccess(
  supabase: SupabaseClient,
  syncLogId: string,
  stats: Record<string, any>,
  syncStartTime?: Date
): Promise<void> {
  const syncEndTime = new Date()
  const updateData: Record<string, any> = {
    sync_completed_at: syncEndTime.toISOString(),
    sync_status: 'completed',
    ...stats, // Spread stats directly into update (allows flexible stat fields)
  }

  // Add duration if start time provided
  if (syncStartTime) {
    updateData.duration_seconds = Math.round((syncEndTime.getTime() - syncStartTime.getTime()) / 1000)
  }

  await supabase
    .from('sync_logs')
    .update(updateData)
    .eq('id', syncLogId)

  console.log(`✅ Sync log ${syncLogId} updated with success status`)
}

/**
 * Update sync log entry with failure status and error details
 * @param {SupabaseClient} supabase - Supabase client instance
 * @param {string} syncLogId - ID of sync log entry to update
 * @param {any} error - Error object or string
 */
export async function updateSyncLogFailure(
  supabase: SupabaseClient,
  syncLogId: string,
  error: any
): Promise<void> {
  await supabase
    .from('sync_logs')
    .update({
      sync_completed_at: new Date().toISOString(),
      sync_status: 'failed',
      error_message: error instanceof Error ? error.message : String(error),
      error_details: { stack: error?.stack || String(error) },
    })
    .eq('id', syncLogId)

  console.log(`❌ Sync log ${syncLogId} updated with failure status`)
}

// ============================================================================
// 4. RATE LIMITING UTILITIES
// ============================================================================

/**
 * Handle Mixpanel rate limit errors gracefully
 * @param {SupabaseClient} supabase - Supabase client instance
 * @param {string} syncLogId - ID of sync log entry to update
 * @param {any} error - Error object from Mixpanel API
 * @param {Record<string, any>} emptyStats - Stats object with zero values
 * @returns {Promise<Response | null>} Rate limit response if error is rate limit, null otherwise
 */
export async function handleRateLimitError(
  supabase: SupabaseClient,
  syncLogId: string,
  error: any,
  emptyStats: Record<string, any>
): Promise<Response | null> {
  // Check if error is a rate limit error
  if (error.isRateLimited || error.statusCode === 429) {
    console.warn('⚠️ Mixpanel rate limit reached - continuing workflow with existing data')

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
        stats: emptyStats,
      }),
      {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  }

  // Not a rate limit error - return null to indicate error should be re-thrown
  return null
}

// ============================================================================
// 5. RESPONSE UTILITIES
// ============================================================================

/**
 * Create standardized success response
 * @param {string} message - Success message
 * @param {Record<string, any>} stats - Statistics to return in response
 * @param {Record<string, any>} extraFields - Optional additional fields to include
 * @returns {Response} Success response with 200 status
 */
export function createSuccessResponse(
  message: string,
  stats: Record<string, any>,
  extraFields?: Record<string, any>
): Response {
  return new Response(
    JSON.stringify({
      success: true,
      message,
      stats,
      ...extraFields, // Allow additional fields like 'note'
    }),
    {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      status: 200,
    }
  )
}

/**
 * Create standardized error response
 * @param {any} error - Error object or string
 * @param {string} functionName - Name of function for logging
 * @returns {Response} Error response with 500 status
 */
export function createErrorResponse(error: any, functionName: string): Response {
  console.error(`Error in ${functionName} function:`, error)

  return new Response(
    JSON.stringify({
      success: false,
      error: error?.message || 'Unknown error occurred',
      details: error?.stack || String(error),
    }),
    {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      status: 500,
    }
  )
}
