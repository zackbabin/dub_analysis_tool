-- Migration: Fix type mismatch and add missing columns
-- Created: 2025-12-05
-- Purpose:
--   1. Fix PERCENTILE_CONT return type (cast to NUMERIC)
--   2. Add converters_with_views and converters_without_views columns to event_sequence_metrics

-- ===========================================
-- 1. Fix Portfolio Sequence Metrics Type Mismatch
-- ===========================================

DROP FUNCTION IF EXISTS calculate_portfolio_sequence_metrics();

CREATE OR REPLACE FUNCTION calculate_portfolio_sequence_metrics()
RETURNS TABLE(
  mean_unique_portfolios NUMERIC,
  median_unique_portfolios NUMERIC,
  converter_count INT,
  converters_with_views INT,
  converters_without_views INT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH converters_with_timestamps AS (
    SELECT
      ufc.user_id,
      ufc.first_app_open_time,
      ufc.first_copy_time
    FROM user_first_copies ufc
    WHERE ufc.first_app_open_time IS NOT NULL
      AND ufc.first_copy_time IS NOT NULL
  ),

  user_portfolio_counts AS (
    SELECT
      c.user_id,
      COALESCE(COUNT(DISTINCT ps.portfolio_ticker), 0)::BIGINT as unique_portfolios
    FROM converters_with_timestamps c
    LEFT JOIN portfolio_sequences_raw ps
      ON ps.user_id = c.user_id
      AND ps.event_time >= c.first_app_open_time
      AND ps.event_time < c.first_copy_time
      AND ps.portfolio_ticker IS NOT NULL
    GROUP BY c.user_id
  )

  SELECT
    ROUND(AVG(unique_portfolios), 2) as mean_unique_portfolios,
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY unique_portfolios)::NUMERIC, 2) as median_unique_portfolios,
    COUNT(*)::INT as converter_count,
    COUNT(*) FILTER (WHERE unique_portfolios > 0)::INT as converters_with_views,
    COUNT(*) FILTER (WHERE unique_portfolios = 0)::INT as converters_without_views
  FROM user_portfolio_counts;
END;
$$;

-- ===========================================
-- 2. Fix Creator Sequence Metrics Type Mismatch
-- ===========================================

DROP FUNCTION IF EXISTS calculate_creator_sequence_metrics();

CREATE OR REPLACE FUNCTION calculate_creator_sequence_metrics()
RETURNS TABLE(
  mean_unique_creators NUMERIC,
  median_unique_creators NUMERIC,
  converter_count INT,
  converters_with_views INT,
  converters_without_views INT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH converters_with_timestamps AS (
    SELECT
      ufc.user_id,
      ufc.first_app_open_time,
      ufc.first_copy_time
    FROM user_first_copies ufc
    WHERE ufc.first_app_open_time IS NOT NULL
      AND ufc.first_copy_time IS NOT NULL
  ),

  user_creator_counts AS (
    SELECT
      c.user_id,
      COALESCE(COUNT(DISTINCT cs.creator_username), 0)::BIGINT as unique_creators
    FROM converters_with_timestamps c
    LEFT JOIN creator_sequences_raw cs
      ON cs.user_id = c.user_id
      AND cs.event_time >= c.first_app_open_time
      AND cs.event_time < c.first_copy_time
      AND cs.creator_username IS NOT NULL
    GROUP BY c.user_id
  )

  SELECT
    ROUND(AVG(unique_creators), 2) as mean_unique_creators,
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY unique_creators)::NUMERIC, 2) as median_unique_creators,
    COUNT(*)::INT as converter_count,
    COUNT(*) FILTER (WHERE unique_creators > 0)::INT as converters_with_views,
    COUNT(*) FILTER (WHERE unique_creators = 0)::INT as converters_without_views
  FROM user_creator_counts;
END;
$$;

-- ===========================================
-- 3. Add Missing Columns to event_sequence_metrics
-- ===========================================

ALTER TABLE event_sequence_metrics
ADD COLUMN IF NOT EXISTS portfolio_converters_with_views INTEGER,
ADD COLUMN IF NOT EXISTS portfolio_converters_without_views INTEGER,
ADD COLUMN IF NOT EXISTS creator_converters_with_views INTEGER,
ADD COLUMN IF NOT EXISTS creator_converters_without_views INTEGER;

COMMENT ON COLUMN event_sequence_metrics.portfolio_converters_with_views IS
'Number of converters who viewed at least 1 portfolio between first_app_open and first_copy';

COMMENT ON COLUMN event_sequence_metrics.portfolio_converters_without_views IS
'Number of converters who viewed 0 portfolios between first_app_open and first_copy';

COMMENT ON COLUMN event_sequence_metrics.creator_converters_with_views IS
'Number of converters who viewed at least 1 creator profile between first_app_open and first_copy';

COMMENT ON COLUMN event_sequence_metrics.creator_converters_without_views IS
'Number of converters who viewed 0 creator profiles between first_app_open and first_copy';

-- ===========================================
-- 4. Log Migration
-- ===========================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Fixed type mismatch and added missing columns';
  RAISE NOTICE '   - Cast PERCENTILE_CONT to NUMERIC in both sequence metrics functions';
  RAISE NOTICE '   - Added 4 new columns to event_sequence_metrics table';
  RAISE NOTICE '';
END $$;
