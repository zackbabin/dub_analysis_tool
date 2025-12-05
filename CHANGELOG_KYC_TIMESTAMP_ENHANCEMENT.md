# Copy Conversion Path Analysis - KYC Timestamp Enhancement

**Date:** 2025-12-05
**Status:** Completed

## Overview

Enhanced the Copy Conversion Path analysis to use KYC approved timestamp as the beginning of the analysis window, rather than analyzing all events before first copy. This provides more accurate conversion path analysis by focusing on the time period between KYC approval and first copy.

## Changes Made

### 1. Database Schema
**File:** `supabase/migrations/20251205_add_kyc_approved_time.sql`

- Added `kyc_approved_time TIMESTAMPTZ` column to `user_first_copies` table
- Created index `idx_user_first_copies_both_timestamps` for efficient filtering of users with both timestamps

### 2. Data Sync Functions

#### sync-first-copy-users (`supabase/functions/sync-first-copy-users/index.ts`)
- Fetches from Mixpanel chart **86612901** for first copy events (existing)
- **NEW:** Fetches from Mixpanel chart **87036512** for KYC approved events
- Maps `kyc_approved_time` to users based on `user_id`
- Stores both timestamps in `user_first_copies` table
- Tracks count of users with both timestamps in sync logs metadata

#### sync-creator-sequences (`supabase/functions/sync-creator-sequences/index.ts`)
- **NEW:** Filters to only include users with both `kyc_approved_time` and `first_copy_time`
- Updated query: `.not('kyc_approved_time', 'is', null).not('first_copy_time', 'is', null)`
- Updated console logging to reflect new filtering criteria
- Added comment explaining that analysis will use timestamp range per-user

#### sync-portfolio-sequences (`supabase/functions/sync-portfolio-sequences/index.ts`)
- **NEW:** Filters to only include users with both `kyc_approved_time` and `first_copy_time`
- Updated query: `.not('kyc_approved_time', 'is', null).not('first_copy_time', 'is', null)`
- Updated console logging to reflect new filtering criteria
- Added comment explaining that analysis will use timestamp range per-user

### 3. Analysis Functions

#### analyze-portfolio-sequences (`supabase/functions/analyze-portfolio-sequences/index.ts`)
- Updated header comments to reflect new timestamp-based filtering
- Documentation now states: "Calculates average unique portfolio views between KYC approval and first copy"

#### analyze-creator-sequences (`supabase/functions/analyze-creator-sequences/index.ts`)
- Updated header comments to reflect new timestamp-based filtering
- Documentation now states: "Calculates average unique creator profile views between KYC approval and first copy"

### 4. SQL Analysis Functions
**File:** `supabase/migrations/20251205_update_copy_path_analysis_with_kyc_timestamps.sql`

#### analyze_portfolio_copy_paths()
- **NEW:** Only analyzes users with both `kyc_approved_time` and `first_copy_time`
- **NEW:** Filters portfolio views: `WHERE ps.event_time >= ac.kyc_approved_time AND ps.event_time < ac.first_copy_time`
- Updated total converter count to only include users with both timestamps

#### analyze_creator_copy_paths()
- **NEW:** Only analyzes users with both `kyc_approved_time` and `first_copy_time`
- **NEW:** Filters creator views: `WHERE cs.event_time >= ac.kyc_approved_time AND cs.event_time < ac.first_copy_time`
- Updated total converter count to only include users with both timestamps

#### calculate_portfolio_sequence_metrics()
- **NEW:** Only analyzes users with both timestamps
- **NEW:** Filters events to timestamp range per-user
- Calculates mean/median unique portfolios viewed in the KYC → first copy window

#### calculate_creator_sequence_metrics()
- **NEW:** Only analyzes users with both timestamps
- **NEW:** Filters events to timestamp range per-user
- Calculates mean/median unique creators viewed in the KYC → first copy window

## How It Works

### Data Flow

1. **sync-first-copy-users** runs first:
   - Fetches first copy times from Mixpanel chart 86612901
   - Fetches KYC approved times from Mixpanel chart 87036512
   - Maps both timestamps to users by `user_id`
   - Upserts to `user_first_copies` table with both columns populated

2. **sync-creator-sequences** and **sync-portfolio-sequences** run next:
   - Query `user_first_copies` for users with BOTH timestamps
   - Fetch creator/portfolio view events from Mixpanel Export API for those users
   - Store raw events in `creator_sequences_raw` and `portfolio_sequences_raw`

3. **analyze-creator-sequences** and **analyze-portfolio-sequences** run last:
   - Call SQL functions that filter events per-user between `kyc_approved_time` and `first_copy_time`
   - Generate conversion path analysis based on this bounded time window

### Per-User Time Windows

Each user has their own analysis window:
- **Start:** `kyc_approved_time` (when user completed KYC)
- **End:** `first_copy_time` (when user made their first copy)
- **Events analyzed:** Only creator/portfolio views within this window

This provides accurate conversion path analysis that excludes:
- Events before KYC approval (user wasn't eligible to copy yet)
- Events after first copy (no longer relevant to conversion)

## Backward Compatibility

- Users without `kyc_approved_time` are automatically excluded from analysis
- Existing data sync functions continue to work
- No breaking changes to API or table structures
- Column is nullable, so existing rows are not affected

## Testing Recommendations

1. Run `sync-first-copy-users` to populate `kyc_approved_time` column
2. Verify users have both timestamps:
   ```sql
   SELECT COUNT(*) FROM user_first_copies WHERE kyc_approved_time IS NOT NULL AND first_copy_time IS NOT NULL;
   ```
3. Run `sync-creator-sequences` and `sync-portfolio-sequences`
4. Run `analyze-creator-sequences` and `analyze-portfolio-sequences`
5. Verify results show events only within timestamp ranges

## Files Modified

- `supabase/migrations/20251205_add_kyc_approved_time.sql` (new)
- `supabase/migrations/20251205_update_copy_path_analysis_with_kyc_timestamps.sql` (new)
- `supabase/functions/sync-first-copy-users/index.ts` (modified)
- `supabase/functions/sync-creator-sequences/index.ts` (modified)
- `supabase/functions/sync-portfolio-sequences/index.ts` (modified)
- `supabase/functions/analyze-creator-sequences/index.ts` (modified)
- `supabase/functions/analyze-portfolio-sequences/index.ts` (modified)
