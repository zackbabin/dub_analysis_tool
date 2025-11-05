-- Fix premium_creator_retention_analysis materialized view
-- The previous version had incorrect retention calculation logic
-- This version properly tracks users from initial subscription cohort through renewal events

DROP MATERIALIZED VIEW IF EXISTS premium_creator_retention_analysis CASCADE;

CREATE MATERIALIZED VIEW premium_creator_retention_analysis AS
WITH cohort_subscribers AS (
    -- Get all users who subscribed in each creator/cohort combination
    SELECT
        creator_username,
        cohort_month,
        cohort_date,
        distinct_id,
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
        COUNT(DISTINCT distinct_id) as initial_subscribers
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
            THEN renewal.distinct_id
        END) as month_0_retained,

        -- Month 1: Count distinct users who renewed 1 month after subscription
        COUNT(DISTINCT CASE
            WHEN renewal.cohort_date = cs.cohort_date + INTERVAL '1 month'
                AND renewal.renewed_count > 0
            THEN renewal.distinct_id
        END) as month_1_retained,

        -- Month 2: Count distinct users who renewed 2 months after subscription
        COUNT(DISTINCT CASE
            WHEN renewal.cohort_date = cs.cohort_date + INTERVAL '2 months'
                AND renewal.renewed_count > 0
            THEN renewal.distinct_id
        END) as month_2_retained,

        -- Month 3: Count distinct users who renewed 3 months after subscription
        COUNT(DISTINCT CASE
            WHEN renewal.cohort_date = cs.cohort_date + INTERVAL '3 months'
                AND renewal.renewed_count > 0
            THEN renewal.distinct_id
        END) as month_3_retained,

        -- Month 4: Count distinct users who renewed 4 months after subscription
        COUNT(DISTINCT CASE
            WHEN renewal.cohort_date = cs.cohort_date + INTERVAL '4 months'
                AND renewal.renewed_count > 0
            THEN renewal.distinct_id
        END) as month_4_retained,

        -- Month 5: Count distinct users who renewed 5 months after subscription
        COUNT(DISTINCT CASE
            WHEN renewal.cohort_date = cs.cohort_date + INTERVAL '5 months'
                AND renewal.renewed_count > 0
            THEN renewal.distinct_id
        END) as month_5_retained,

        -- Month 6: Count distinct users who renewed 6 months after subscription
        COUNT(DISTINCT CASE
            WHEN renewal.cohort_date = cs.cohort_date + INTERVAL '6 months'
                AND renewal.renewed_count > 0
            THEN renewal.distinct_id
        END) as month_6_retained

    FROM cohort_subscribers cs
    JOIN cohort_summary summary
        ON cs.creator_username = summary.creator_username
        AND cs.cohort_date = summary.cohort_date
    LEFT JOIN premium_creator_retention_events renewal
        ON cs.distinct_id = renewal.distinct_id
        AND cs.creator_username = renewal.creator_username
        AND renewal.cohort_date BETWEEN cs.cohort_date AND cs.cohort_date + INTERVAL '6 months'
    GROUP BY
        cs.creator_username,
        cs.cohort_month,
        cs.cohort_date,
        summary.initial_subscribers
)
SELECT
    creator_username,
    cohort_month,
    cohort_date,
    first,
    ARRAY[
        month_0_retained,
        month_1_retained,
        month_2_retained,
        month_3_retained,
        month_4_retained,
        month_5_retained,
        month_6_retained
    ] as counts
FROM retention_calculations
ORDER BY creator_username, cohort_date;

-- Recreate index
CREATE INDEX IF NOT EXISTS idx_retention_analysis_creator ON premium_creator_retention_analysis(creator_username);

-- Grant permissions
GRANT SELECT ON premium_creator_retention_analysis TO anon, authenticated;
