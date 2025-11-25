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
SELECT DISTINCT
  c.creator_id,
  c.creator_username,
  c.tier,
  c.portfolio_ticker,
  c.portfolio_name,
  s.symbol,
  s.weight,
  s.snapshot_date
FROM premium_creators c
INNER JOIN portfolio_assets_breakdown s
  ON c.portfolio_ticker = s.portfolio_ticker
WHERE c.tier = 'premium'
  AND s.symbol IS NOT NULL
ORDER BY c.creator_username, s.weight DESC;

CREATE INDEX idx_premium_creator_stock_holdings_creator
  ON premium_creator_stock_holdings(creator_id);

CREATE INDEX idx_premium_creator_stock_holdings_symbol
  ON premium_creator_stock_holdings(symbol);

COMMENT ON MATERIALIZED VIEW premium_creator_stock_holdings IS
'Stock holdings for all premium creators with weights. Updated to use user_id.
Refreshed via refresh_portfolio_engagement_views() or upload-portfolio-metrics.';

-- Recreate top_stocks_all_premium_creators
CREATE MATERIALIZED VIEW top_stocks_all_premium_creators AS
SELECT
  symbol,
  COUNT(DISTINCT creator_id) as creator_count,
  ROUND(AVG(weight), 4) as avg_weight,
  ROUND(SUM(weight), 4) as total_weight,
  MAX(snapshot_date) as latest_snapshot
FROM premium_creator_stock_holdings
WHERE symbol IS NOT NULL
GROUP BY symbol
HAVING COUNT(DISTINCT creator_id) >= 1
ORDER BY creator_count DESC, total_weight DESC;

CREATE UNIQUE INDEX idx_top_stocks_all_premium_creators_symbol
  ON top_stocks_all_premium_creators(symbol);

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
