-- Migration: Create missing views for Premium Creator Analysis
-- Date: 2025-11-11
-- Description: Creates the missing views causing 404 errors
-- Must be run in order as some views depend on others

-- 0. Create premium_creator_stock_holdings materialized view (dependency for top_stocks)
DROP MATERIALIZED VIEW IF EXISTS premium_creator_stock_holdings CASCADE;

CREATE MATERIALIZED VIEW premium_creator_stock_holdings AS
SELECT
  pc.creator_username,
  psh.stock_ticker,
  SUM(psh.total_quantity) as total_quantity,
  COUNT(DISTINCT psh.portfolio_ticker) as portfolio_count
FROM portfolio_stock_holdings psh
JOIN portfolio_creator_engagement_metrics pcem
  ON psh.portfolio_ticker = pcem.portfolio_ticker
JOIN premium_creators pc
  ON pcem.creator_id = pc.creator_id
WHERE psh.stock_ticker IS NOT NULL
  AND psh.stock_ticker != ''
GROUP BY pc.creator_username, psh.stock_ticker;

-- Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_premium_creator_stock_holdings_creator
ON premium_creator_stock_holdings(creator_username);

CREATE INDEX IF NOT EXISTS idx_premium_creator_stock_holdings_stock
ON premium_creator_stock_holdings(stock_ticker);

CREATE INDEX IF NOT EXISTS idx_premium_creator_stock_holdings_quantity
ON premium_creator_stock_holdings(total_quantity DESC);

-- Grant permissions
GRANT SELECT ON premium_creator_stock_holdings TO anon, authenticated;

COMMENT ON MATERIALIZED VIEW premium_creator_stock_holdings IS
'Aggregates stock holdings by premium creator. Refresh after uploading portfolio stock holdings data.';

-- 1. Create top_stocks_all_premium_creators materialized view
DROP MATERIALIZED VIEW IF EXISTS top_stocks_all_premium_creators CASCADE;

CREATE MATERIALIZED VIEW top_stocks_all_premium_creators AS
WITH ranked_stocks AS (
  SELECT
    stock_ticker,
    SUM(total_quantity) as total_quantity,
    COUNT(DISTINCT creator_username) as creator_count,
    SUM(portfolio_count) as portfolio_count,
    ROW_NUMBER() OVER (ORDER BY SUM(total_quantity) DESC) as rank
  FROM premium_creator_stock_holdings
  GROUP BY stock_ticker
)
SELECT
  rank,
  stock_ticker,
  total_quantity,
  creator_count,
  portfolio_count
FROM ranked_stocks
WHERE rank <= 5
ORDER BY rank;

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_top_stocks_all_premium_creators_rank
ON top_stocks_all_premium_creators(rank);

-- Grant permissions
GRANT SELECT ON top_stocks_all_premium_creators TO anon, authenticated;

COMMENT ON MATERIALIZED VIEW top_stocks_all_premium_creators IS
'Top 5 stocks held by all premium creators combined. Refresh after uploading portfolio stock holdings data.';

-- 2. Create portfolio_breakdown_with_metrics materialized view
DROP MATERIALIZED VIEW IF EXISTS portfolio_breakdown_with_metrics CASCADE;

CREATE MATERIALIZED VIEW portfolio_breakdown_with_metrics AS
SELECT
    pcem.portfolio_ticker,
    pcem.creator_id,
    pc.creator_username,
    pcem.total_copies,
    pcem.total_pdp_views,
    pcem.total_liquidations,
    -- Calculate conversion rates
    CASE
        WHEN pcem.total_pdp_views > 0
        THEN (pcem.total_copies::numeric / pcem.total_pdp_views::numeric) * 100
        ELSE 0
    END as copy_cvr,
    CASE
        WHEN pcem.total_copies > 0
        THEN (pcem.total_liquidations::numeric / pcem.total_copies::numeric) * 100
        ELSE 0
    END as liquidation_rate,
    -- Join performance metrics directly on portfolio_ticker
    ppm.total_returns_percentage,
    ppm.total_position,
    ppm.inception_date,
    ppm.uploaded_at as metrics_updated_at
FROM portfolio_creator_engagement_metrics pcem
JOIN premium_creators pc ON pcem.creator_id = pc.creator_id
LEFT JOIN portfolio_performance_metrics ppm ON pcem.portfolio_ticker = ppm.portfolio_ticker;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_portfolio_breakdown_creator ON portfolio_breakdown_with_metrics(creator_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_breakdown_ticker ON portfolio_breakdown_with_metrics(portfolio_ticker);

-- Grant permissions
GRANT SELECT ON portfolio_breakdown_with_metrics TO anon, authenticated;

COMMENT ON MATERIALIZED VIEW portfolio_breakdown_with_metrics IS
'Portfolio-level breakdown with engagement and performance metrics. Refresh after syncing engagement data or uploading performance metrics.';

-- 3. Create premium_creator_affinity_display view (if not exists)
DROP VIEW IF EXISTS premium_creator_affinity_display CASCADE;
DROP VIEW IF EXISTS premium_creator_copy_affinity_base CASCADE;

CREATE VIEW premium_creator_copy_affinity_base AS
WITH premium_creators_list AS (
  SELECT
    creator_username,
    array_agg(creator_id) as creator_ids
  FROM premium_creators
  GROUP BY creator_username
),
premium_creator_copiers AS (
  SELECT
    pc.creator_username AS premium_creator,
    upce.distinct_id AS copier_id,
    upce.portfolio_ticker,
    upce.copy_count,
    upce.liquidation_count
  FROM premium_creators_list pc
  CROSS JOIN LATERAL unnest(pc.creator_ids) AS pc_creator_id
  JOIN user_portfolio_creator_engagement upce
    ON pc_creator_id = upce.creator_id
    AND upce.did_copy = true
),
premium_totals AS (
  SELECT
    pc.creator_username AS premium_creator,
    SUM(pcem.total_copies) AS total_copies,
    SUM(pcem.total_liquidations) AS total_liquidations
  FROM premium_creators_list pc
  CROSS JOIN LATERAL unnest(pc.creator_ids) AS pc_creator_id
  LEFT JOIN portfolio_creator_engagement_metrics pcem
    ON pc_creator_id = pcem.creator_id
  GROUP BY pc.creator_username
),
affinity_raw AS (
  SELECT
    pcc.premium_creator,
    upce2.creator_username AS copied_creator,
    upce2.distinct_id AS copier_id,
    upce2.portfolio_ticker,
    upce2.copy_count
  FROM premium_creator_copiers pcc
  JOIN user_portfolio_creator_engagement upce2
    ON pcc.copier_id = upce2.distinct_id
    AND upce2.did_copy = true
  WHERE upce2.creator_username != pcc.premium_creator
)
SELECT
  ar.premium_creator,
  pt.total_copies AS premium_creator_total_copies,
  pt.total_liquidations AS premium_creator_total_liquidations,
  ar.copied_creator,
  CASE
    WHEN pc.creator_username IS NOT NULL THEN 'Premium'
    ELSE 'Regular'
  END AS copy_type,
  COUNT(DISTINCT ar.copier_id) AS unique_copiers,
  COUNT(*) AS total_copies
FROM affinity_raw ar
JOIN premium_totals pt
  ON ar.premium_creator = pt.premium_creator
LEFT JOIN premium_creators_list pc
  ON ar.copied_creator = pc.creator_username
GROUP BY
  ar.premium_creator,
  pt.total_copies,
  pt.total_liquidations,
  ar.copied_creator,
  pc.creator_username
ORDER BY ar.premium_creator, unique_copiers DESC;

GRANT SELECT ON premium_creator_copy_affinity_base TO anon, authenticated;

CREATE VIEW premium_creator_affinity_display AS
WITH all_premium_creators AS (
  SELECT
    creator_username AS premium_creator,
    COALESCE(MAX(pt.total_copies), 0)::bigint AS premium_creator_total_copies,
    COALESCE(MAX(pt.total_liquidations), 0)::bigint AS premium_creator_total_liquidations
  FROM premium_creators pc
  LEFT JOIN (
    SELECT
      premium_creator,
      MAX(premium_creator_total_copies) AS total_copies,
      MAX(premium_creator_total_liquidations) AS total_liquidations
    FROM premium_creator_copy_affinity_base
    GROUP BY premium_creator
  ) pt ON pc.creator_username = pt.premium_creator
  GROUP BY creator_username
),
ranked_regular AS (
  SELECT
    premium_creator,
    copied_creator,
    total_copies,
    unique_copiers,
    ROW_NUMBER() OVER (
      PARTITION BY premium_creator
      ORDER BY unique_copiers DESC, total_copies DESC
    ) AS rank
  FROM premium_creator_copy_affinity_base
  WHERE copy_type = 'Regular'
),
ranked_premium AS (
  SELECT
    premium_creator,
    copied_creator,
    total_copies,
    unique_copiers,
    ROW_NUMBER() OVER (
      PARTITION BY premium_creator
      ORDER BY unique_copiers DESC, total_copies DESC
    ) AS rank
  FROM premium_creator_copy_affinity_base
  WHERE copy_type = 'Premium'
)
SELECT
  apc.premium_creator,
  apc.premium_creator_total_copies,
  apc.premium_creator_total_liquidations,
  MAX(CASE WHEN rr.rank = 1 THEN rr.copied_creator || ' (Regular): ' || rr.total_copies END) ||
    CASE WHEN MAX(CASE WHEN rp.rank = 1 THEN 1 END) = 1 THEN ' | ' ELSE '' END ||
    MAX(CASE WHEN rp.rank = 1 THEN rp.copied_creator || ' (Premium): ' || rp.total_copies END) AS top_1,
  MAX(CASE WHEN rr.rank = 2 THEN rr.copied_creator || ' (Regular): ' || rr.total_copies END) ||
    CASE WHEN MAX(CASE WHEN rp.rank = 2 THEN 1 END) = 1 THEN ' | ' ELSE '' END ||
    MAX(CASE WHEN rp.rank = 2 THEN rp.copied_creator || ' (Premium): ' || rp.total_copies END) AS top_2,
  MAX(CASE WHEN rr.rank = 3 THEN rr.copied_creator || ' (Regular): ' || rr.total_copies END) ||
    CASE WHEN MAX(CASE WHEN rp.rank = 3 THEN 1 END) = 1 THEN ' | ' ELSE '' END ||
    MAX(CASE WHEN rp.rank = 3 THEN rp.copied_creator || ' (Premium): ' || rp.total_copies END) AS top_3,
  MAX(CASE WHEN rr.rank = 4 THEN rr.copied_creator || ' (Regular): ' || rr.total_copies END) ||
    CASE WHEN MAX(CASE WHEN rp.rank = 4 THEN 1 END) = 1 THEN ' | ' ELSE '' END ||
    MAX(CASE WHEN rp.rank = 4 THEN rp.copied_creator || ' (Premium): ' || rp.total_copies END) AS top_4,
  MAX(CASE WHEN rr.rank = 5 THEN rr.copied_creator || ' (Regular): ' || rr.total_copies END) ||
    CASE WHEN MAX(CASE WHEN rp.rank = 5 THEN 1 END) = 1 THEN ' | ' ELSE '' END ||
    MAX(CASE WHEN rp.rank = 5 THEN rp.copied_creator || ' (Premium): ' || rp.total_copies END) AS top_5
FROM all_premium_creators apc
LEFT JOIN ranked_regular rr
  ON apc.premium_creator = rr.premium_creator AND rr.rank <= 5
LEFT JOIN ranked_premium rp
  ON apc.premium_creator = rp.premium_creator AND rp.rank <= 5
GROUP BY
  apc.premium_creator,
  apc.premium_creator_total_copies,
  apc.premium_creator_total_liquidations
ORDER BY apc.premium_creator_total_copies DESC NULLS LAST, apc.premium_creator;

GRANT SELECT ON premium_creator_affinity_display TO anon, authenticated;

COMMENT ON VIEW premium_creator_copy_affinity_base IS
'Premium creator affinity analysis. Uses portfolio_creator_engagement_metrics for copy/liquidation totals and affinity mapping.';

COMMENT ON VIEW premium_creator_affinity_display IS
'Formatted premium creator affinity display with top 5 copied creators (both regular and premium) for each premium creator.';
