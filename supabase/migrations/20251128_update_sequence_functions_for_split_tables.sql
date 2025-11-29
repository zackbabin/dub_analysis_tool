-- Migration: Update sequence analysis functions to use split tables
-- Created: 2025-11-28
-- Purpose: Update SQL functions to query portfolio_sequences_raw and creator_sequences_raw

-- =======================
-- 1. Update Portfolio Sequence Analysis Function
-- =======================

CREATE OR REPLACE FUNCTION calculate_portfolio_sequence_metrics()
RETURNS TABLE(
  mean_unique_portfolios NUMERIC,
  median_unique_portfolios NUMERIC
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH recent_converters AS (
    -- Get 1000 most recent users who copied
    SELECT user_id, first_copy_time
    FROM user_first_copies
    ORDER BY first_copy_time DESC
    LIMIT 1000
  ),
  user_unique_counts AS (
    -- For each user, count distinct portfolios viewed BEFORE first copy
    SELECT
      ps.user_id,
      COUNT(DISTINCT ps.portfolio_ticker) as unique_portfolios
    FROM portfolio_sequences_raw ps
    INNER JOIN recent_converters rc ON ps.user_id = rc.user_id
    WHERE ps.event_time < rc.first_copy_time  -- Events before first copy
    GROUP BY ps.user_id
  )
  SELECT
    ROUND(AVG(unique_portfolios), 2) as mean_unique_portfolios,
    CAST(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY unique_portfolios) AS NUMERIC) as median_unique_portfolios
  FROM user_unique_counts;
END;
$$;

-- =======================
-- 2. Update Creator Sequence Analysis Function
-- =======================

CREATE OR REPLACE FUNCTION calculate_creator_sequence_metrics()
RETURNS TABLE(
  mean_unique_creators NUMERIC,
  median_unique_creators NUMERIC
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH recent_converters AS (
    -- Get 1000 most recent users who copied
    SELECT user_id, first_copy_time
    FROM user_first_copies
    ORDER BY first_copy_time DESC
    LIMIT 1000
  ),
  user_unique_counts AS (
    -- For each user, count distinct creators viewed BEFORE first copy
    SELECT
      cs.user_id,
      COUNT(DISTINCT cs.creator_username) as unique_creators
    FROM creator_sequences_raw cs
    INNER JOIN recent_converters rc ON cs.user_id = rc.user_id
    WHERE cs.event_time < rc.first_copy_time  -- Events before first copy
    GROUP BY cs.user_id
  )
  SELECT
    ROUND(AVG(unique_creators), 2) as mean_unique_creators,
    CAST(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY unique_creators) AS NUMERIC) as median_unique_creators
  FROM user_unique_counts;
END;
$$;

-- =======================
-- 3. Update Function Comments
-- =======================

COMMENT ON FUNCTION calculate_portfolio_sequence_metrics IS
'Calculates mean and median unique portfolio views before first copy.
Queries portfolio_sequences_raw (NOT event_sequences_raw).
Used by analyze-portfolio-sequences edge function.';

COMMENT ON FUNCTION calculate_creator_sequence_metrics IS
'Calculates mean and median unique creator profile views before first copy.
Queries creator_sequences_raw (NOT event_sequences_raw).
Used by analyze-creator-sequences edge function.';

-- =======================
-- 4. Log the changes
-- =======================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Updated sequence analysis functions for split tables';
  RAISE NOTICE '   - calculate_portfolio_sequence_metrics: queries portfolio_sequences_raw';
  RAISE NOTICE '   - calculate_creator_sequence_metrics: queries creator_sequences_raw';
  RAISE NOTICE '   - Both functions still populate event_sequence_metrics table';
  RAISE NOTICE '';
END $$;
