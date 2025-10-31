-- Migration: Fix Premium Creator Affinity Display View
-- Description: Show both Premium and Regular creators in each Top N column, separated by " | "

DROP VIEW IF EXISTS premium_creator_affinity_display;

CREATE OR REPLACE VIEW premium_creator_affinity_display AS
WITH ranked_affinity AS (
  SELECT
    premium_creator,
    premium_creator_total_copies,
    premium_creator_total_liquidations,
    copied_creator,
    copy_type,
    total_copies,
    unique_copiers,
    ROW_NUMBER() OVER (
      PARTITION BY premium_creator, copy_type
      ORDER BY unique_copiers DESC, total_copies DESC
    ) AS rank_within_type
  FROM premium_creator_copy_affinity_base
)
SELECT
  premium_creator,
  premium_creator_total_copies,
  premium_creator_total_liquidations,
  -- Top 1: Premium | Regular
  CONCAT_WS(' | ',
    MAX(CASE WHEN copy_type = 'Premium' AND rank_within_type = 1 THEN copied_creator || ' (Premium): ' || total_copies || ' copies' END),
    MAX(CASE WHEN copy_type = 'Regular' AND rank_within_type = 1 THEN copied_creator || ' (Regular): ' || total_copies || ' copies' END)
  ) AS top_1,
  -- Top 2: Premium | Regular
  CONCAT_WS(' | ',
    MAX(CASE WHEN copy_type = 'Premium' AND rank_within_type = 2 THEN copied_creator || ' (Premium): ' || total_copies || ' copies' END),
    MAX(CASE WHEN copy_type = 'Regular' AND rank_within_type = 2 THEN copied_creator || ' (Regular): ' || total_copies || ' copies' END)
  ) AS top_2,
  -- Top 3: Premium | Regular
  CONCAT_WS(' | ',
    MAX(CASE WHEN copy_type = 'Premium' AND rank_within_type = 3 THEN copied_creator || ' (Premium): ' || total_copies || ' copies' END),
    MAX(CASE WHEN copy_type = 'Regular' AND rank_within_type = 3 THEN copied_creator || ' (Regular): ' || total_copies || ' copies' END)
  ) AS top_3,
  -- Top 4: Premium | Regular
  CONCAT_WS(' | ',
    MAX(CASE WHEN copy_type = 'Premium' AND rank_within_type = 4 THEN copied_creator || ' (Premium): ' || total_copies || ' copies' END),
    MAX(CASE WHEN copy_type = 'Regular' AND rank_within_type = 4 THEN copied_creator || ' (Regular): ' || total_copies || ' copies' END)
  ) AS top_4,
  -- Top 5: Premium | Regular
  CONCAT_WS(' | ',
    MAX(CASE WHEN copy_type = 'Premium' AND rank_within_type = 5 THEN copied_creator || ' (Premium): ' || total_copies || ' copies' END),
    MAX(CASE WHEN copy_type = 'Regular' AND rank_within_type = 5 THEN copied_creator || ' (Regular): ' || total_copies || ' copies' END)
  ) AS top_5
FROM ranked_affinity
WHERE rank_within_type <= 5
GROUP BY premium_creator, premium_creator_total_copies, premium_creator_total_liquidations
ORDER BY premium_creator_total_copies DESC;
