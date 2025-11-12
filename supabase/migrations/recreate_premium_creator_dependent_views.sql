-- Recreate views that depend on premium_creator_breakdown
-- These were dropped by CASCADE but not recreated
-- Date: 2025-11-12

-- Recreate premium_creator_summary_stats view
DROP VIEW IF EXISTS premium_creator_summary_stats;

CREATE VIEW premium_creator_summary_stats AS
SELECT
    -- Average CVRs across all premium creators
    AVG(subscription_cvr) AS avg_subscription_cvr,
    -- Median performance metrics across all premium creators (excluding nulls)
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY avg_all_time_returns) AS median_all_time_performance,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_copy_capital) AS median_copy_capital,
    -- Include count of creators for reference
    COUNT(*) AS total_creators
FROM premium_creator_breakdown;

-- Grant permissions
GRANT SELECT ON premium_creator_summary_stats TO anon, authenticated;

COMMENT ON VIEW premium_creator_summary_stats IS
'Summary statistics aggregated across all premium creators. Used for metric cards on Premium Creator Analysis tab. Calculates subscription CVR average and medians for All-Time Returns and Copy Capital from premium_creator_breakdown materialized view.';

-- Recreate premium_creator_top_5_stocks view with total_copies for sorting
DROP VIEW IF EXISTS premium_creator_top_5_stocks;

CREATE VIEW premium_creator_top_5_stocks AS
WITH stock_aggregation AS (
  SELECT
    pc.creator_username,
    psh.stock_ticker,
    psh.total_quantity
  FROM premium_creators pc
  LEFT JOIN portfolio_creator_engagement_metrics pcem
    ON pc.creator_id = pcem.creator_id
  LEFT JOIN portfolio_stock_holdings psh
    ON pcem.portfolio_ticker = psh.portfolio_ticker
  WHERE psh.stock_ticker IS NOT NULL
),
ranked_stocks AS (
  SELECT
    creator_username,
    stock_ticker,
    SUM(total_quantity) AS total_quantity,
    ROW_NUMBER() OVER (
      PARTITION BY creator_username
      ORDER BY SUM(total_quantity) DESC
    ) AS rank
  FROM stock_aggregation
  GROUP BY creator_username, stock_ticker
)
SELECT
  rs.creator_username,
  ARRAY_AGG(
    json_build_object(
      'ticker', rs.stock_ticker,
      'quantity', rs.total_quantity
    ) ORDER BY rs.rank
  ) FILTER (WHERE rs.rank <= 5) AS top_5_stocks,
  pcb.total_copies
FROM ranked_stocks rs
LEFT JOIN premium_creator_breakdown pcb ON rs.creator_username = pcb.creator_username
WHERE rs.rank <= 5
GROUP BY rs.creator_username, pcb.total_copies;

-- Grant permissions
GRANT SELECT ON premium_creator_top_5_stocks TO anon, authenticated;

COMMENT ON VIEW premium_creator_top_5_stocks IS
'Top 5 stock holdings for each premium creator, aggregated across all their portfolios. Includes total_copies for sorting.';
