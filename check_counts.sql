-- Total counts comparison
SELECT
  'premium_creators' as table_name,
  COUNT(*) as total_count,
  COUNT(DISTINCT creator_id) as unique_creator_ids
FROM premium_creators

UNION ALL

SELECT
  'premium_creator_metrics' as table_name,
  COUNT(*) as total_count,
  COUNT(DISTINCT creator_id) as unique_creator_ids
FROM premium_creator_metrics
