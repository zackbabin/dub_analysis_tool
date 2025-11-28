-- Migration: Fix sequence metrics return types
-- Created: 2025-11-28
-- Purpose: Cast PERCENTILE_CONT from double precision to NUMERIC to match function signature

-- =======================
-- 1. Fix Portfolio Sequence Analysis Function
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
      es.user_id,
      COUNT(DISTINCT es.portfolio_ticker) as unique_portfolios
    FROM event_sequences_raw es
    INNER JOIN recent_converters rc ON es.user_id = rc.user_id
    WHERE es.event_name = 'Viewed Portfolio Details'
      AND es.event_time < rc.first_copy_time  -- Events before first copy
      AND es.portfolio_ticker IS NOT NULL
    GROUP BY es.user_id
  )
  SELECT
    ROUND(AVG(unique_portfolios), 2) as mean_unique_portfolios,
    CAST(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY unique_portfolios) AS NUMERIC) as median_unique_portfolios
  FROM user_unique_counts;
END;
$$;

-- =======================
-- 2. Fix Creator Sequence Analysis Function
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
      es.user_id,
      COUNT(DISTINCT es.creator_username) as unique_creators
    FROM event_sequences_raw es
    INNER JOIN recent_converters rc ON es.user_id = rc.user_id
    WHERE es.event_name = 'Viewed Creator Profile'
      AND es.event_time < rc.first_copy_time  -- Events before first copy
      AND es.creator_username IS NOT NULL
    GROUP BY es.user_id
  )
  SELECT
    ROUND(AVG(unique_creators), 2) as mean_unique_creators,
    CAST(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY unique_creators) AS NUMERIC) as median_unique_creators
  FROM user_unique_counts;
END;
$$;

-- =======================
-- 3. Log the fix
-- =======================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Fixed sequence metrics functions return types';
  RAISE NOTICE '   - Cast PERCENTILE_CONT (double precision) to NUMERIC';
  RAISE NOTICE '   - Resolves: structure of query does not match function result type';
  RAISE NOTICE '';
END $$;
