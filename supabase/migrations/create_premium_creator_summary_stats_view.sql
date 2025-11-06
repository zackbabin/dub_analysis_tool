-- Create view for Premium Creator Summary Stats
-- Aggregates metrics across all premium creators for the metric cards
-- Queries from premium_creator_breakdown materialized view

CREATE OR REPLACE VIEW premium_creator_summary_stats AS
SELECT
    -- Average CVRs across all premium creators
    AVG(copy_cvr) AS avg_copy_cvr,
    AVG(subscription_cvr) AS avg_subscription_cvr,
    -- Average performance metrics across all premium creators (excluding nulls)
    AVG(avg_all_time_returns) AS avg_all_time_performance,
    AVG(total_copy_capital) AS avg_copy_capital,
    -- Include count of creators for reference
    COUNT(*) AS total_creators
FROM premium_creator_breakdown;

-- Grant permissions
GRANT SELECT ON premium_creator_summary_stats TO anon, authenticated;

COMMENT ON VIEW premium_creator_summary_stats IS
'Summary statistics aggregated across all premium creators. Used for metric cards on Premium Creator Analysis tab. Calculates averages from premium_creator_breakdown materialized view.';
