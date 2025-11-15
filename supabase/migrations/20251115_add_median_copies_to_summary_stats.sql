-- Add median_copies to premium_creator_summary_stats view
-- This will be used for the new "Median Copies" metric card at the top of Premium Creator Analysis
-- Date: 2025-11-15

DROP VIEW IF EXISTS premium_creator_summary_stats;

CREATE VIEW premium_creator_summary_stats AS
SELECT
    -- Median copies across all premium creators
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_copies) AS median_copies,
    -- Average subscription CVR across all premium creators
    AVG(subscription_cvr) AS avg_subscription_cvr,
    -- Median performance metrics across all premium creators (excluding nulls)
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY avg_all_time_returns) AS median_all_time_performance,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_copy_capital) AS median_copy_capital,
    -- Include count of creators for reference
    COUNT(*) AS total_creators
FROM premium_creator_breakdown;

GRANT SELECT ON premium_creator_summary_stats TO anon, authenticated, service_role;

COMMENT ON VIEW premium_creator_summary_stats IS
'Summary statistics aggregated across all premium creators. Used for metric cards on Premium Creator Analysis tab. Includes median copies, avg subscription CVR, median all-time returns, and median copy capital from premium_creator_breakdown view.';
