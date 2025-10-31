-- Fix premium creator affinity view to deduplicate by username
-- When a creator has multiple creator_ids (like @dubAdvisors with 118 and 211855351476994048),
-- we need to combine all their copiers and metrics under a single username

DROP VIEW IF EXISTS premium_creator_affinity_display;
DROP VIEW IF EXISTS premium_creator_copy_affinity_base;

-- Recreate base view with username-level aggregation
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
    upce.copy_count,
    upce.liquidation_count
  FROM premium_creators_list pc
  CROSS JOIN LATERAL unnest(pc.creator_ids) AS pc_creator_id
  JOIN user_portfolio_creator_engagement upce
    ON pc_creator_id = upce.creator_id
    AND upce.did_copy = true
),
premium_totals AS (
  -- Aggregate totals per premium creator username
  SELECT
    premium_creator,
    SUM(copy_count) AS total_copies,
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
  SUM(ar.copy_count) AS total_copies
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
WITH ranked_regular AS (
  SELECT
    premium_creator,
    premium_creator_total_copies,
    premium_creator_total_liquidations,
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
    premium_creator_total_copies,
    premium_creator_total_liquidations,
    copied_creator,
    total_copies,
    unique_copiers,
    ROW_NUMBER() OVER (
      PARTITION BY premium_creator
      ORDER BY unique_copiers DESC, total_copies DESC
    ) AS rank
  FROM premium_creator_copy_affinity_base
  WHERE copy_type = 'Premium'
),
all_premium_creators AS (
  SELECT DISTINCT
    premium_creator,
    premium_creator_total_copies,
    premium_creator_total_liquidations
  FROM premium_creator_copy_affinity_base
)
SELECT
  pc.premium_creator,
  pc.premium_creator_total_copies,
  pc.premium_creator_total_liquidations,
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
FROM all_premium_creators pc
LEFT JOIN ranked_regular rr
  ON pc.premium_creator = rr.premium_creator AND rr.rank <= 5
LEFT JOIN ranked_premium rp
  ON pc.premium_creator = rp.premium_creator AND rp.rank <= 5
GROUP BY
  pc.premium_creator,
  pc.premium_creator_total_copies,
  pc.premium_creator_total_liquidations
ORDER BY pc.premium_creator_total_copies DESC;
