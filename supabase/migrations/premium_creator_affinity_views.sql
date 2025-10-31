-- Migration: Premium Creator Affinity Views
-- Description: Creates 2-stage view approach for premium creator affinity analysis
-- with proper indexes for performance

-- ============================================================================
-- Step 1: Create Performance Indexes
-- ============================================================================

-- Index for identifying premium creators (subscription_count > 0)
CREATE INDEX IF NOT EXISTS idx_user_creator_engagement_subscription
ON user_creator_engagement(creator_id, subscription_count, creator_username)
WHERE subscription_count > 0;

-- Index for finding copiers of a specific creator
CREATE INDEX IF NOT EXISTS idx_upce_creator_copy
ON user_portfolio_creator_engagement(creator_id, did_copy, distinct_id, copy_count, liquidation_count)
WHERE did_copy = true;

-- Index for finding what a specific user copied
CREATE INDEX IF NOT EXISTS idx_upce_distinct_copy
ON user_portfolio_creator_engagement(distinct_id, did_copy, creator_id, creator_username, copy_count)
WHERE did_copy = true;

-- ============================================================================
-- Step 2: Create Base View (Non-Pivoted Affinity Data)
-- ============================================================================

CREATE OR REPLACE VIEW premium_creator_copy_affinity_base AS
WITH premium_creators AS (
  -- Premium creators are those with subscriptions
  SELECT DISTINCT creator_id, creator_username
  FROM user_creator_engagement
  WHERE subscription_count > 0
),
premium_creator_copiers AS (
  -- Get all users who copied each premium creator
  -- This will use idx_upce_creator_copy
  SELECT
    pc.creator_id AS premium_creator_id,
    pc.creator_username AS premium_creator,
    upce.distinct_id AS copier_id,
    upce.copy_count,
    upce.liquidation_count
  FROM premium_creators pc
  JOIN user_portfolio_creator_engagement upce
    ON pc.creator_id = upce.creator_id
    AND upce.did_copy = true
),
premium_totals AS (
  -- Aggregate totals per premium creator (small dataset)
  SELECT
    premium_creator_id,
    premium_creator,
    SUM(copy_count) AS total_copies,
    SUM(liquidation_count) AS total_liquidations
  FROM premium_creator_copiers
  GROUP BY premium_creator_id, premium_creator
),
affinity_raw AS (
  -- Find what else these copiers copied
  -- This will use idx_upce_distinct_copy
  SELECT
    pcc.premium_creator_id,
    pcc.premium_creator,
    upce2.creator_id AS copied_creator_id,
    upce2.creator_username AS copied_creator,
    upce2.distinct_id AS copier_id,
    upce2.copy_count
  FROM premium_creator_copiers pcc
  JOIN user_portfolio_creator_engagement upce2
    ON pcc.copier_id = upce2.distinct_id
    AND upce2.did_copy = true
    AND upce2.creator_id != pcc.premium_creator_id  -- Exclude self
)
SELECT
  ar.premium_creator,
  pt.total_copies AS premium_creator_total_copies,
  pt.total_liquidations AS premium_creator_total_liquidations,
  ar.copied_creator,
  CASE WHEN pc.creator_id IS NOT NULL THEN 'Premium' ELSE 'Regular' END AS copy_type,
  COUNT(DISTINCT ar.copier_id) AS unique_copiers,
  SUM(ar.copy_count) AS total_copies
FROM affinity_raw ar
JOIN premium_totals pt
  ON ar.premium_creator = pt.premium_creator
LEFT JOIN premium_creators pc
  ON ar.copied_creator_id = pc.creator_id
GROUP BY
  ar.premium_creator,
  pt.total_copies,
  pt.total_liquidations,
  ar.copied_creator,
  pc.creator_id
ORDER BY ar.premium_creator, unique_copiers DESC;

-- ============================================================================
-- Step 3: Create Pivot View (Display Format)
-- ============================================================================

CREATE OR REPLACE VIEW premium_creator_affinity_display AS
WITH ranked_affinity AS (
  SELECT
    premium_creator,
    premium_creator_total_copies,
    premium_creator_total_liquidations,
    copied_creator,
    copy_type,
    total_copies,
    ROW_NUMBER() OVER (
      PARTITION BY premium_creator, copy_type
      ORDER BY unique_copiers DESC, total_copies DESC
    ) AS rank
  FROM premium_creator_copy_affinity_base
)
SELECT
  premium_creator,
  premium_creator_total_copies,
  premium_creator_total_liquidations,
  MAX(CASE WHEN copy_type = 'Premium' AND rank = 1 THEN copied_creator || ': ' || total_copies END) AS top_1_premium,
  MAX(CASE WHEN copy_type = 'Regular' AND rank = 1 THEN copied_creator || ': ' || total_copies END) AS top_1_regular,
  MAX(CASE WHEN copy_type = 'Premium' AND rank = 2 THEN copied_creator || ': ' || total_copies END) AS top_2_premium,
  MAX(CASE WHEN copy_type = 'Regular' AND rank = 2 THEN copied_creator || ': ' || total_copies END) AS top_2_regular,
  MAX(CASE WHEN copy_type = 'Premium' AND rank = 3 THEN copied_creator || ': ' || total_copies END) AS top_3_premium,
  MAX(CASE WHEN copy_type = 'Regular' AND rank = 3 THEN copied_creator || ': ' || total_copies END) AS top_3_regular,
  MAX(CASE WHEN copy_type = 'Premium' AND rank = 4 THEN copied_creator || ': ' || total_copies END) AS top_4_premium,
  MAX(CASE WHEN copy_type = 'Regular' AND rank = 4 THEN copied_creator || ': ' || total_copies END) AS top_4_regular,
  MAX(CASE WHEN copy_type = 'Premium' AND rank = 5 THEN copied_creator || ': ' || total_copies END) AS top_5_premium,
  MAX(CASE WHEN copy_type = 'Regular' AND rank = 5 THEN copied_creator || ': ' || total_copies END) AS top_5_regular
FROM ranked_affinity
WHERE rank <= 5
GROUP BY premium_creator, premium_creator_total_copies, premium_creator_total_liquidations
ORDER BY premium_creator_total_copies DESC;

-- ============================================================================
-- Cleanup: Comment for manual execution after verification
-- ============================================================================

-- After verifying the views work correctly, drop the old computed table:
-- DROP TABLE IF EXISTS premium_creator_copy_affinity_computed CASCADE;
