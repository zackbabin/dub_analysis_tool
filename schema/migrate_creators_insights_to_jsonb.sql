-- Migration: Add JSONB metrics column to creators_insights
-- Maintains core columns for frequent queries while adding flexibility for new metrics
-- Includes comprehensive indexing strategy for performance

-- Step 1: Backup existing data (optional but recommended)
-- CREATE TABLE creators_insights_backup AS SELECT * FROM creators_insights;

-- Step 2: Add new metrics JSONB column
ALTER TABLE creators_insights ADD COLUMN IF NOT EXISTS metrics jsonb;

-- Step 3: Migrate existing data to JSONB format
-- This preserves all existing metrics in the flexible metrics column
UPDATE creators_insights
SET metrics = jsonb_build_object(
    'total_profile_views', total_profile_views,
    'total_pdp_views', total_pdp_views,
    'total_paywall_views', total_paywall_views,
    'total_stripe_views', total_stripe_views,
    'total_subscriptions', total_subscriptions,
    'total_subscription_revenue', total_subscription_revenue,
    'total_cancelled_subscriptions', total_cancelled_subscriptions,
    'total_expired_subscriptions', total_expired_subscriptions,
    'total_copies', total_copies,
    'total_investment_count', total_investment_count,
    'total_investments', total_investments
)
WHERE metrics IS NULL;

-- Step 4: Create GIN index for general JSONB queries (enables all operators)
CREATE INDEX IF NOT EXISTS idx_creators_insights_metrics_gin
ON creators_insights USING gin(metrics);

-- Step 5: Create specialized indexes for frequently queried fields
-- These make specific field queries as fast as regular columns

-- Subscription-related metrics (most critical for analysis)
CREATE INDEX IF NOT EXISTS idx_creators_metrics_total_subscriptions
ON creators_insights((metrics->>'total_subscriptions'));

CREATE INDEX IF NOT EXISTS idx_creators_metrics_total_paywall_views
ON creators_insights((metrics->>'total_paywall_views'));

CREATE INDEX IF NOT EXISTS idx_creators_metrics_total_stripe_views
ON creators_insights((metrics->>'total_stripe_views'));

-- Copy-related metrics
CREATE INDEX IF NOT EXISTS idx_creators_metrics_total_copies
ON creators_insights((metrics->>'total_copies'));

-- Engagement metrics
CREATE INDEX IF NOT EXISTS idx_creators_metrics_total_pdp_views
ON creators_insights((metrics->>'total_pdp_views'));

CREATE INDEX IF NOT EXISTS idx_creators_metrics_total_profile_views
ON creators_insights((metrics->>'total_profile_views'));

-- Revenue metrics
CREATE INDEX IF NOT EXISTS idx_creators_metrics_subscription_revenue
ON creators_insights((metrics->>'total_subscription_revenue'));

CREATE INDEX IF NOT EXISTS idx_creators_metrics_total_investments
ON creators_insights((metrics->>'total_investments'));

-- Step 6: Add constraint to ensure metrics is not null for new records
ALTER TABLE creators_insights
ALTER COLUMN metrics SET DEFAULT '{}'::jsonb;

-- Step 7: Verify migration
SELECT
    'Migration verification' as check_type,
    COUNT(*) as total_rows,
    COUNT(metrics) as rows_with_metrics,
    COUNT(*) - COUNT(metrics) as rows_missing_metrics
FROM creators_insights;

-- Step 8: Show sample of migrated data
SELECT
    creator_id,
    creator_username,
    creator_type,
    metrics->>'total_subscriptions' as total_subscriptions_jsonb,
    metrics->>'total_copies' as total_copies_jsonb,
    metrics->>'total_pdp_views' as total_pdp_views_jsonb,
    synced_at
FROM creators_insights
ORDER BY synced_at DESC
LIMIT 5;

-- Step 9: Show index usage information
SELECT
    schemaname,
    indexrelname as indexname,
    idx_scan as times_used,
    idx_tup_read as tuples_read,
    idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes
WHERE relname = 'creators_insights'
ORDER BY idx_scan DESC;

-- ============================================================================
-- OPTIONAL: Drop old columns after verifying migration works
-- ============================================================================
-- IMPORTANT: Only run these after confirming edge functions are updated
-- and the application is using the JSONB metrics column

-- ALTER TABLE creators_insights DROP COLUMN IF EXISTS total_profile_views;
-- ALTER TABLE creators_insights DROP COLUMN IF EXISTS total_pdp_views;
-- ALTER TABLE creators_insights DROP COLUMN IF EXISTS total_paywall_views;
-- ALTER TABLE creators_insights DROP COLUMN IF EXISTS total_stripe_views;
-- ALTER TABLE creators_insights DROP COLUMN IF EXISTS total_subscriptions;
-- ALTER TABLE creators_insights DROP COLUMN IF EXISTS total_subscription_revenue;
-- ALTER TABLE creators_insights DROP COLUMN IF EXISTS total_cancelled_subscriptions;
-- ALTER TABLE creators_insights DROP COLUMN IF EXISTS total_expired_subscriptions;
-- ALTER TABLE creators_insights DROP COLUMN IF EXISTS total_copies;
-- ALTER TABLE creators_insights DROP COLUMN IF EXISTS total_investment_count;
-- ALTER TABLE creators_insights DROP COLUMN IF EXISTS total_investments;

-- ============================================================================
-- NOTES ON QUERYING JSONB FIELDS
-- ============================================================================
--
-- Instead of: SELECT total_subscriptions FROM creators_insights
-- Use:        SELECT metrics->>'total_subscriptions' FROM creators_insights
--
-- For numeric operations, cast the result:
-- SELECT (metrics->>'total_subscriptions')::integer FROM creators_insights
--
-- For filtering:
-- WHERE (metrics->>'total_subscriptions')::integer > 10
--
-- For sorting:
-- ORDER BY (metrics->>'total_subscriptions')::integer DESC
--
-- The indexes above make these queries perform similarly to regular columns
