-- Migration: Update sequence analysis functions to analyze ALL converters
-- Created: 2025-12-02
-- Purpose: Remove 250 converter limit and return converter count for dynamic tooltips
--
-- Changes:
-- - Remove LIMIT 250 from both functions (analyze all converters)
-- - Add converter_count to return values
-- - Update function signatures and comments

-- =======================
-- 1. Update Portfolio Sequence Analysis Function
-- =======================

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
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY unique_portfolios) as median_unique_portfolios,
    COUNT(*)::INTEGER as converter_count
  FROM user_unique_counts;
END;
$$;

COMMENT ON FUNCTION calculate_portfolio_sequence_metrics IS
'Calculates mean and median unique portfolio views before first copy for ALL converters (no limit).
Returns converter_count for dynamic UI display.
Replaces Claude API call in analyze-portfolio-sequences edge function.
Returns: mean_unique_portfolios, median_unique_portfolios, converter_count';

-- =======================
-- 2. Update Creator Sequence Analysis Function
-- =======================

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
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY unique_creators) as median_unique_creators,
    COUNT(*)::INTEGER as converter_count
  FROM user_unique_counts;
END;
$$;

COMMENT ON FUNCTION calculate_creator_sequence_metrics IS
'Calculates mean and median unique creator profile views before first copy for ALL converters (no limit).
Returns converter_count for dynamic UI display.
Replaces Claude API call in analyze-creator-sequences edge function.
Returns: mean_unique_creators, median_unique_creators, converter_count';

-- =======================
-- 3. Add converter count columns to event_sequence_metrics table
-- =======================

ALTER TABLE event_sequence_metrics
ADD COLUMN IF NOT EXISTS portfolio_converter_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS creator_converter_count INTEGER DEFAULT 0;

COMMENT ON COLUMN event_sequence_metrics.portfolio_converter_count IS 'Number of converters analyzed for portfolio sequence metrics';
COMMENT ON COLUMN event_sequence_metrics.creator_converter_count IS 'Number of converters analyzed for creator sequence metrics';

-- =======================
-- Migration Complete
-- =======================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Updated event sequence analysis SQL functions';
  RAISE NOTICE '   - Removed 250 converter limit (now analyzes ALL converters)';
  RAISE NOTICE '   - Added converter_count to return values';
  RAISE NOTICE '   - SQL performance is fast enough for full dataset';
  RAISE NOTICE '';
END $$;
