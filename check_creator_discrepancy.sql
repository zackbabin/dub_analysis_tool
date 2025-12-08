-- Query to find discrepancy between premium_creators and premium_creator_metrics
-- premium_creators: 21 creators
-- premium_creator_metrics: 22 creators
-- Why is there 1 extra in premium_creator_metrics?

-- Check 1 & 2: Find creators in one table but not the other
WITH discrepancies AS (
  -- Creators in premium_creator_metrics but NOT in premium_creators
  SELECT
    'IN METRICS, NOT IN CREATORS' as discrepancy_type,
    pcm.creator_id,
    pcm.creator_username,
    pcm.total_subscriptions,
    pcm.total_paywall_views,
    pcm.synced_at
  FROM premium_creator_metrics pcm
  LEFT JOIN premium_creators pc ON pcm.creator_id = pc.creator_id
  WHERE pc.creator_id IS NULL

  UNION ALL

  -- Creators in premium_creators but NOT in premium_creator_metrics
  SELECT
    'IN CREATORS, NOT IN METRICS' as discrepancy_type,
    pc.creator_id,
    pc.creator_username,
    NULL::INT as total_subscriptions,
    NULL::INT as total_paywall_views,
    NULL::TIMESTAMPTZ as synced_at
  FROM premium_creators pc
  LEFT JOIN premium_creator_metrics pcm ON pc.creator_id = pcm.creator_id
  WHERE pcm.creator_id IS NULL
)
SELECT * FROM discrepancies
ORDER BY discrepancy_type, creator_username;

-- Check 3: Duplicate check - count rows per creator_id in premium_creator_metrics
-- (Should all be 1 after primary key migration)
SELECT
  creator_id,
  creator_username,
  COUNT(*) as row_count
FROM premium_creator_metrics
GROUP BY creator_id, creator_username
HAVING COUNT(*) > 1
ORDER BY row_count DESC;

-- Check 4: Total counts
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
FROM premium_creator_metrics;
