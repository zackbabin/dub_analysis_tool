-- Migration: Fix retention analysis to show distinct users, not sum of cohorts
-- Created: 2025-12-03
-- Purpose: Add total_unique_subscribers column from premium_creator_metrics
--          The "first" column should represent cohort size, not be summed for totals
--
-- Issue: UI was summing "first" column across cohorts, counting resubscriptions
-- Solution: Add total_unique_subscribers from premium_creator_metrics (Chart 85821646)

DROP MATERIALIZED VIEW IF EXISTS premium_creator_retention_analysis CASCADE;

CREATE MATERIALIZED VIEW premium_creator_retention_analysis AS
WITH cohort_subscribers AS (
    -- Get all users who subscribed in each creator/cohort combination
    SELECT
        creator_username,
        cohort_month,
        cohort_date,
        user_id,
        subscribed_count
    FROM premium_creator_retention_events
    WHERE subscribed_count > 0
),
cohort_summary AS (
    -- Count total subscribers per creator/cohort
    SELECT
        creator_username,
        cohort_month,
        cohort_date,
        COUNT(DISTINCT user_id) as initial_subscribers
    FROM cohort_subscribers
    GROUP BY creator_username, cohort_month, cohort_date
),
retention_calculations AS (
    SELECT
        cs.creator_username,
        cs.cohort_month,
        cs.cohort_date,
        summary.initial_subscribers as first,

        -- Month 0 (< 1 Month): Count distinct users who renewed in the same cohort month
        COUNT(DISTINCT CASE
            WHEN renewal.cohort_month = cs.cohort_month
                AND renewal.renewed_count > 0
            THEN renewal.user_id
        END) as month_0_retained,

        -- Month 1: Count distinct users who renewed 1 month after subscription
        COUNT(DISTINCT CASE
            WHEN renewal.cohort_date = cs.cohort_date + INTERVAL '1 month'
                AND renewal.renewed_count > 0
            THEN renewal.user_id
        END) as month_1_retained,

        -- Month 2: Count distinct users who renewed 2 months after subscription
        COUNT(DISTINCT CASE
            WHEN renewal.cohort_date = cs.cohort_date + INTERVAL '2 months'
                AND renewal.renewed_count > 0
            THEN renewal.user_id
        END) as month_2_retained,

        -- Month 3: Count distinct users who renewed 3 months after subscription
        COUNT(DISTINCT CASE
            WHEN renewal.cohort_date = cs.cohort_date + INTERVAL '3 months'
                AND renewal.renewed_count > 0
            THEN renewal.user_id
        END) as month_3_retained,

        -- Month 4: Count distinct users who renewed 4 months after subscription
        COUNT(DISTINCT CASE
            WHEN renewal.cohort_date = cs.cohort_date + INTERVAL '4 months'
                AND renewal.renewed_count > 0
            THEN renewal.user_id
        END) as month_4_retained,

        -- Month 5: Count distinct users who renewed 5 months after subscription
        COUNT(DISTINCT CASE
            WHEN renewal.cohort_date = cs.cohort_date + INTERVAL '5 months'
                AND renewal.renewed_count > 0
            THEN renewal.user_id
        END) as month_5_retained,

        -- Month 6: Count distinct users who renewed 6 months after subscription
        COUNT(DISTINCT CASE
            WHEN renewal.cohort_date = cs.cohort_date + INTERVAL '6 months'
                AND renewal.renewed_count > 0
            THEN renewal.user_id
        END) as month_6_retained

    FROM cohort_subscribers cs
    JOIN cohort_summary summary
        ON cs.creator_username = summary.creator_username
        AND cs.cohort_date = summary.cohort_date
    LEFT JOIN premium_creator_retention_events renewal
        ON cs.user_id = renewal.user_id
        AND cs.creator_username = renewal.creator_username
        AND renewal.cohort_date BETWEEN cs.cohort_date AND cs.cohort_date + INTERVAL '6 months'
    GROUP BY
        cs.creator_username,
        cs.cohort_month,
        cs.cohort_date,
        summary.initial_subscribers
),
-- NEW: Get total unique subscribers from premium_creator_metrics (Chart 85821646)
-- This is the source of truth for distinct subscriber counts
total_subscribers_by_creator AS (
    SELECT
        pc.creator_username,
        COALESCE(pcm.total_subscriptions, 0) as total_unique_subscribers
    FROM (SELECT DISTINCT creator_username FROM premium_creator_retention_events) pc
    LEFT JOIN premium_creators prem ON pc.creator_username = prem.creator_username
    LEFT JOIN premium_creator_metrics pcm ON prem.creator_id = pcm.creator_id
)
SELECT
    rc.creator_username,
    rc.cohort_month,
    rc.cohort_date,
    rc.first,
    ARRAY[
        rc.month_0_retained,
        rc.month_1_retained,
        rc.month_2_retained,
        rc.month_3_retained,
        rc.month_4_retained,
        rc.month_5_retained,
        rc.month_6_retained
    ] as counts,
    -- NEW: Add total_unique_subscribers column for UI display
    ts.total_unique_subscribers
FROM retention_calculations rc
LEFT JOIN total_subscribers_by_creator ts ON rc.creator_username = ts.creator_username
ORDER BY rc.creator_username, rc.cohort_date;

-- Recreate index
CREATE INDEX IF NOT EXISTS idx_retention_analysis_creator ON premium_creator_retention_analysis(creator_username);

-- Grant permissions
GRANT SELECT ON premium_creator_retention_analysis TO anon, authenticated;

COMMENT ON MATERIALIZED VIEW premium_creator_retention_analysis IS
'Creator retention analysis with cohort-level tracking. The "first" column shows cohort size (may include resubscribers).
The "total_unique_subscribers" column shows distinct subscriber count from premium_creator_metrics (Chart 85821646) and should be used for totals display.';

-- Log the changes
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Fixed retention analysis to count distinct users';
  RAISE NOTICE '   - Added total_unique_subscribers column from premium_creator_metrics';
  RAISE NOTICE '   - "first" column shows cohort size (may include resubscriptions)';
  RAISE NOTICE '   - UI should display total_unique_subscribers for totals, not sum of cohort "first" values';
  RAISE NOTICE '';
END $$;
