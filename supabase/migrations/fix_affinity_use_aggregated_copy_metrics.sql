-- Fix Premium Creator Copy Affinity to use aggregated copy metrics
-- Problem: Affinity uses portfolio_creator_engagement_metrics (user-level)
--          while Breakdown uses portfolio_creator_copy_metrics (aggregated from chart 86055000)
-- Solution: Update affinity to use same source as breakdown for copies/liquidations
-- Date: 2025-11-12

DROP VIEW IF EXISTS validation_liquidations_comparison CASCADE;
DROP VIEW IF EXISTS validation_copies_comparison CASCADE;
DROP VIEW IF EXISTS premium_creator_affinity_display CASCADE;
DROP VIEW IF EXISTS premium_creator_copy_affinity_base CASCADE;

-- Recreate base view with copies/liquidations from portfolio_creator_copy_metrics (chart 86055000)
CREATE OR REPLACE VIEW premium_creator_copy_affinity_base AS
WITH premium_creators_list AS (
  -- Premium creators from the authoritative Mixpanel list (chart 85725073)
  -- Group by username to handle duplicates
  SELECT
    creator_username,
    array_agg(creator_id) as creator_ids
  FROM premium_creators
  GROUP BY creator_username
),
premium_creator_copiers AS (
  -- Get all users who copied each premium creator (any of their creator_ids)
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
  -- Get aggregated totals from portfolio_creator_copy_metrics (chart 86055000)
  -- This is the SAME source and logic used by premium_creator_breakdown
  -- Join directly on creator_username to avoid duplicate counting
  SELECT
    pc.creator_username AS premium_creator,
    SUM(pccm.total_copies) AS total_copies,
    SUM(pccm.total_liquidations) AS total_liquidations
  FROM (SELECT DISTINCT creator_username FROM premium_creators) pc
  LEFT JOIN portfolio_creator_copy_metrics pccm
    ON pc.creator_username = pccm.creator_username
  GROUP BY pc.creator_username
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
  WHERE upce2.creator_username != pcc.premium_creator  -- Exclude self by username
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
  COUNT(*) AS total_copies  -- Count distinct (user, portfolio) combinations for affinity
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

-- Recreate display view
CREATE VIEW premium_creator_affinity_display AS
WITH all_premium_creators AS (
  -- Get ALL premium creators from the authoritative table
  -- Group by username to handle duplicates (e.g., dubAdvisors)
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
  -- Top 1: Regular and Premium combined
  MAX(CASE WHEN rr.rank = 1 THEN rr.copied_creator || ' (Regular): ' || rr.total_copies END) ||
    CASE WHEN MAX(CASE WHEN rp.rank = 1 THEN 1 END) = 1 THEN ' | ' ELSE '' END ||
    MAX(CASE WHEN rp.rank = 1 THEN rp.copied_creator || ' (Premium): ' || rp.total_copies END) AS top_1,
  -- Top 2: Regular and Premium combined
  MAX(CASE WHEN rr.rank = 2 THEN rr.copied_creator || ' (Regular): ' || rr.total_copies END) ||
    CASE WHEN MAX(CASE WHEN rp.rank = 2 THEN 1 END) = 1 THEN ' | ' ELSE '' END ||
    MAX(CASE WHEN rp.rank = 2 THEN rp.copied_creator || ' (Premium): ' || rp.total_copies END) AS top_2,
  -- Top 3: Regular and Premium combined
  MAX(CASE WHEN rr.rank = 3 THEN rr.copied_creator || ' (Regular): ' || rr.total_copies END) ||
    CASE WHEN MAX(CASE WHEN rp.rank = 3 THEN 1 END) = 1 THEN ' | ' ELSE '' END ||
    MAX(CASE WHEN rp.rank = 3 THEN rp.copied_creator || ' (Premium): ' || rp.total_copies END) AS top_3,
  -- Top 4: Regular and Premium combined
  MAX(CASE WHEN rr.rank = 4 THEN rr.copied_creator || ' (Regular): ' || rr.total_copies END) ||
    CASE WHEN MAX(CASE WHEN rp.rank = 4 THEN 1 END) = 1 THEN ' | ' ELSE '' END ||
    MAX(CASE WHEN rp.rank = 4 THEN rp.copied_creator || ' (Premium): ' || rp.total_copies END) AS top_4,
  -- Top 5: Regular and Premium combined
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

GRANT SELECT ON premium_creator_copy_affinity_base TO anon, authenticated;
GRANT SELECT ON premium_creator_affinity_display TO anon, authenticated;

COMMENT ON VIEW premium_creator_copy_affinity_base IS
'Premium creator affinity analysis. Uses portfolio_creator_copy_metrics (chart 86055000) for copy/liquidation totals (same source as premium_creator_breakdown to ensure consistency).';

COMMENT ON VIEW premium_creator_affinity_display IS
'Display-formatted view of premium creator copy affinity with top 5 co-copied creators. Uses aggregated copy metrics from chart 86055000 for consistency with Premium Creator Breakdown.';

-- Recreate validation views
CREATE OR REPLACE VIEW validation_liquidations_comparison AS
SELECT
  COALESCE(pcb.creator_username, pad.premium_creator) AS creator_username,
  pcb.total_liquidations AS breakdown_liquidations,
  pad.premium_creator_total_liquidations AS affinity_liquidations,
  ABS(COALESCE(pcb.total_liquidations, 0) - COALESCE(pad.premium_creator_total_liquidations, 0)) AS difference,
  CASE
    WHEN pcb.total_liquidations IS NULL THEN 'Missing in Breakdown'
    WHEN pad.premium_creator_total_liquidations IS NULL THEN 'Missing in Affinity'
    WHEN pcb.total_liquidations = pad.premium_creator_total_liquidations THEN 'Match'
    ELSE 'Discrepancy'
  END AS status
FROM premium_creator_breakdown pcb
FULL OUTER JOIN premium_creator_affinity_display pad
  ON pcb.creator_username = pad.premium_creator
WHERE pcb.total_liquidations != pad.premium_creator_total_liquidations
   OR pcb.total_liquidations IS NULL
   OR pad.premium_creator_total_liquidations IS NULL
ORDER BY difference DESC NULLS LAST;

GRANT SELECT ON validation_liquidations_comparison TO anon, authenticated;

COMMENT ON VIEW validation_liquidations_comparison IS
'Compares liquidations between Premium Creator Breakdown and Copy Affinity to identify discrepancies. Empty result = all match. Both now use portfolio_creator_copy_metrics (chart 86055000).';

CREATE OR REPLACE VIEW validation_copies_comparison AS
SELECT
  COALESCE(pcb.creator_username, pad.premium_creator) AS creator_username,
  pcb.total_copies AS breakdown_copies,
  pad.premium_creator_total_copies AS affinity_copies,
  ABS(COALESCE(pcb.total_copies, 0) - COALESCE(pad.premium_creator_total_copies, 0)) AS difference,
  CASE
    WHEN pcb.total_copies IS NULL THEN 'Missing in Breakdown'
    WHEN pad.premium_creator_total_copies IS NULL THEN 'Missing in Affinity'
    WHEN pcb.total_copies = pad.premium_creator_total_copies THEN 'Match'
    ELSE 'Discrepancy'
  END AS status
FROM premium_creator_breakdown pcb
FULL OUTER JOIN premium_creator_affinity_display pad
  ON pcb.creator_username = pad.premium_creator
WHERE pcb.total_copies != pad.premium_creator_total_copies
   OR pcb.total_copies IS NULL
   OR pad.premium_creator_total_copies IS NULL
ORDER BY difference DESC NULLS LAST;

GRANT SELECT ON validation_copies_comparison TO anon, authenticated;

COMMENT ON VIEW validation_copies_comparison IS
'Compares copies between Premium Creator Breakdown and Copy Affinity to identify discrepancies. Empty result = all match. Both now use portfolio_creator_copy_metrics (chart 86055000).';
