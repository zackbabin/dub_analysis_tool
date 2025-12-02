-- Update Premium Creator Summary Stats view
-- Add avg/median for copies, returns, and capital
-- Change metric cards from median-only to avg with median in smaller text

DROP VIEW IF EXISTS premium_creator_summary_stats;

CREATE VIEW premium_creator_summary_stats AS
SELECT
    -- Subscription CVR (keep existing avg calculation)
    AVG(subscription_cvr) AS avg_subscription_cvr,

    -- Copies metrics (avg and median)
    AVG(total_copies) AS avg_copies,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_copies) AS median_copies,

    -- All-Time Returns metrics (avg and median, excluding nulls)
    AVG(avg_all_time_returns) AS avg_all_time_returns,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY avg_all_time_returns) AS median_all_time_returns,

    -- Copy Capital metrics (avg and median, excluding nulls)
    AVG(total_copy_capital) AS avg_copy_capital,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_copy_capital) AS median_copy_capital,

    -- Include count of creators for reference
    COUNT(*) AS total_creators
FROM premium_creator_breakdown;

-- Grant permissions
GRANT SELECT ON premium_creator_summary_stats TO anon, authenticated;

COMMENT ON VIEW premium_creator_summary_stats IS
'Summary statistics aggregated across all premium creators. Used for metric cards on Premium Creator Analysis tab. Calculates both averages and medians for Copies, All-Time Returns, and Copy Capital from premium_creator_breakdown materialized view.';
