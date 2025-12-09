-- Restructure premium_creator_retention_events to properly track cohort-based retention
-- Chart 85857452 provides cohort (first subscription date)
-- Chart 86188712 provides renewal events with their occurrence date
-- We calculate which renewal month (1, 2, 3, etc.) based on time since cohort

-- Drop existing materialized view and indexes
DROP MATERIALIZED VIEW IF EXISTS premium_creator_retention_analysis CASCADE;
DROP INDEX IF EXISTS idx_retention_events_creator;
DROP INDEX IF EXISTS idx_retention_events_cohort;
DROP INDEX IF EXISTS idx_retention_events_creator_cohort;

-- Drop and recreate table with proper structure
DROP TABLE IF EXISTS premium_creator_retention_events CASCADE;

CREATE TABLE premium_creator_retention_events (
    user_id TEXT NOT NULL,              -- Mixpanel $user_id
    creator_username TEXT NOT NULL,
    cohort_month TEXT NOT NULL,         -- Format: "Nov 2025" (from first subscription)
    cohort_date DATE NOT NULL,          -- Parsed date for sorting/filtering
    subscribed BOOLEAN DEFAULT FALSE,   -- Did they subscribe in this cohort
    month_1_renewed BOOLEAN DEFAULT FALSE,  -- Renewed 1 month after subscription
    month_2_renewed BOOLEAN DEFAULT FALSE,
    month_3_renewed BOOLEAN DEFAULT FALSE,
    month_4_renewed BOOLEAN DEFAULT FALSE,
    month_5_renewed BOOLEAN DEFAULT FALSE,
    month_6_renewed BOOLEAN DEFAULT FALSE,
    month_7_renewed BOOLEAN DEFAULT FALSE,
    month_8_renewed BOOLEAN DEFAULT FALSE,
    month_9_renewed BOOLEAN DEFAULT FALSE,
    month_10_renewed BOOLEAN DEFAULT FALSE,
    month_11_renewed BOOLEAN DEFAULT FALSE,
    month_12_renewed BOOLEAN DEFAULT FALSE,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, creator_username)
);

-- Create indexes for efficient queries
CREATE INDEX idx_retention_events_creator ON premium_creator_retention_events(creator_username);
CREATE INDEX idx_retention_events_cohort ON premium_creator_retention_events(cohort_date);
CREATE INDEX idx_retention_events_creator_cohort ON premium_creator_retention_events(creator_username, cohort_date);

-- Create materialized view for retention analysis
-- Includes both new structure and backward-compatible columns for frontend
CREATE MATERIALIZED VIEW premium_creator_retention_analysis AS
WITH cohort_counts AS (
    SELECT
        creator_username,
        cohort_month,
        cohort_date,
        COUNT(*) FILTER (WHERE subscribed) as cohort_size,
        COUNT(*) FILTER (WHERE month_1_renewed) as month_1_retained,
        COUNT(*) FILTER (WHERE month_2_renewed) as month_2_retained,
        COUNT(*) FILTER (WHERE month_3_renewed) as month_3_retained,
        COUNT(*) FILTER (WHERE month_4_renewed) as month_4_retained,
        COUNT(*) FILTER (WHERE month_5_renewed) as month_5_retained,
        COUNT(*) FILTER (WHERE month_6_renewed) as month_6_retained,
        COUNT(*) FILTER (WHERE month_7_renewed) as month_7_retained,
        COUNT(*) FILTER (WHERE month_8_renewed) as month_8_retained,
        COUNT(*) FILTER (WHERE month_9_renewed) as month_9_retained,
        COUNT(*) FILTER (WHERE month_10_renewed) as month_10_retained,
        COUNT(*) FILTER (WHERE month_11_renewed) as month_11_retained,
        COUNT(*) FILTER (WHERE month_12_renewed) as month_12_retained
    FROM premium_creator_retention_events
    GROUP BY creator_username, cohort_month, cohort_date
),
creator_totals AS (
    SELECT
        creator_username,
        SUM(cohort_size) as total_unique_subscribers
    FROM cohort_counts
    GROUP BY creator_username
)
SELECT
    cc.creator_username,
    cc.cohort_month,
    cc.cohort_date,
    cc.cohort_size,
    -- Backward compatibility: "first" column (alias for cohort_size)
    cc.cohort_size as first,
    -- Backward compatibility: "counts" array for month 0-6 retention
    -- Note: Frontend expects [month_0, month_1, ..., month_6]
    -- We don't track "month 0" (same month renewals), so use 0 as placeholder
    ARRAY[
        0,  -- Month 0 placeholder (same-month renewals not tracked in new structure)
        cc.month_1_retained,
        cc.month_2_retained,
        cc.month_3_retained,
        cc.month_4_retained,
        cc.month_5_retained,
        cc.month_6_retained
    ] as counts,
    -- Total subscribers across all cohorts for this creator
    ct.total_unique_subscribers,
    -- Individual month columns
    cc.month_1_retained,
    cc.month_2_retained,
    cc.month_3_retained,
    cc.month_4_retained,
    cc.month_5_retained,
    cc.month_6_retained,
    cc.month_7_retained,
    cc.month_8_retained,
    cc.month_9_retained,
    cc.month_10_retained,
    cc.month_11_retained,
    cc.month_12_retained,
    -- Calculate retention percentages
    CASE WHEN cc.cohort_size > 0
        THEN ROUND(100.0 * cc.month_1_retained / cc.cohort_size, 1)
        ELSE 0
    END as month_1_retention_pct,
    CASE WHEN cc.cohort_size > 0
        THEN ROUND(100.0 * cc.month_2_retained / cc.cohort_size, 1)
        ELSE 0
    END as month_2_retention_pct,
    CASE WHEN cc.cohort_size > 0
        THEN ROUND(100.0 * cc.month_3_retained / cc.cohort_size, 1)
        ELSE 0
    END as month_3_retention_pct,
    CASE WHEN cc.cohort_size > 0
        THEN ROUND(100.0 * cc.month_6_retained / cc.cohort_size, 1)
        ELSE 0
    END as month_6_retention_pct,
    CASE WHEN cc.cohort_size > 0
        THEN ROUND(100.0 * cc.month_12_retained / cc.cohort_size, 1)
        ELSE 0
    END as month_12_retention_pct
FROM cohort_counts cc
LEFT JOIN creator_totals ct ON cc.creator_username = ct.creator_username
ORDER BY cc.creator_username, cc.cohort_date;

-- Create index on materialized view
CREATE INDEX idx_retention_analysis_creator ON premium_creator_retention_analysis(creator_username);
CREATE INDEX idx_retention_analysis_cohort ON premium_creator_retention_analysis(cohort_date);

-- Grant permissions
GRANT SELECT ON premium_creator_retention_events TO anon, authenticated;
GRANT SELECT ON premium_creator_retention_analysis TO anon, authenticated;

-- Drop existing refresh function (may have different return type)
DROP FUNCTION IF EXISTS refresh_premium_creator_retention_analysis();

-- Create refresh function with TEXT return type
CREATE FUNCTION refresh_premium_creator_retention_analysis()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW premium_creator_retention_analysis;
  RETURN 'Successfully refreshed premium_creator_retention_analysis';
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error refreshing retention analysis: %', SQLERRM;
END;
$$;
