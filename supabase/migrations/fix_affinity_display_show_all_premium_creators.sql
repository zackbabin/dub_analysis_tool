-- Fix premium_creator_affinity_display to show ALL premium creators
-- Issue: Only premium creators with copy data were showing up
-- Solution: LEFT JOIN from premium_creators table to ensure all 17 creators appear

DROP VIEW IF EXISTS premium_creator_affinity_display;

CREATE VIEW premium_creator_affinity_display AS
WITH all_premium_creators AS (
  -- Get ALL premium creators from the authoritative table
  -- Group by username to handle duplicates (e.g., dubAdvisors)
  SELECT
    creator_username AS premium_creator,
    COALESCE(SUM(pt.total_copies), 0)::bigint AS premium_creator_total_copies,
    COALESCE(SUM(pt.total_liquidations), 0)::bigint AS premium_creator_total_liquidations
  FROM premium_creators pc
  LEFT JOIN (
    SELECT
      premium_creator,
      SUM(premium_creator_total_copies) AS total_copies,
      SUM(premium_creator_total_liquidations) AS total_liquidations
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
