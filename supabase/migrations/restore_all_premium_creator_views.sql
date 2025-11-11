-- Comprehensive restoration of all Premium Creator views to pre-Chart-86055000 state
-- Drops all broken views and recreates them with correct structure
-- Date: 2025-11-11

-- Step 1: Drop all views that might be broken
DROP VIEW IF EXISTS premium_creator_summary_stats CASCADE;
DROP VIEW IF EXISTS premium_creator_top_5_stocks CASCADE;
DROP VIEW IF EXISTS premium_creator_affinity_display CASCADE;
DROP VIEW IF EXISTS premium_creator_copy_affinity_base CASCADE;
DROP MATERIALIZED VIEW IF EXISTS premium_creator_breakdown CASCADE;

-- Step 2: Recreate premium_creator_breakdown materialized view
CREATE MATERIALIZED VIEW premium_creator_breakdown AS
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
    -- Use MAX instead of SUM to avoid double-counting when a creator has multiple creator_ids
    -- Subscriptions are at the username level, so all creator_ids for the same username have the same subscription count
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
    -- Subscription metrics
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
    eng.total_liquidations,
    eng.total_pdp_views,
    sub.total_subscriptions,
    sub.total_paywall_views,
    sub.total_cancellations;

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_premium_creator_breakdown_username ON premium_creator_breakdown(creator_username);

-- Grant permissions
GRANT SELECT ON premium_creator_breakdown TO anon, authenticated;

-- Step 3: Recreate premium_creator_summary_stats view
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

-- Step 4: Recreate premium_creator_top_5_stocks view
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
  creator_username,
  ARRAY_AGG(
    json_build_object(
      'ticker', stock_ticker,
      'quantity', total_quantity
    ) ORDER BY rank
  ) FILTER (WHERE rank <= 5) AS top_5_stocks
FROM ranked_stocks
WHERE rank <= 5
GROUP BY creator_username;

GRANT SELECT ON premium_creator_top_5_stocks TO anon, authenticated;

-- Step 5: Recreate premium_creator_affinity views
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

COMMENT ON MATERIALIZED VIEW premium_creator_breakdown IS
'Creator-level aggregated metrics for Premium Creator Breakdown. Uses portfolio_creator_engagement_metrics for all metrics. Refresh after syncing creator data or uploading portfolio performance metrics.';

COMMENT ON VIEW premium_creator_summary_stats IS
'Summary statistics aggregated across all premium creators. Used for metric cards on Premium Creator Analysis tab.';

COMMENT ON VIEW premium_creator_copy_affinity_base IS
'Premium creator affinity analysis. Uses portfolio_creator_engagement_metrics for copy/liquidation totals and affinity mapping.';
