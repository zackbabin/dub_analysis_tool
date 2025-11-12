-- Create missing premium creator views
-- Creates premium_creator_summary_stats and premium_creator_top_5_stocks
-- Does NOT drop any existing views/tables

-- Create premium_creator_summary_stats (regular view, not materialized)
CREATE OR REPLACE VIEW premium_creator_summary_stats AS
SELECT
    -- Average subscription CVR across all premium creators
    AVG(subscription_cvr) AS avg_subscription_cvr,
    -- Median performance metrics across all premium creators (excluding nulls)
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY avg_all_time_returns) AS median_all_time_performance,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_copy_capital) AS median_copy_capital,
    -- Include count of creators for reference
    COUNT(*) AS total_creators
FROM premium_creator_breakdown;

GRANT SELECT ON premium_creator_summary_stats TO anon, authenticated;

COMMENT ON VIEW premium_creator_summary_stats IS
'Summary statistics aggregated across all premium creators. Used for metric cards on Premium Creator Analysis tab. Calculates subscription CVR average and medians for All-Time Returns and Copy Capital from premium_creator_breakdown materialized view.';

-- Create premium_creator_top_5_stocks (materialized view)
CREATE MATERIALIZED VIEW IF NOT EXISTS premium_creator_top_5_stocks AS
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
  ARRAY_AGG(
    jsonb_build_object(
      'ticker', rbc.stock_ticker,
      'quantity', rbc.total_quantity
    ) ORDER BY rbc.rank
  ) as top_5_stocks,
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
'Top 5 stocks for each premium creator as JSON objects with ticker and quantity. Includes total_copies for sorting. Refresh after uploading portfolio stock holdings data.';

-- Refresh the materialized view to populate with current data
REFRESH MATERIALIZED VIEW premium_creator_top_5_stocks;
