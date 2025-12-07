-- Migration: Filter out converters with zero views from mean/median metrics
-- Created: 2025-12-05
-- Purpose: Exclude converters with no portfolio/creator views between first_app_open and first_copy
--
-- Changes:
-- - Add first_app_open_time to recent_converters CTE
-- - Filter events between first_app_open_time and first_copy_time
-- - Users with zero views won't appear in user_unique_counts, thus excluded from mean/median
-- - Does NOT affect conversion path analysis functions

-- =======================
-- 1. Update Portfolio Sequence Analysis Function
-- =======================

-- Drop existing function first
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
    -- Get ALL users who copied with both timestamps
    SELECT user_id, first_app_open_time, first_copy_time
    FROM user_first_copies
    WHERE first_app_open_time IS NOT NULL
      AND first_copy_time IS NOT NULL
    ORDER BY first_copy_time DESC
  ),
  user_unique_counts AS (
    -- For each user, count distinct portfolios viewed BETWEEN first_app_open and first_copy
    -- Users with zero views won't appear in this CTE (automatically filtered out)
    SELECT
      ps.user_id,
      COUNT(DISTINCT ps.portfolio_ticker) as unique_portfolios
    FROM portfolio_sequences_raw ps
    INNER JOIN recent_converters rc ON ps.user_id = rc.user_id
    WHERE ps.event_name = 'Viewed Portfolio Details'
      AND ps.event_time >= rc.first_app_open_time  -- After first app open
      AND ps.event_time < rc.first_copy_time       -- Before first copy
      AND ps.portfolio_ticker IS NOT NULL
    GROUP BY ps.user_id
  )
  SELECT
    ROUND(AVG(unique_portfolios), 2) as mean_unique_portfolios,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY unique_portfolios)::NUMERIC as median_unique_portfolios,
    COUNT(*)::INTEGER as converter_count
  FROM user_unique_counts;
END;
$$;

COMMENT ON FUNCTION calculate_portfolio_sequence_metrics IS
'Calculates mean and median unique portfolio views between first_app_open and first_copy.
Automatically excludes converters with zero views (they do not appear in aggregation).
Returns: mean_unique_portfolios, median_unique_portfolios, converter_count (only users with views)';

-- =======================
-- 2. Update Creator Sequence Analysis Function
-- =======================

-- Drop existing function first
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
    -- Get ALL users who copied with both timestamps
    SELECT user_id, first_app_open_time, first_copy_time
    FROM user_first_copies
    WHERE first_app_open_time IS NOT NULL
      AND first_copy_time IS NOT NULL
    ORDER BY first_copy_time DESC
  ),
  user_unique_counts AS (
    -- For each user, count distinct creators viewed BETWEEN first_app_open and first_copy
    -- Users with zero views won't appear in this CTE (automatically filtered out)
    SELECT
      cs.user_id,
      COUNT(DISTINCT cs.creator_username) as unique_creators
    FROM creator_sequences_raw cs
    INNER JOIN recent_converters rc ON cs.user_id = rc.user_id
    WHERE cs.event_name = 'Viewed Creator Profile'
      AND cs.event_time >= rc.first_app_open_time  -- After first app open
      AND cs.event_time < rc.first_copy_time       -- Before first copy
      AND cs.creator_username IS NOT NULL
    GROUP BY cs.user_id
  )
  SELECT
    ROUND(AVG(unique_creators), 2) as mean_unique_creators,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY unique_creators)::NUMERIC as median_unique_creators,
    COUNT(*)::INTEGER as converter_count
  FROM user_unique_counts;
END;
$$;

COMMENT ON FUNCTION calculate_creator_sequence_metrics IS
'Calculates mean and median unique creator profile views between first_app_open and first_copy.
Automatically excludes converters with zero views (they do not appear in aggregation).
Returns: mean_unique_creators, median_unique_creators, converter_count (only users with views)';

-- =======================
-- Migration Complete
-- =======================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Updated sequence metrics to filter out zero-view converters';
  RAISE NOTICE '   - Added first_app_open_time filter to both functions';
  RAISE NOTICE '   - Events now filtered: event_time >= first_app_open AND event_time < first_copy';
  RAISE NOTICE '   - Users with zero views automatically excluded from mean/median';
  RAISE NOTICE '   - Converter count now reflects only users with views';
  RAISE NOTICE '   - Conversion path analysis functions unchanged';
  RAISE NOTICE '';
END $$;
