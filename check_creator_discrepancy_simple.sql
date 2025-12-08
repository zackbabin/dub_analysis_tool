-- Query 1: Creators in premium_creator_metrics but NOT in premium_creators
WITH discrepancies AS (
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
ORDER BY discrepancy_type, creator_username
