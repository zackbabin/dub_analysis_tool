-- Fix Premium Creator Breakdown to properly aggregate subscriptions
-- Problem: When creators have multiple creator_ids (e.g., @dubAdvisors), subscriptions were being summed
--          causing inflated totals. Subscriptions are at the username level, not creator_id level.
-- Solution: Use MAX instead of SUM for subscription metrics within each username group
-- Date: 2025-11-10

DROP MATERIALIZED VIEW IF EXISTS premium_creator_breakdown CASCADE;

CREATE MATERIALIZED VIEW premium_creator_breakdown AS
WITH engagement_by_username AS (
    -- Aggregate engagement metrics at username level
    -- Sum across all creator_ids with same username
    -- Use LEFT JOIN to include all premium creators even without engagement data
    SELECT
        pc.creator_username,
        SUM(pcem.total_copies) AS total_copies,
        SUM(pcem.total_pdp_views) AS total_pdp_views,
        SUM(pcem.total_liquidations) AS total_liquidations
    FROM premium_creators pc
    LEFT JOIN portfolio_creator_engagement_metrics pcem ON pc.creator_id = pcem.creator_id
    GROUP BY pc.creator_username
),
subscription_by_username AS (
    -- Aggregate subscription metrics at username level
    -- Use MAX instead of SUM to avoid double-counting when a creator has multiple creator_ids
    -- Subscriptions are at the username level, so all creator_ids for the same username have the same subscription count
    -- Use LEFT JOIN to include all premium creators even without subscription data
    SELECT
        pc.creator_username,
        MAX(pcm.total_subscriptions) AS total_subscriptions,
        MAX(pcm.total_paywall_views) AS total_paywall_views,
        MAX(pcm.total_cancellations) AS total_cancellations
    FROM premium_creators pc
    LEFT JOIN premium_creator_metrics pcm ON pc.creator_id = pcm.creator_id
    GROUP BY pc.creator_username
),
performance_by_username AS (
    -- Get unique portfolio performance metrics per username
    -- A portfolio should only be counted once per username, even if multiple creator_ids share that username
    -- Use LEFT JOINs to include all premium creators even without performance data
    SELECT
        pc.creator_username,
        ppm.portfolio_ticker,
        ppm.total_returns_percentage,
        ppm.total_position
    FROM premium_creators pc
    LEFT JOIN portfolio_creator_engagement_metrics pcem ON pc.creator_id = pcem.creator_id
    LEFT JOIN portfolio_performance_metrics ppm ON pcem.portfolio_ticker = ppm.portfolio_ticker
    GROUP BY pc.creator_username, ppm.portfolio_ticker, ppm.total_returns_percentage, ppm.total_position
)
SELECT
    pc.creator_username,
    -- Engagement metrics
    COALESCE(eng.total_copies, 0) AS total_copies,
    COALESCE(eng.total_pdp_views, 0) AS total_pdp_views,
    COALESCE(eng.total_liquidations, 0) AS total_liquidations,
    -- Calculate copy CVR and liquidation rate
    CASE
        WHEN eng.total_pdp_views > 0
        THEN (eng.total_copies::numeric / eng.total_pdp_views::numeric) * 100
        ELSE 0
    END AS copy_cvr,
    CASE
        WHEN eng.total_copies > 0
        THEN (eng.total_liquidations::numeric / eng.total_copies::numeric) * 100
        ELSE 0
    END AS liquidation_rate,
    -- Subscription metrics (using MAX to avoid double-counting)
    COALESCE(sub.total_subscriptions, 0) AS total_subscriptions,
    COALESCE(sub.total_paywall_views, 0) AS total_paywall_views,
    COALESCE(sub.total_cancellations, 0) AS total_cancellations,
    -- Calculate subscription CVR and cancellation rate
    CASE
        WHEN sub.total_paywall_views > 0
        THEN (sub.total_subscriptions::numeric / sub.total_paywall_views::numeric) * 100
        ELSE 0
    END AS subscription_cvr,
    CASE
        WHEN sub.total_subscriptions > 0
        THEN (sub.total_cancellations::numeric / sub.total_subscriptions::numeric) * 100
        ELSE 0
    END AS cancellation_rate,
    -- Performance metrics - aggregate from deduplicated portfolios
    AVG(perf.total_returns_percentage) AS avg_all_time_returns,
    CASE
        WHEN SUM(perf.total_position) > 0 THEN SUM(perf.total_position)
        ELSE NULL
    END AS total_copy_capital
FROM (SELECT DISTINCT creator_username FROM premium_creators) pc
LEFT JOIN engagement_by_username eng ON pc.creator_username = eng.creator_username
LEFT JOIN subscription_by_username sub ON pc.creator_username = sub.creator_username
LEFT JOIN performance_by_username perf ON pc.creator_username = perf.creator_username
GROUP BY
    pc.creator_username,
    eng.total_copies,
    eng.total_pdp_views,
    eng.total_liquidations,
    sub.total_subscriptions,
    sub.total_paywall_views,
    sub.total_cancellations;

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_premium_creator_breakdown_username ON premium_creator_breakdown(creator_username);

-- Grant permissions
GRANT SELECT ON premium_creator_breakdown TO anon, authenticated;

-- Create function to refresh the view
CREATE OR REPLACE FUNCTION refresh_premium_creator_breakdown_view()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW premium_creator_breakdown;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON MATERIALIZED VIEW premium_creator_breakdown IS
'Creator-level aggregated metrics for Premium Creator Breakdown. Uses MAX for subscription metrics to avoid double-counting creators with multiple creator_ids. Refresh after syncing creator data or uploading portfolio performance metrics.';

-- Recreate dependent views that were dropped by CASCADE

-- 1. Recreate premium_creator_summary_stats view
CREATE VIEW premium_creator_summary_stats AS
SELECT
    -- Average CVRs across all premium creators
    AVG(copy_cvr) AS avg_copy_cvr,
    AVG(subscription_cvr) AS avg_subscription_cvr,
    -- Median performance metrics across all premium creators (excluding nulls)
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY avg_all_time_returns) AS median_all_time_performance,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_copy_capital) AS median_copy_capital,
    -- Include count of creators for reference
    COUNT(*) AS total_creators
FROM premium_creator_breakdown;

GRANT SELECT ON premium_creator_summary_stats TO anon, authenticated;

COMMENT ON VIEW premium_creator_summary_stats IS
'Summary statistics aggregated across all premium creators. Used for metric cards on Premium Creator Analysis tab.';

-- 2. Recreate premium_creator_top_5_stocks materialized view
CREATE MATERIALIZED VIEW premium_creator_top_5_stocks AS
WITH ranked_by_creator AS (
  SELECT
    creator_username,
    stock_ticker,
    total_quantity,
    ROW_NUMBER() OVER (
      PARTITION BY creator_username
      ORDER BY total_quantity DESC
    ) as rank
  FROM premium_creator_stock_holdings
)
SELECT
  rbc.creator_username,
  ARRAY_AGG(rbc.stock_ticker ORDER BY rbc.rank) as top_stocks,
  ARRAY_AGG(rbc.total_quantity ORDER BY rbc.rank) as top_quantities,
  pcb.total_copies
FROM ranked_by_creator rbc
LEFT JOIN premium_creator_breakdown pcb ON rbc.creator_username = pcb.creator_username
WHERE rbc.rank <= 5
GROUP BY rbc.creator_username, pcb.total_copies;

-- Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_premium_creator_top_5_stocks_creator
ON premium_creator_top_5_stocks(creator_username);

CREATE INDEX IF NOT EXISTS idx_premium_creator_top_5_stocks_copies
ON premium_creator_top_5_stocks(total_copies DESC);

GRANT SELECT ON premium_creator_top_5_stocks TO anon, authenticated;

COMMENT ON MATERIALIZED VIEW premium_creator_top_5_stocks IS
'Top 5 stocks for each premium creator with total_copies for sorting. Refresh after uploading portfolio stock holdings data.';
