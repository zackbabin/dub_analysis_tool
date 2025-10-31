-- Migration: Premium Creator Affinity Views
-- Description: Creates 2-stage view approach for premium creator affinity analysis
-- with proper indexes for performance

-- ============================================================================
-- Step 1: Create Performance Indexes
-- ============================================================================

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
WITH premium_creators_list AS (
  -- Premium creators from the authoritative Mixpanel list (chart 85725073)
  SELECT creator_id, creator_username
  FROM premium_creators
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
  FROM premium_creators_list pc
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
LEFT JOIN premium_creators_list pc
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
    unique_copiers,
    ROW_NUMBER() OVER (
      PARTITION BY premium_creator
      ORDER BY unique_copiers DESC, total_copies DESC
    ) AS rank
  FROM premium_creator_copy_affinity_base
)
SELECT
  premium_creator,
  premium_creator_total_copies,
  premium_creator_total_liquidations,
  MAX(CASE WHEN rank = 1 THEN
    CASE WHEN copy_type = 'Premium' THEN '⭐ ' ELSE '' END ||
    copied_creator || ': ' || total_copies
  END) AS top_1,
  MAX(CASE WHEN rank = 2 THEN
    CASE WHEN copy_type = 'Premium' THEN '⭐ ' ELSE '' END ||
    copied_creator || ': ' || total_copies
  END) AS top_2,
  MAX(CASE WHEN rank = 3 THEN
    CASE WHEN copy_type = 'Premium' THEN '⭐ ' ELSE '' END ||
    copied_creator || ': ' || total_copies
  END) AS top_3,
  MAX(CASE WHEN rank = 4 THEN
    CASE WHEN copy_type = 'Premium' THEN '⭐ ' ELSE '' END ||
    copied_creator || ': ' || total_copies
  END) AS top_4,
  MAX(CASE WHEN rank = 5 THEN
    CASE WHEN copy_type = 'Premium' THEN '⭐ ' ELSE '' END ||
    copied_creator || ': ' || total_copies
  END) AS top_5
FROM ranked_affinity
WHERE rank <= 5
GROUP BY premium_creator, premium_creator_total_copies, premium_creator_total_liquidations
ORDER BY premium_creator_total_copies DESC;

-- ============================================================================
-- Cleanup: Comment for manual execution after verification
-- ============================================================================

-- After verifying the views work correctly, drop the old computed table:
-- DROP TABLE IF EXISTS premium_creator_copy_affinity_computed CASCADE;
