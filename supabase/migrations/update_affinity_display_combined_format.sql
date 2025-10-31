-- Update premium_creator_affinity_display view to show separate top 5 for Regular and Premium
-- Format: "@Lane (Regular): 453" for regular_top_N and "@Sparrow (Premium): 3440" for premium_top_N

DROP VIEW IF EXISTS premium_creator_affinity_display;

CREATE VIEW premium_creator_affinity_display AS
WITH ranked_regular AS (
  -- Rank Regular copies
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
  -- Rank Premium copies
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
  -- Get all premium creators to ensure everyone gets a row
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
