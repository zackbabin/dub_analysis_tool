-- Comprehensive fix: Simplify architecture and fix $ prefix issue
-- Date: 2025-11-03
--
-- Goals:
-- 1. Use user_portfolio_creator_engagement as single source of truth for portfolio metrics
-- 2. Use premium_creator_metrics for creator-level subscription metrics
-- 3. Ensure all portfolio_tickers have $ prefix
-- 4. Support: Hidden Gems, Premium Creator Metrics, Premium Creator Affinity, High-Impact Combinations

-- ============================================================================
-- STEP 1: Normalize portfolio_ticker to always have $ prefix (AGAIN)
-- ============================================================================

-- Merge non-$ tickers into $ tickers
INSERT INTO user_portfolio_creator_engagement (
  distinct_id,
  portfolio_ticker,
  creator_id,
  creator_username,
  pdp_view_count,
  did_copy,
  copy_count,
  liquidation_count,
  synced_at
)
SELECT
  no_dollar.distinct_id,
  '$' || no_dollar.portfolio_ticker as portfolio_ticker,
  no_dollar.creator_id,
  no_dollar.creator_username,
  no_dollar.pdp_view_count,
  no_dollar.did_copy,
  no_dollar.copy_count,
  no_dollar.liquidation_count,
  no_dollar.synced_at
FROM user_portfolio_creator_engagement no_dollar
WHERE no_dollar.portfolio_ticker NOT LIKE '$%'
  AND no_dollar.portfolio_ticker IS NOT NULL
  AND no_dollar.portfolio_ticker != ''
ON CONFLICT (distinct_id, portfolio_ticker, creator_id)
DO UPDATE SET
  pdp_view_count = user_portfolio_creator_engagement.pdp_view_count + EXCLUDED.pdp_view_count,
  copy_count = user_portfolio_creator_engagement.copy_count + EXCLUDED.copy_count,
  liquidation_count = user_portfolio_creator_engagement.liquidation_count + EXCLUDED.liquidation_count,
  did_copy = user_portfolio_creator_engagement.did_copy OR EXCLUDED.did_copy,
  synced_at = GREATEST(user_portfolio_creator_engagement.synced_at, EXCLUDED.synced_at);

-- Delete the non-$ ticker rows
DELETE FROM user_portfolio_creator_engagement
WHERE portfolio_ticker NOT LIKE '$%'
  AND portfolio_ticker IS NOT NULL
  AND portfolio_ticker != '';

-- ============================================================================
-- STEP 2: Drop all existing views
-- ============================================================================

DROP VIEW IF EXISTS premium_creator_affinity_display CASCADE;
DROP VIEW IF EXISTS premium_creator_copy_affinity_base CASCADE;
DROP MATERIALIZED VIEW IF EXISTS hidden_gems_portfolios CASCADE;
DROP MATERIALIZED VIEW IF EXISTS portfolio_creator_engagement_metrics CASCADE;

-- ============================================================================
-- STEP 3: Recreate portfolio_creator_engagement_metrics
-- Simple: Just aggregate from user_portfolio_creator_engagement
-- ============================================================================

CREATE MATERIALIZED VIEW portfolio_creator_engagement_metrics AS
SELECT
  upce.portfolio_ticker,
  upce.creator_id,
  upce.creator_username,

  -- User-level counts
  COUNT(DISTINCT CASE WHEN upce.pdp_view_count > 0 THEN upce.distinct_id END) AS unique_viewers,
  COUNT(DISTINCT CASE WHEN upce.did_copy THEN upce.distinct_id END) AS unique_copiers,

  -- Totals from user-level data
  SUM(upce.pdp_view_count) AS total_pdp_views,
  SUM(CASE WHEN upce.did_copy THEN upce.copy_count ELSE 0 END) AS total_copies,
  SUM(upce.liquidation_count) AS total_liquidations,

  -- Profile views: aggregate from user_creator_engagement (creator-level)
  COALESCE(MAX(uce_agg.total_profile_views), 0) AS total_profile_views,

  -- Subscription metrics from premium_creator_metrics (creator-level only)
  COALESCE(MAX(pcm.total_subscriptions), 0) AS total_subscriptions,
  COALESCE(MAX(pcm.total_paywall_views), 0) AS total_paywall_views,
  COALESCE(MAX(pcm.total_stripe_modal_views), 0) AS total_stripe_modal_views,
  COALESCE(MAX(pcm.total_cancellations), 0) AS total_cancellations,

  -- Conversion rate
  ROUND(
    (COUNT(DISTINCT CASE WHEN upce.did_copy THEN upce.distinct_id END)::NUMERIC /
     NULLIF(COUNT(DISTINCT CASE WHEN upce.pdp_view_count > 0 THEN upce.distinct_id END), 0)) * 100,
    2
  ) AS conversion_rate_pct

FROM user_portfolio_creator_engagement upce

-- Get profile views per creator (aggregate across all users)
LEFT JOIN (
  SELECT
    creator_id,
    SUM(profile_view_count) as total_profile_views
  FROM user_creator_engagement
  GROUP BY creator_id
) uce_agg ON upce.creator_id = uce_agg.creator_id

-- Get creator-level subscription metrics
LEFT JOIN premium_creator_metrics_latest pcm
  ON upce.creator_id = pcm.creator_id

GROUP BY
  upce.portfolio_ticker,
  upce.creator_id,
  upce.creator_username;

CREATE INDEX IF NOT EXISTS idx_portfolio_creator_engagement_metrics_ticker
ON portfolio_creator_engagement_metrics (portfolio_ticker);

CREATE INDEX IF NOT EXISTS idx_portfolio_creator_engagement_metrics_creator
ON portfolio_creator_engagement_metrics (creator_id);

-- ============================================================================
-- STEP 4: Recreate hidden_gems_portfolios
-- ============================================================================

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

-- ============================================================================
-- STEP 5: Recreate premium_creator_copy_affinity_base
-- Filter to only premium creators
-- ============================================================================

CREATE OR REPLACE VIEW premium_creator_copy_affinity_base AS
WITH premium_creators_list AS (
  SELECT
    creator_username,
    array_agg(creator_id) as creator_ids
  FROM premium_creators
  GROUP BY creator_username
),
premium_creator_copiers AS (
  -- Get all users who copied each premium creator
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
  -- Count unique (user, portfolio) combinations for each premium creator
  SELECT
    premium_creator,
    COUNT(*) AS total_copies,
    SUM(liquidation_count) AS total_liquidations
  FROM premium_creator_copiers
  GROUP BY premium_creator
),
affinity_raw AS (
  -- Find what else these copiers copied
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

-- ============================================================================
-- STEP 6: Recreate premium_creator_affinity_display
-- ============================================================================

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

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON MATERIALIZED VIEW portfolio_creator_engagement_metrics IS
'Single source aggregation from user_portfolio_creator_engagement. Includes creator-level subscription metrics from premium_creator_metrics.';

COMMENT ON MATERIALIZED VIEW hidden_gems_portfolios IS
'Portfolios with high viewer-to-copier ratio (>= 5). Filtered to portfolios with >= 10 viewers.';

COMMENT ON VIEW premium_creator_copy_affinity_base IS
'Shows which creators are copied by users who copy premium creators. Filtered to premium creators only.';
