-- Migration: Recreate engagement materialized views to use user_id
-- Created: 2025-11-25
-- Purpose: Update materialized views after renaming distinct_id -> user_id in base tables
--
-- Background:
-- - Base tables renamed distinct_id to user_id
-- - Materialized views still reference distinct_id (now broken)
-- - Need to DROP and recreate views with user_id

-- Drop views in reverse dependency order
DROP MATERIALIZED VIEW IF EXISTS top_stocks_all_premium_creators CASCADE;
DROP MATERIALIZED VIEW IF EXISTS premium_creator_stock_holdings CASCADE;
DROP MATERIALIZED VIEW IF EXISTS hidden_gems_portfolios CASCADE;
DROP MATERIALIZED VIEW IF EXISTS portfolio_creator_engagement_metrics CASCADE;

-- Recreate portfolio_creator_engagement_metrics (base view)
CREATE MATERIALIZED VIEW portfolio_creator_engagement_metrics AS
SELECT
  portfolio_ticker,
  creator_id,
  creator_username,
  COUNT(DISTINCT user_id) as unique_viewers,                    -- Updated from distinct_id
  COUNT(DISTINCT CASE WHEN did_copy THEN user_id END) as unique_copiers,  -- Updated from distinct_id
  SUM(pdp_view_count) as total_pdp_views,
  SUM(copy_count) as total_copies,
  ROUND(
    (COUNT(DISTINCT CASE WHEN did_copy THEN user_id END)::numeric /   -- Updated from distinct_id
     NULLIF(COUNT(DISTINCT user_id), 0)) * 100, 2                     -- Updated from distinct_id
  ) as copy_conversion_rate
FROM user_portfolio_creator_engagement
GROUP BY portfolio_ticker, creator_id, creator_username;

CREATE UNIQUE INDEX idx_portfolio_creator_engagement_metrics_unique
  ON portfolio_creator_engagement_metrics(portfolio_ticker, creator_id);

COMMENT ON MATERIALIZED VIEW portfolio_creator_engagement_metrics IS
'Aggregates portfolio engagement metrics per creator. Updated to use user_id.
Refreshed via refresh_portfolio_engagement_views().';

-- Recreate hidden_gems_portfolios
CREATE MATERIALIZED VIEW hidden_gems_portfolios AS
SELECT
  portfolio_ticker,
  creator_id,
  creator_username,
  unique_viewers,
  unique_copiers,
  total_pdp_views,
  total_copies,
  copy_conversion_rate,
  ROUND(unique_viewers::numeric / NULLIF(unique_copiers, 0), 2) as viewer_to_copier_ratio
FROM portfolio_creator_engagement_metrics
WHERE unique_viewers >= 5
  AND unique_copiers >= 1
  AND (unique_viewers::numeric / NULLIF(unique_copiers, 0)) >= 5
ORDER BY viewer_to_copier_ratio DESC, unique_viewers DESC;

CREATE UNIQUE INDEX idx_hidden_gems_portfolios_unique
  ON hidden_gems_portfolios(portfolio_ticker, creator_id);

COMMENT ON MATERIALIZED VIEW hidden_gems_portfolios IS
'Hidden gem portfolios: many unique viewers but few unique copiers (ratio >= 5).
Indicates high interest but low conversion. Updated to use user_id.
Refreshed via refresh_portfolio_engagement_views().';

-- Recreate premium_creator_stock_holdings
CREATE MATERIALIZED VIEW premium_creator_stock_holdings AS
SELECT
  pc.creator_username,
  psh.stock_ticker,
  SUM(psh.total_quantity) AS total_quantity,
  SUM(psh.total_quantity * COALESCE(psh.avg_price, 0)) AS total_value,
  MAX(pcem.total_copies) AS creator_total_copies
FROM premium_creators pc
JOIN portfolio_creator_engagement_metrics pcem
  ON pc.creator_id = pcem.creator_id
JOIN portfolio_stock_holdings psh
  ON pcem.portfolio_ticker = psh.portfolio_ticker
GROUP BY pc.creator_username, psh.stock_ticker;

CREATE INDEX IF NOT EXISTS idx_premium_creator_stock_holdings_creator
  ON premium_creator_stock_holdings(creator_username);

CREATE INDEX IF NOT EXISTS idx_premium_creator_stock_holdings_stock
  ON premium_creator_stock_holdings(stock_ticker);

CREATE INDEX IF NOT EXISTS idx_premium_creator_stock_holdings_quantity
  ON premium_creator_stock_holdings(total_quantity DESC);

COMMENT ON MATERIALIZED VIEW premium_creator_stock_holdings IS
'Stock holdings for all premium creators with weights. Updated to use user_id.
Refreshed via refresh_portfolio_engagement_views() or upload-portfolio-metrics.';

-- Recreate top_stocks_all_premium_creators
CREATE MATERIALIZED VIEW top_stocks_all_premium_creators AS
SELECT
  stock_ticker,
  SUM(total_quantity) AS total_quantity,
  COUNT(DISTINCT creator_username) AS creator_count,
  ROW_NUMBER() OVER (ORDER BY SUM(total_quantity) DESC) AS rank
FROM premium_creator_stock_holdings
GROUP BY stock_ticker
ORDER BY total_quantity DESC;

CREATE INDEX IF NOT EXISTS idx_top_stocks_rank
  ON top_stocks_all_premium_creators(rank);

COMMENT ON MATERIALIZED VIEW top_stocks_all_premium_creators IS
'Aggregates stock holdings across all premium creators. Updated to use user_id.
Refreshed via refresh_portfolio_engagement_views() or upload-portfolio-metrics.';

-- Log the changes
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Recreated engagement materialized views with user_id';
  RAISE NOTICE '   - portfolio_creator_engagement_metrics';
  RAISE NOTICE '   - hidden_gems_portfolios';
  RAISE NOTICE '   - premium_creator_stock_holdings';
  RAISE NOTICE '   - top_stocks_all_premium_creators';
  RAISE NOTICE '';
  RAISE NOTICE '⚠️ Views are empty - run refresh_portfolio_engagement_views() to populate';
  RAISE NOTICE '';
END $$;
