-- Add Missing Unique Constraints
-- These constraints are required by the upsert operations in sync-mixpanel
-- IMPORTANT: Run this during a maintenance window when no syncs are running

-- ===========================================================================
-- SAFETY CHECKS - Run these first to verify no duplicates exist
-- ===========================================================================

-- Check for duplicates in time_funnels
DO $$
DECLARE
    duplicate_count INTEGER;
BEGIN
    SELECT COUNT(*)
    INTO duplicate_count
    FROM (
        SELECT distinct_id, funnel_type, synced_at, COUNT(*) as cnt
        FROM time_funnels
        GROUP BY distinct_id, funnel_type, synced_at
        HAVING COUNT(*) > 1
    ) duplicates;

    IF duplicate_count > 0 THEN
        RAISE NOTICE 'WARNING: Found % duplicate combinations in time_funnels', duplicate_count;
        RAISE NOTICE 'Run cleanup script before adding constraint';
    ELSE
        RAISE NOTICE 'No duplicates found in time_funnels - safe to add constraint';
    END IF;
END $$;

-- Check for duplicates in subscribers_insights
DO $$
DECLARE
    duplicate_count INTEGER;
BEGIN
    SELECT COUNT(*)
    INTO duplicate_count
    FROM (
        SELECT distinct_id, synced_at, COUNT(*) as cnt
        FROM subscribers_insights
        GROUP BY distinct_id, synced_at
        HAVING COUNT(*) > 1
    ) duplicates;

    IF duplicate_count > 0 THEN
        RAISE NOTICE 'WARNING: Found % duplicate combinations in subscribers_insights', duplicate_count;
        RAISE NOTICE 'Run cleanup script before adding constraint';
    ELSE
        RAISE NOTICE 'No duplicates found in subscribers_insights - safe to add constraint';
    END IF;
END $$;

-- ===========================================================================
-- ADD CONSTRAINTS (Only run if no duplicates found above)
-- ===========================================================================

-- Constraint for time_funnels
-- This matches the upsert operation in sync-mixpanel line 276
ALTER TABLE time_funnels
ADD CONSTRAINT time_funnels_unique_key
UNIQUE (distinct_id, funnel_type, synced_at);

-- Constraint for subscribers_insights
-- This matches the upsert operation in sync-mixpanel line 238
ALTER TABLE subscribers_insights
ADD CONSTRAINT subscribers_insights_unique_key
UNIQUE (distinct_id, synced_at);

-- ===========================================================================
-- VERIFICATION
-- ===========================================================================

-- Verify constraints were added
SELECT
    conname as constraint_name,
    conrelid::regclass as table_name,
    pg_get_constraintdef(oid) as definition
FROM pg_constraint
WHERE conname IN ('time_funnels_unique_key', 'subscribers_insights_unique_key');
