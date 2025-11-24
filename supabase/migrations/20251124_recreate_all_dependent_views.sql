-- Recreate all views that were dropped by CASCADE
-- When we dropped portfolio_creator_engagement_metrics, it cascaded and dropped:
-- 1. hidden_gems_portfolios (already recreated)
-- 2. premium_creator_stock_holdings
-- 3. top_stocks_all_premium_creators
-- 4. premium_creator_breakdown
-- 5. portfolio_breakdown_with_metrics
-- Date: 2024-11-24

-- These were already recreated in 20251124_cleanup_unused_columns_and_views.sql:
-- - portfolio_creator_engagement_metrics
-- - hidden_gems_portfolios

-- Now recreate the rest:

-- 1. premium_creator_stock_holdings
CREATE MATERIALIZED VIEW IF NOT EXISTS premium_creator_stock_holdings AS
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

-- 2. top_stocks_all_premium_creators
CREATE MATERIALIZED VIEW IF NOT EXISTS top_stocks_all_premium_creators AS
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

-- 3. portfolio_breakdown_with_metrics
CREATE MATERIALIZED VIEW IF NOT EXISTS portfolio_breakdown_with_metrics AS
SELECT
  pcem.portfolio_ticker,
  pcem.creator_id,
  pcem.creator_username,
  pcem.total_copies,
  pcem.total_pdp_views,
  pcem.total_liquidations,
  CASE
    WHEN pcem.total_pdp_views > 0
    THEN (pcem.total_copies::numeric / pcem.total_pdp_views::numeric) * 100
    ELSE 0
  END AS copy_cvr,
  CASE
    WHEN pcem.total_copies > 0
    THEN (pcem.total_liquidations::numeric / pcem.total_copies::numeric) * 100
    ELSE 0
  END AS liquidation_rate,
  ppm.total_returns_percentage,
  ppm.total_position,
  ppm.inception_date,
  ppm.uploaded_at AS metrics_updated_at
FROM portfolio_creator_engagement_metrics pcem
LEFT JOIN portfolio_performance_metrics ppm
  ON pcem.portfolio_ticker = ppm.portfolio_ticker;

CREATE INDEX IF NOT EXISTS idx_portfolio_breakdown_ticker
ON portfolio_breakdown_with_metrics(portfolio_ticker);

CREATE INDEX IF NOT EXISTS idx_portfolio_breakdown_creator
ON portfolio_breakdown_with_metrics(creator_id);

-- 4. premium_creator_breakdown
CREATE MATERIALIZED VIEW IF NOT EXISTS premium_creator_breakdown AS
WITH engagement_by_username AS (
    SELECT
        pc.creator_username,
        SUM(pcem.total_copies) AS total_copies,
        COALESCE(SUM(pcem.total_liquidations), 0) AS total_liquidations,
        SUM(pcem.total_pdp_views) AS total_pdp_views
    FROM premium_creators pc
    LEFT JOIN portfolio_creator_engagement_metrics pcem ON pc.creator_id = pcem.creator_id
    GROUP BY pc.creator_username
),
subscription_by_username AS (
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
    COALESCE(eng.total_copies, 0) AS total_copies,
    COALESCE(eng.total_pdp_views, 0) AS total_pdp_views,
    COALESCE(eng.total_liquidations, 0) AS total_liquidations,
    CASE
        WHEN COALESCE(eng.total_pdp_views, 0) > 0
        THEN (COALESCE(eng.total_copies, 0)::numeric / eng.total_pdp_views::numeric) * 100
        ELSE 0
    END AS copy_cvr,
    CASE
        WHEN COALESCE(eng.total_copies, 0) > 0
        THEN (COALESCE(eng.total_liquidations, 0)::numeric / eng.total_copies::numeric) * 100
        ELSE 0
    END AS liquidation_rate,
    COALESCE(sub.total_subscriptions, 0) AS total_subscriptions,
    COALESCE(sub.total_paywall_views, 0) AS total_paywall_views,
    COALESCE(sub.total_cancellations, 0) AS total_cancellations,
    CASE
        WHEN COALESCE(sub.total_paywall_views, 0) > 0
        THEN (COALESCE(sub.total_subscriptions, 0)::numeric / sub.total_paywall_views::numeric) * 100
        ELSE 0
    END AS subscription_cvr,
    CASE
        WHEN COALESCE(sub.total_subscriptions, 0) > 0
        THEN (COALESCE(sub.total_cancellations, 0)::numeric / sub.total_subscriptions::numeric) * 100
        ELSE 0
    END AS cancellation_rate,
    AVG(perf.total_returns_percentage) AS avg_all_time_returns,
    SUM(COALESCE(perf.total_position, 0)) AS total_copy_capital
FROM premium_creators pc
LEFT JOIN engagement_by_username eng ON pc.creator_username = eng.creator_username
LEFT JOIN subscription_by_username sub ON pc.creator_username = sub.creator_username
LEFT JOIN performance_by_username perf ON pc.creator_username = perf.creator_username
GROUP BY
    pc.creator_username,
    eng.total_copies,
    eng.total_liquidations,
    eng.total_pdp_views,
    sub.total_subscriptions,
    sub.total_paywall_views,
    sub.total_cancellations;

CREATE INDEX IF NOT EXISTS idx_premium_creator_breakdown_username
ON premium_creator_breakdown(creator_username);

-- Log success
DO $$
BEGIN
  RAISE NOTICE '✅ Recreated all views dropped by CASCADE';
  RAISE NOTICE '   - premium_creator_stock_holdings';
  RAISE NOTICE '   - top_stocks_all_premium_creators';
  RAISE NOTICE '   - portfolio_breakdown_with_metrics';
  RAISE NOTICE '   - premium_creator_breakdown';
  RAISE NOTICE '   Run refresh_portfolio_engagement_views() to populate';
END $$;
