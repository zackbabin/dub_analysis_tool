-- Migration: Fix type mismatch in sequence metrics functions
-- Created: 2025-12-02
-- Purpose: Cast PERCENTILE_CONT result to NUMERIC to match function signature
-- Error: "Returned type double precision does not match expected type numeric"

-- =======================
-- 1. Fix Portfolio Sequence Metrics
-- =======================

DROP FUNCTION IF EXISTS calculate_portfolio_sequence_metrics();

CREATE OR REPLACE FUNCTION calculate_portfolio_sequence_metrics()
RETURNS TABLE(
  mean_unique_portfolios NUMERIC,
  median_unique_portfolios NUMERIC,
  converter_count INTEGER
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH recent_converters AS (
    -- Get ALL users who copied (no limit - analyze full dataset)
    SELECT user_id, first_copy_time
    FROM user_first_copies
    ORDER BY first_copy_time DESC
    -- No LIMIT - SQL is fast enough to handle all converters
  ),
  user_unique_counts AS (
    -- For each user, count distinct portfolios viewed BEFORE first copy
    SELECT
      ps.user_id,
      COUNT(DISTINCT ps.portfolio_ticker) as unique_portfolios
    FROM portfolio_sequences_raw ps
    INNER JOIN recent_converters rc ON ps.user_id = rc.user_id
    WHERE ps.event_name = 'Viewed Portfolio Details'
      AND ps.event_time < rc.first_copy_time  -- Events before first copy
      AND ps.portfolio_ticker IS NOT NULL
    GROUP BY ps.user_id
  )
  SELECT
    ROUND(AVG(unique_portfolios), 2) as mean_unique_portfolios,
    CAST(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY unique_portfolios) AS NUMERIC) as median_unique_portfolios,
    COUNT(*)::INTEGER as converter_count
  FROM user_unique_counts;
END;
$$;

-- =======================
-- 2. Fix Creator Sequence Metrics
-- =======================

DROP FUNCTION IF EXISTS calculate_creator_sequence_metrics();

CREATE OR REPLACE FUNCTION calculate_creator_sequence_metrics()
RETURNS TABLE(
  mean_unique_creators NUMERIC,
  median_unique_creators NUMERIC,
  converter_count INTEGER
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH recent_converters AS (
    -- Get ALL users who copied (no limit - analyze full dataset)
    SELECT user_id, first_copy_time
    FROM user_first_copies
    ORDER BY first_copy_time DESC
    -- No LIMIT - SQL is fast enough to handle all converters
  ),
  user_unique_counts AS (
    -- For each user, count distinct creators viewed BEFORE first copy
    SELECT
      cs.user_id,
      COUNT(DISTINCT cs.creator_username) as unique_creators
    FROM creator_sequences_raw cs
    INNER JOIN recent_converters rc ON cs.user_id = rc.user_id
    WHERE cs.event_name = 'Viewed Creator Profile'
      AND cs.event_time < rc.first_copy_time  -- Events before first copy
      AND cs.creator_username IS NOT NULL
    GROUP BY cs.user_id
  )
  SELECT
    ROUND(AVG(unique_creators), 2) as mean_unique_creators,
    CAST(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY unique_creators) AS NUMERIC) as median_unique_creators,
    COUNT(*)::INTEGER as converter_count
  FROM user_unique_counts;
END;
$$;

-- =======================
-- 3. Log Fix
-- =======================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Fixed type mismatch in sequence metrics functions';
  RAISE NOTICE '   - Added CAST to NUMERIC for PERCENTILE_CONT results';
  RAISE NOTICE '   - Both functions now return correct types';
  RAISE NOTICE '';
END $$;
