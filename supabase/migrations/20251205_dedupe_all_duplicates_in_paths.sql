-- Migration: Remove all duplicates (not just consecutive) from full sequence paths
-- Created: 2025-12-05
-- Purpose: Keep only first occurrence of each portfolio/creator in sequence
--
-- Examples:
--   $BRETTSIMBA → $BRETTSIMBA → $PELOSI becomes $BRETTSIMBA → $PELOSI
--   $BRETTSIMBA → $PELOSI → $BRETTSIMBA becomes $BRETTSIMBA → $PELOSI

-- ===========================================
-- 1. Fix Portfolio Full Sequence - Remove All Duplicates
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
  -- Get total converter count - ONLY users who have portfolio views in the time window
  SELECT COUNT(DISTINCT ps.user_id) INTO total_converters
  FROM user_first_copies ufc
  INNER JOIN portfolio_sequences_raw ps
    ON ps.user_id = ufc.user_id
    AND ps.event_time >= ufc.first_app_open_time
    AND ps.event_time < ufc.first_copy_time
    AND ps.portfolio_ticker IS NOT NULL
  WHERE ufc.first_app_open_time IS NOT NULL
    AND ufc.first_copy_time IS NOT NULL;

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
      ROW_NUMBER() OVER (PARTITION BY ps.user_id ORDER BY ps.event_time DESC) as position_from_end
    FROM portfolio_sequences_raw ps
    INNER JOIN all_converters ac ON ps.user_id = ac.user_id
    WHERE ps.event_time >= ac.first_app_open_time
      AND ps.event_time < ac.first_copy_time
      AND ps.portfolio_ticker IS NOT NULL
  ),

  top_viewed_portfolios AS (
    SELECT
      'top_portfolios_viewed'::TEXT as analysis_type_col,
      ROW_NUMBER() OVER (ORDER BY ROUND((COUNT(DISTINCT user_id)::NUMERIC / total_converters * 100), 2) DESC) as path_rank,
      ARRAY[portfolio_ticker] as portfolio_sequence,
      COUNT(DISTINCT user_id)::INT as converter_count,
      ROUND((COUNT(DISTINCT user_id)::NUMERIC / total_converters * 100), 2) as pct_of_converters,
      total_converters as total_converters_analyzed
    FROM ordered_views
    GROUP BY portfolio_ticker
    ORDER BY ROUND((COUNT(DISTINCT user_id)::NUMERIC / total_converters * 100), 2) DESC
    LIMIT 10
  ),

  user_portfolio_sets AS (
    SELECT
      user_id,
      ARRAY_AGG(DISTINCT portfolio_ticker ORDER BY portfolio_ticker) as portfolio_set
    FROM ordered_views
    GROUP BY user_id
    HAVING COUNT(DISTINCT portfolio_ticker) >= 2
  ),

  portfolio_combinations AS (
    SELECT
      'portfolio_combinations'::TEXT as analysis_type_col,
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

  -- Keep only first occurrence of each portfolio per user
  deduped_views AS (
    SELECT
      user_id,
      portfolio_ticker,
      event_time,
      position_from_end,
      ROW_NUMBER() OVER (PARTITION BY user_id, portfolio_ticker ORDER BY event_time ASC) as occurrence_num
    FROM ordered_views
    WHERE position_from_end <= 5
  ),

  user_sequences AS (
    SELECT
      user_id,
      ARRAY_AGG(portfolio_ticker ORDER BY event_time ASC) as portfolio_sequence
    FROM deduped_views
    WHERE occurrence_num = 1  -- Keep only first occurrence of each portfolio
    GROUP BY user_id
  ),

  full_sequences AS (
    SELECT
      'full_sequence'::TEXT as analysis_type_col,
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
    SELECT
      tvp.analysis_type_col,
      tvp.path_rank,
      tvp.portfolio_sequence,
      tvp.converter_count,
      tvp.pct_of_converters,
      tvp.total_converters_analyzed
    FROM top_viewed_portfolios tvp
    UNION ALL
    SELECT
      pc.analysis_type_col,
      pc.path_rank,
      pc.portfolio_sequence,
      pc.converter_count,
      pc.pct_of_converters,
      pc.total_converters_analyzed
    FROM portfolio_combinations pc
    UNION ALL
    SELECT
      fs.analysis_type_col,
      fs.path_rank,
      fs.portfolio_sequence,
      fs.converter_count,
      fs.pct_of_converters,
      fs.total_converters_analyzed
    FROM full_sequences fs
  )

  SELECT
    cr.analysis_type_col as analysis_type,
    cr.path_rank,
    cr.portfolio_sequence,
    cr.converter_count,
    cr.pct_of_converters,
    cr.total_converters_analyzed
  FROM combined_results cr
  ORDER BY
    CASE cr.analysis_type_col
      WHEN 'top_portfolios_viewed' THEN 1
      WHEN 'portfolio_combinations' THEN 2
      WHEN 'full_sequence' THEN 3
    END,
    cr.path_rank;
END;
$$;

-- ===========================================
-- 2. Fix Creator Full Sequence - Remove All Duplicates
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
  -- Get total converter count - ONLY users who have creator views in the time window
  SELECT COUNT(DISTINCT cs.user_id) INTO total_converters
  FROM user_first_copies ufc
  INNER JOIN creator_sequences_raw cs
    ON cs.user_id = ufc.user_id
    AND cs.event_time >= ufc.first_app_open_time
    AND cs.event_time < ufc.first_copy_time
    AND cs.creator_username IS NOT NULL
  WHERE ufc.first_app_open_time IS NOT NULL
    AND ufc.first_copy_time IS NOT NULL;

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
      ROW_NUMBER() OVER (PARTITION BY cs.user_id ORDER BY cs.event_time DESC) as position_from_end
    FROM creator_sequences_raw cs
    INNER JOIN all_converters ac ON cs.user_id = ac.user_id
    WHERE cs.event_time >= ac.first_app_open_time
      AND cs.event_time < ac.first_copy_time
      AND cs.creator_username IS NOT NULL
  ),

  top_viewed_creators AS (
    SELECT
      'top_creators_viewed'::TEXT as analysis_type_col,
      ROW_NUMBER() OVER (ORDER BY ROUND((COUNT(DISTINCT user_id)::NUMERIC / total_converters * 100), 2) DESC) as path_rank,
      ARRAY[creator_username] as creator_sequence,
      COUNT(DISTINCT user_id)::INT as converter_count,
      ROUND((COUNT(DISTINCT user_id)::NUMERIC / total_converters * 100), 2) as pct_of_converters,
      total_converters as total_converters_analyzed
    FROM ordered_views
    GROUP BY creator_username
    ORDER BY ROUND((COUNT(DISTINCT user_id)::NUMERIC / total_converters * 100), 2) DESC
    LIMIT 10
  ),

  user_creator_sets AS (
    SELECT
      user_id,
      ARRAY_AGG(DISTINCT creator_username ORDER BY creator_username) as creator_set
    FROM ordered_views
    GROUP BY user_id
    HAVING COUNT(DISTINCT creator_username) >= 2
  ),

  creator_combinations AS (
    SELECT
      'creator_combinations'::TEXT as analysis_type_col,
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

  -- Keep only first occurrence of each creator per user
  deduped_views AS (
    SELECT
      user_id,
      creator_username,
      event_time,
      position_from_end,
      ROW_NUMBER() OVER (PARTITION BY user_id, creator_username ORDER BY event_time ASC) as occurrence_num
    FROM ordered_views
    WHERE position_from_end <= 5
  ),

  user_sequences AS (
    SELECT
      user_id,
      ARRAY_AGG(creator_username ORDER BY event_time ASC) as creator_sequence
    FROM deduped_views
    WHERE occurrence_num = 1  -- Keep only first occurrence of each creator
    GROUP BY user_id
  ),

  full_sequences AS (
    SELECT
      'full_sequence'::TEXT as analysis_type_col,
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
    SELECT
      tvc.analysis_type_col,
      tvc.path_rank,
      tvc.creator_sequence,
      tvc.converter_count,
      tvc.pct_of_converters,
      tvc.total_converters_analyzed
    FROM top_viewed_creators tvc
    UNION ALL
    SELECT
      cc.analysis_type_col,
      cc.path_rank,
      cc.creator_sequence,
      cc.converter_count,
      cc.pct_of_converters,
      cc.total_converters_analyzed
    FROM creator_combinations cc
    UNION ALL
    SELECT
      fs.analysis_type_col,
      fs.path_rank,
      fs.creator_sequence,
      fs.converter_count,
      fs.pct_of_converters,
      fs.total_converters_analyzed
    FROM full_sequences fs
  )

  SELECT
    cr.analysis_type_col as analysis_type,
    cr.path_rank,
    cr.creator_sequence,
    cr.converter_count,
    cr.pct_of_converters,
    cr.total_converters_analyzed
  FROM combined_results cr
  ORDER BY
    CASE cr.analysis_type_col
      WHEN 'top_creators_viewed' THEN 1
      WHEN 'creator_combinations' THEN 2
      WHEN 'full_sequence' THEN 3
    END,
    cr.path_rank;
END;
$$;

-- ===========================================
-- 3. Log Migration
-- ===========================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Updated deduplication to remove ALL duplicates (not just consecutive)';
  RAISE NOTICE '   - Uses ROW_NUMBER() to identify first occurrence of each ticker/creator';
  RAISE NOTICE '   - Keeps only occurrence_num = 1 for each ticker/creator per user';
  RAISE NOTICE '   - Example 1: [$BRETTSIMBA, $BRETTSIMBA, $PELOSI] → [$BRETTSIMBA, $PELOSI]';
  RAISE NOTICE '   - Example 2: [$BRETTSIMBA, $PELOSI, $BRETTSIMBA] → [$BRETTSIMBA, $PELOSI]';
  RAISE NOTICE '';
  RAISE NOTICE '✅ Fixed total_converters to only count users with views';
  RAISE NOTICE '   - Portfolio: Counts only users with portfolio views in time window';
  RAISE NOTICE '   - Creator: Counts only users with creator views in time window';
  RAISE NOTICE '   - Percentages now accurately reflect share of engaged users';
  RAISE NOTICE '';
END $$;
