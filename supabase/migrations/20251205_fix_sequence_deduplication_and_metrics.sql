-- Migration: Fix sequence deduplication and reconcile metrics
-- Created: 2025-12-05
-- Purpose:
--   1. Deduplicate consecutive items in sequences (e.g., no "$PELOSI → $PELOSI → $PELOSI")
--   2. Ensure converter_count includes ALL users with both timestamps (not just those with events)
--   3. Fix mean calculation to include users with 0 views

-- ===========================================
-- 1. Update Portfolio Sequence Metrics - Include All Users
-- ===========================================

-- Drop existing function to allow return type change
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
    -- All users with both first_app_open_time and first_copy_time
    SELECT
      ufc.user_id,
      ufc.first_app_open_time,
      ufc.first_copy_time
    FROM user_first_copies ufc
    WHERE ufc.first_app_open_time IS NOT NULL
      AND ufc.first_copy_time IS NOT NULL
  ),

  user_portfolio_counts AS (
    -- Count unique portfolios viewed between KYC and first copy for each user
    -- LEFT JOIN to include users with 0 views
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

-- ===========================================
-- 2. Update Creator Sequence Metrics - Include All Users
-- ===========================================

-- Drop existing function to allow return type change
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
    -- All users with both first_app_open_time and first_copy_time
    SELECT
      ufc.user_id,
      ufc.first_app_open_time,
      ufc.first_copy_time
    FROM user_first_copies ufc
    WHERE ufc.first_app_open_time IS NOT NULL
      AND ufc.first_copy_time IS NOT NULL
  ),

  user_creator_counts AS (
    -- Count unique creators viewed between KYC and first copy for each user
    -- LEFT JOIN to include users with 0 views
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
-- 3. Fix Portfolio Copy Paths - Dedupe Sequences
-- ===========================================

CREATE OR REPLACE FUNCTION analyze_portfolio_copy_paths()
RETURNS TABLE(
  analysis_type TEXT,
  path_rank BIGINT,
  portfolio_sequence TEXT[],
  converter_count INT,
  pct_of_converters NUMERIC,
  total_converters_analyzed INT
)
LANGUAGE plpgsql
AS $$
DECLARE
  total_converters INT;
BEGIN
  -- Get total converter count (only users with both timestamps)
  SELECT COUNT(DISTINCT user_id) INTO total_converters
  FROM user_first_copies
  WHERE first_app_open_time IS NOT NULL
    AND first_copy_time IS NOT NULL;

  RETURN QUERY
  WITH all_converters AS (
    SELECT user_id, first_app_open_time, first_copy_time
    FROM user_first_copies
    WHERE first_app_open_time IS NOT NULL
      AND first_copy_time IS NOT NULL
  ),

  ordered_views AS (
    SELECT
      ps.user_id,
      ps.portfolio_ticker,
      ps.event_time,
      ROW_NUMBER() OVER (PARTITION BY ps.user_id ORDER BY ps.event_time ASC) as position_from_start,
      ROW_NUMBER() OVER (PARTITION BY ps.user_id ORDER BY ps.event_time DESC) as position_from_end,
      LAG(ps.portfolio_ticker) OVER (PARTITION BY ps.user_id ORDER BY ps.event_time ASC) as prev_portfolio
    FROM portfolio_sequences_raw ps
    INNER JOIN all_converters ac ON ps.user_id = ac.user_id
    WHERE ps.event_time >= ac.first_app_open_time
      AND ps.event_time < ac.first_copy_time
      AND ps.portfolio_ticker IS NOT NULL
  ),

  -- Deduplicate consecutive views of the same portfolio
  deduped_views AS (
    SELECT
      user_id,
      portfolio_ticker,
      event_time,
      position_from_start,
      position_from_end
    FROM ordered_views
    WHERE portfolio_ticker IS DISTINCT FROM prev_portfolio  -- Keep only when different from previous
  ),

  -- Recalculate position_from_end after deduplication
  deduped_views_reranked AS (
    SELECT
      user_id,
      portfolio_ticker,
      event_time,
      position_from_start,
      ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY event_time DESC) as position_from_end
    FROM deduped_views
  ),

  -- Top 10 most viewed portfolios
  top_viewed_portfolios_unranked AS (
    SELECT
      'top_portfolios_viewed'::TEXT as analysis_type,
      ARRAY[portfolio_ticker] as portfolio_sequence,
      COUNT(DISTINCT user_id)::INT as converter_count,
      ROUND((COUNT(DISTINCT user_id)::NUMERIC / total_converters * 100), 2) as pct_of_converters,
      total_converters as total_converters_analyzed
    FROM deduped_views_reranked
    GROUP BY portfolio_ticker
    ORDER BY pct_of_converters DESC, converter_count DESC
    LIMIT 10
  ),

  top_viewed_portfolios AS (
    SELECT
      analysis_type,
      ROW_NUMBER() OVER (ORDER BY pct_of_converters DESC, converter_count DESC) as path_rank,
      portfolio_sequence,
      converter_count,
      pct_of_converters,
      total_converters_analyzed
    FROM top_viewed_portfolios_unranked
  ),

  -- Portfolio combinations
  user_portfolio_sets AS (
    SELECT
      user_id,
      ARRAY_AGG(DISTINCT portfolio_ticker ORDER BY portfolio_ticker) as portfolio_set
    FROM deduped_views_reranked
    GROUP BY user_id
    HAVING COUNT(DISTINCT portfolio_ticker) >= 2
  ),

  portfolio_combinations AS (
    SELECT
      'portfolio_combinations'::TEXT as analysis_type,
      ROW_NUMBER() OVER (ORDER BY COUNT(DISTINCT ups.user_id) DESC) as path_rank,
      ups.portfolio_set as portfolio_sequence,
      COUNT(DISTINCT ups.user_id)::INT as converter_count,
      ROUND((COUNT(DISTINCT ups.user_id)::NUMERIC / total_converters * 100), 2) as pct_of_converters,
      total_converters as total_converters_analyzed
    FROM user_portfolio_sets ups
    GROUP BY ups.portfolio_set
    ORDER BY COUNT(DISTINCT ups.user_id) DESC
    LIMIT 10
  ),

  -- Full sequences (last 5 UNIQUE portfolios before copy)
  user_sequences AS (
    SELECT
      user_id,
      ARRAY_AGG(portfolio_ticker ORDER BY event_time ASC) as portfolio_sequence
    FROM (
      SELECT user_id, portfolio_ticker, event_time
      FROM deduped_views_reranked
      WHERE position_from_end <= 5
    ) last_five
    GROUP BY user_id
  ),

  full_sequences AS (
    SELECT
      'full_sequence'::TEXT as analysis_type,
      ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC) as path_rank,
      us.portfolio_sequence,
      COUNT(*)::INT as converter_count,
      ROUND((COUNT(*)::NUMERIC / total_converters * 100), 2) as pct_of_converters,
      total_converters as total_converters_analyzed
    FROM user_sequences us
    GROUP BY us.portfolio_sequence
    ORDER BY COUNT(*) DESC
    LIMIT 10
  ),

  combined_results AS (
    SELECT * FROM top_viewed_portfolios
    UNION ALL
    SELECT * FROM portfolio_combinations
    UNION ALL
    SELECT * FROM full_sequences
  )

  SELECT
    cr.analysis_type,
    cr.path_rank,
    cr.portfolio_sequence,
    cr.converter_count,
    cr.pct_of_converters,
    cr.total_converters_analyzed
  FROM combined_results cr
  ORDER BY
    CASE cr.analysis_type
      WHEN 'top_portfolios_viewed' THEN 1
      WHEN 'portfolio_combinations' THEN 2
      WHEN 'full_sequence' THEN 3
    END,
    cr.path_rank;
END;
$$;

-- ===========================================
-- 4. Fix Creator Copy Paths - Dedupe Sequences
-- ===========================================

CREATE OR REPLACE FUNCTION analyze_creator_copy_paths()
RETURNS TABLE(
  analysis_type TEXT,
  path_rank BIGINT,
  creator_sequence TEXT[],
  converter_count INT,
  pct_of_converters NUMERIC,
  total_converters_analyzed INT
)
LANGUAGE plpgsql
AS $$
DECLARE
  total_converters INT;
BEGIN
  -- Get total converter count (only users with both timestamps)
  SELECT COUNT(DISTINCT user_id) INTO total_converters
  FROM user_first_copies
  WHERE first_app_open_time IS NOT NULL
    AND first_copy_time IS NOT NULL;

  RETURN QUERY
  WITH all_converters AS (
    SELECT user_id, first_app_open_time, first_copy_time
    FROM user_first_copies
    WHERE first_app_open_time IS NOT NULL
      AND first_copy_time IS NOT NULL
  ),

  ordered_views AS (
    SELECT
      cs.user_id,
      cs.creator_username,
      cs.event_time,
      ROW_NUMBER() OVER (PARTITION BY cs.user_id ORDER BY cs.event_time ASC) as position_from_start,
      ROW_NUMBER() OVER (PARTITION BY cs.user_id ORDER BY cs.event_time DESC) as position_from_end,
      LAG(cs.creator_username) OVER (PARTITION BY cs.user_id ORDER BY cs.event_time ASC) as prev_creator
    FROM creator_sequences_raw cs
    INNER JOIN all_converters ac ON cs.user_id = ac.user_id
    WHERE cs.event_time >= ac.first_app_open_time
      AND cs.event_time < ac.first_copy_time
      AND cs.creator_username IS NOT NULL
  ),

  -- Deduplicate consecutive views of the same creator
  deduped_views AS (
    SELECT
      user_id,
      creator_username,
      event_time,
      position_from_start,
      position_from_end
    FROM ordered_views
    WHERE creator_username IS DISTINCT FROM prev_creator  -- Keep only when different from previous
  ),

  -- Recalculate position_from_end after deduplication
  deduped_views_reranked AS (
    SELECT
      user_id,
      creator_username,
      event_time,
      position_from_start,
      ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY event_time DESC) as position_from_end
    FROM deduped_views
  ),

  -- Top 10 most viewed creators
  top_viewed_creators_unranked AS (
    SELECT
      'top_creators_viewed'::TEXT as analysis_type,
      ARRAY[creator_username] as creator_sequence,
      COUNT(DISTINCT user_id)::INT as converter_count,
      ROUND((COUNT(DISTINCT user_id)::NUMERIC / total_converters * 100), 2) as pct_of_converters,
      total_converters as total_converters_analyzed
    FROM deduped_views_reranked
    GROUP BY creator_username
    ORDER BY pct_of_converters DESC, converter_count DESC
    LIMIT 10
  ),

  top_viewed_creators AS (
    SELECT
      analysis_type,
      ROW_NUMBER() OVER (ORDER BY pct_of_converters DESC, converter_count DESC) as path_rank,
      creator_sequence,
      converter_count,
      pct_of_converters,
      total_converters_analyzed
    FROM top_viewed_creators_unranked
  ),

  -- Creator combinations
  user_creator_sets AS (
    SELECT
      user_id,
      ARRAY_AGG(DISTINCT creator_username ORDER BY creator_username) as creator_set
    FROM deduped_views_reranked
    GROUP BY user_id
    HAVING COUNT(DISTINCT creator_username) >= 2
  ),

  creator_combinations AS (
    SELECT
      'creator_combinations'::TEXT as analysis_type,
      ROW_NUMBER() OVER (ORDER BY COUNT(DISTINCT ucs.user_id) DESC) as path_rank,
      ucs.creator_set as creator_sequence,
      COUNT(DISTINCT ucs.user_id)::INT as converter_count,
      ROUND((COUNT(DISTINCT ucs.user_id)::NUMERIC / total_converters * 100), 2) as pct_of_converters,
      total_converters as total_converters_analyzed
    FROM user_creator_sets ucs
    GROUP BY ucs.creator_set
    ORDER BY COUNT(DISTINCT ucs.user_id) DESC
    LIMIT 10
  ),

  -- Full sequences (last 5 UNIQUE creators before copy)
  user_sequences AS (
    SELECT
      user_id,
      ARRAY_AGG(creator_username ORDER BY event_time ASC) as creator_sequence
    FROM (
      SELECT user_id, creator_username, event_time
      FROM deduped_views_reranked
      WHERE position_from_end <= 5
    ) last_five
    GROUP BY user_id
  ),

  full_sequences AS (
    SELECT
      'full_sequence'::TEXT as analysis_type,
      ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC) as path_rank,
      us.creator_sequence,
      COUNT(*)::INT as converter_count,
      ROUND((COUNT(*)::NUMERIC / total_converters * 100), 2) as pct_of_converters,
      total_converters as total_converters_analyzed
    FROM user_sequences us
    GROUP BY us.creator_sequence
    ORDER BY COUNT(*) DESC
    LIMIT 10
  ),

  combined_results AS (
    SELECT * FROM top_viewed_creators
    UNION ALL
    SELECT * FROM creator_combinations
    UNION ALL
    SELECT * FROM full_sequences
  )

  SELECT
    cr.analysis_type,
    cr.path_rank,
    cr.creator_sequence,
    cr.converter_count,
    cr.pct_of_converters,
    cr.total_converters_analyzed
  FROM combined_results cr
  ORDER BY
    CASE cr.analysis_type
      WHEN 'top_creators_viewed' THEN 1
      WHEN 'creator_combinations' THEN 2
      WHEN 'full_sequence' THEN 3
    END,
    cr.path_rank;
END;
$$;

-- ===========================================
-- 5. Log Migration
-- ===========================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Fixed sequence deduplication and metrics calculation';
  RAISE NOTICE '   - Sequences now deduplicate consecutive identical items';
  RAISE NOTICE '   - Added LAG() to detect consecutive duplicates';
  RAISE NOTICE '   - Metrics now include ALL users with both timestamps (LEFT JOIN)';
  RAISE NOTICE '   - Added converters_with_views and converters_without_views columns';
  RAISE NOTICE '   - Mean/median now accurate (includes users with 0 views)';
  RAISE NOTICE '';
END $$;
