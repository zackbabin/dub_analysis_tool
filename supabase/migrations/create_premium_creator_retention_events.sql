-- Create table to store premium creator retention events from Mixpanel Chart 85857452
-- Stores subscription and renewal events by user, creator, and time cohort

CREATE TABLE IF NOT EXISTS premium_creator_retention_events (
    distinct_id TEXT NOT NULL,
    creator_username TEXT NOT NULL,
    cohort_month TEXT NOT NULL,  -- Format: "Aug 2025", "Sep 2025", etc.
    cohort_date DATE NOT NULL,    -- Parsed date for sorting/filtering
    subscribed_count INT DEFAULT 0,
    renewed_count INT DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (distinct_id, creator_username, cohort_month)
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_retention_events_creator ON premium_creator_retention_events(creator_username);
CREATE INDEX IF NOT EXISTS idx_retention_events_cohort ON premium_creator_retention_events(cohort_date);
CREATE INDEX IF NOT EXISTS idx_retention_events_creator_cohort ON premium_creator_retention_events(creator_username, cohort_date);

-- Create materialized view to calculate retention metrics by creator and cohort
CREATE MATERIALIZED VIEW IF NOT EXISTS premium_creator_retention_analysis AS
WITH cohort_base AS (
    -- Get all unique cohorts and their initial subscription counts
    SELECT
        creator_username,
        cohort_month,
        cohort_date,
        SUM(subscribed_count) as initial_subscribers,
        SUM(renewed_count) as same_month_renewals
    FROM premium_creator_retention_events
    GROUP BY creator_username, cohort_month, cohort_date
),
cohort_renewals AS (
    -- Get renewal counts for each cohort at different time offsets
    SELECT
        base.creator_username,
        base.cohort_month,
        base.cohort_date,
        base.initial_subscribers,
        base.same_month_renewals,
        -- Month 0 (< 1 Month): renewals in same cohort month
        base.same_month_renewals as month_0_retained,
        -- Month 1: renewals in next month
        COALESCE(SUM(CASE
            WHEN future.cohort_date = base.cohort_date + INTERVAL '1 month'
            THEN future.renewed_count
            ELSE 0
        END), 0) as month_1_retained,
        -- Month 2: renewals 2 months later
        COALESCE(SUM(CASE
            WHEN future.cohort_date = base.cohort_date + INTERVAL '2 months'
            THEN future.renewed_count
            ELSE 0
        END), 0) as month_2_retained,
        -- Month 3: renewals 3 months later
        COALESCE(SUM(CASE
            WHEN future.cohort_date = base.cohort_date + INTERVAL '3 months'
            THEN future.renewed_count
            ELSE 0
        END), 0) as month_3_retained,
        -- Month 4: renewals 4 months later
        COALESCE(SUM(CASE
            WHEN future.cohort_date = base.cohort_date + INTERVAL '4 months'
            THEN future.renewed_count
            ELSE 0
        END), 0) as month_4_retained,
        -- Month 5: renewals 5 months later
        COALESCE(SUM(CASE
            WHEN future.cohort_date = base.cohort_date + INTERVAL '5 months'
            THEN future.renewed_count
            ELSE 0
        END), 0) as month_5_retained,
        -- Month 6: renewals 6 months later
        COALESCE(SUM(CASE
            WHEN future.cohort_date = base.cohort_date + INTERVAL '6 months'
            THEN future.renewed_count
            ELSE 0
        END), 0) as month_6_retained
    FROM cohort_base base
    LEFT JOIN premium_creator_retention_events future
        ON base.creator_username = future.creator_username
        AND future.cohort_date BETWEEN base.cohort_date AND base.cohort_date + INTERVAL '6 months'
        AND future.cohort_date > base.cohort_date
    GROUP BY
        base.creator_username,
        base.cohort_month,
        base.cohort_date,
        base.initial_subscribers,
        base.same_month_renewals
)
SELECT
    creator_username,
    cohort_month,
    cohort_date,
    initial_subscribers as first,
    ARRAY[
        month_0_retained,
        month_1_retained,
        month_2_retained,
        month_3_retained,
        month_4_retained,
        month_5_retained,
        month_6_retained
    ] as counts
FROM cohort_renewals
ORDER BY creator_username, cohort_date;

-- Create index on materialized view
CREATE INDEX IF NOT EXISTS idx_retention_analysis_creator ON premium_creator_retention_analysis(creator_username);

-- Grant permissions
GRANT SELECT ON premium_creator_retention_events TO anon, authenticated;
GRANT SELECT ON premium_creator_retention_analysis TO anon, authenticated;

-- Create helper function to refresh materialized view
CREATE OR REPLACE FUNCTION refresh_materialized_view(view_name TEXT)
RETURNS void AS $$
BEGIN
  EXECUTE format('REFRESH MATERIALIZED VIEW %I', view_name);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
