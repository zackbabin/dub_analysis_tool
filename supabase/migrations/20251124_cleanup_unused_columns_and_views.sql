-- Cleanup unused columns and views
-- Drop premium_creator_metrics_latest (not used anywhere)
-- Remove unused columns from portfolio_creator_engagement_metrics
-- Date: 2024-11-24

-- Drop unused view
DROP VIEW IF EXISTS premium_creator_metrics_latest CASCADE;

-- Recreate portfolio_creator_engagement_metrics without unused columns
DROP MATERIALIZED VIEW IF EXISTS hidden_gems_portfolios CASCADE;
DROP MATERIALIZED VIEW IF EXISTS portfolio_creator_engagement_metrics CASCADE;

CREATE MATERIALIZED VIEW portfolio_creator_engagement_metrics AS
SELECT
  portfolio_ticker,
  creator_id,
  MAX(creator_username) AS creator_username,

  -- User counts
  COUNT(DISTINCT CASE WHEN pdp_view_count > 0 THEN distinct_id END) AS unique_viewers,
  COUNT(DISTINCT CASE WHEN did_copy THEN distinct_id END) AS unique_copiers,

  -- Aggregated metrics (only the ones actually used)
  SUM(pdp_view_count) AS total_pdp_views,
  SUM(CASE WHEN did_copy THEN copy_count ELSE 0 END) AS total_copies,
  COALESCE(SUM(liquidation_count), 0) AS total_liquidations,

  -- Conversion rate
  ROUND(
    (COUNT(DISTINCT CASE WHEN did_copy THEN distinct_id END)::NUMERIC /
     NULLIF(COUNT(DISTINCT CASE WHEN pdp_view_count > 0 THEN distinct_id END), 0)) * 100,
    2
  ) AS conversion_rate_pct

FROM user_portfolio_creator_engagement

GROUP BY portfolio_ticker, creator_id;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_portfolio_creator_engagement_metrics_ticker
ON portfolio_creator_engagement_metrics (portfolio_ticker);

CREATE INDEX IF NOT EXISTS idx_portfolio_creator_engagement_metrics_creator
ON portfolio_creator_engagement_metrics (creator_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_portfolio_creator_engagement_metrics_pk
ON portfolio_creator_engagement_metrics(portfolio_ticker, creator_id);

COMMENT ON MATERIALIZED VIEW portfolio_creator_engagement_metrics IS
'Portfolio-creator engagement metrics. Only includes columns actually used by dependent views. Refresh after sync.';

-- Recreate hidden_gems_portfolios
CREATE MATERIALIZED VIEW hidden_gems_portfolios AS
SELECT
  portfolio_ticker,
  creator_id,
  creator_username,
  unique_viewers,
  total_pdp_views,
  unique_copiers,
  total_copies,
  ROUND(
    (unique_viewers::NUMERIC / NULLIF(unique_copiers, 0)),
    2
  ) as viewers_to_copiers_ratio,
  conversion_rate_pct
FROM portfolio_creator_engagement_metrics
WHERE
  unique_viewers >= 10
  AND unique_copiers > 0
  AND (unique_viewers::NUMERIC / NULLIF(unique_copiers, 0)) >= 5
  AND unique_copiers <= 100
ORDER BY unique_viewers DESC;

CREATE INDEX IF NOT EXISTS idx_hidden_gems_portfolios_ticker
ON hidden_gems_portfolios (portfolio_ticker);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hidden_gems_portfolios_pk
ON hidden_gems_portfolios(portfolio_ticker, creator_id);

COMMENT ON MATERIALIZED VIEW hidden_gems_portfolios IS
'Hidden gem portfolios: many unique viewers but few unique copiers (ratio >= 5).';

-- Recreate premium_creator_stock_holdings (was dropped by CASCADE)
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
'Stock holdings aggregated by premium creator. Joins portfolio_creator_engagement_metrics with portfolio_stock_holdings.';

-- Recreate top_stocks_all_premium_creators (depends on premium_creator_stock_holdings)
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
'Top stocks held across all premium creators, ranked by total quantity.';

-- Log the cleanup
DO $$
BEGIN
  RAISE NOTICE '✅ Cleaned up portfolio_creator_engagement_metrics';
  RAISE NOTICE '   - Dropped premium_creator_metrics_latest (unused)';
  RAISE NOTICE '   - Removed 5 unused columns (subscriptions, profile_views, etc.)';
  RAISE NOTICE '   - Kept only 9 essential columns';
  RAISE NOTICE '   Run refresh_portfolio_engagement_views() to populate';
END $$;
