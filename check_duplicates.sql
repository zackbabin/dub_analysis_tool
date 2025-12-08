-- Check for duplicate creator_ids in premium_creator_metrics
SELECT
  creator_id,
  creator_username,
  COUNT(*) as row_count
FROM premium_creator_metrics
GROUP BY creator_id, creator_username
HAVING COUNT(*) > 1
ORDER BY row_count DESC
