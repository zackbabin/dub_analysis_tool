-- Migration: Rename kyc_approved_time to first_app_open_time
-- Created: 2025-12-05
-- Purpose: Use $ae_first_app_open_date from Mixpanel instead of separate KYC chart

-- ===========================================
-- 1. Rename column in user_first_copies
-- ===========================================

ALTER TABLE user_first_copies
RENAME COLUMN kyc_approved_time TO first_app_open_time;

-- Drop old index and create new one
DROP INDEX IF EXISTS idx_user_first_copies_both_timestamps;

CREATE INDEX idx_user_first_copies_both_timestamps
ON user_first_copies(user_id)
WHERE first_copy_time IS NOT NULL AND first_app_open_time IS NOT NULL;

-- ===========================================
-- 2. Update analysis functions to use new column name
-- ===========================================

-- Portfolio sequence metrics
DROP FUNCTION IF EXISTS calculate_portfolio_sequence_metrics();

CREATE FUNCTION calculate_portfolio_sequence_metrics()
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
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY unique_portfolios) as median_unique_portfolios,
    COUNT(*)::INT as converter_count,
    COUNT(*) FILTER (WHERE unique_portfolios > 0)::INT as converters_with_views,
    COUNT(*) FILTER (WHERE unique_portfolios = 0)::INT as converters_without_views
  FROM user_portfolio_counts;
END;
$$;

-- Creator sequence metrics
DROP FUNCTION IF EXISTS calculate_creator_sequence_metrics();

CREATE FUNCTION calculate_creator_sequence_metrics()
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
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY unique_creators) as median_unique_creators,
    COUNT(*)::INT as converter_count,
    COUNT(*) FILTER (WHERE unique_creators > 0)::INT as converters_with_views,
    COUNT(*) FILTER (WHERE unique_creators = 0)::INT as converters_without_views
  FROM user_creator_counts;
END;
$$;

-- ===========================================
-- 3. Log Migration
-- ===========================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Renamed kyc_approved_time to first_app_open_time';
  RAISE NOTICE '   - Updated index for both timestamps';
  RAISE NOTICE '   - Updated calculate_portfolio_sequence_metrics()';
  RAISE NOTICE '   - Updated calculate_creator_sequence_metrics()';
  RAISE NOTICE '   - Now using $ae_first_app_open_date from single Mixpanel chart';
  RAISE NOTICE '';
END $$;
