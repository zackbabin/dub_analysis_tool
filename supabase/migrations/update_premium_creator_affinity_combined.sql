-- Migration: Update Premium Creator Affinity Display View
-- Description: Combine Premium and Regular creators in the same Top N columns

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
      PARTITION BY premium_creator
      ORDER BY unique_copiers DESC, total_copies DESC
    ) AS overall_rank
  FROM premium_creator_copy_affinity_base
)
SELECT
  premium_creator,
  premium_creator_total_copies,
  premium_creator_total_liquidations,
  MAX(CASE WHEN overall_rank = 1 THEN copied_creator || ' (' || copy_type || '): ' || total_copies || ' copies' END) AS top_1,
  MAX(CASE WHEN overall_rank = 2 THEN copied_creator || ' (' || copy_type || '): ' || total_copies || ' copies' END) AS top_2,
  MAX(CASE WHEN overall_rank = 3 THEN copied_creator || ' (' || copy_type || '): ' || total_copies || ' copies' END) AS top_3,
  MAX(CASE WHEN overall_rank = 4 THEN copied_creator || ' (' || copy_type || '): ' || total_copies || ' copies' END) AS top_4,
  MAX(CASE WHEN overall_rank = 5 THEN copied_creator || ' (' || copy_type || '): ' || total_copies || ' copies' END) AS top_5
FROM ranked_affinity
WHERE overall_rank <= 5
GROUP BY premium_creator, premium_creator_total_copies, premium_creator_total_liquidations
ORDER BY premium_creator_total_copies DESC;
