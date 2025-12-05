-- Migration: Fix Top Viewed sorting - ensure path_rank matches percentage order
-- Created: 2025-12-05
-- Purpose: Fix ROW_NUMBER() to properly rank by pct_of_converters DESC

-- ===========================================
-- 1. Fix Portfolio Copy Path Analysis
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
  WHERE kyc_approved_time IS NOT NULL
    AND first_copy_time IS NOT NULL;

  RETURN QUERY
  WITH all_converters AS (
    SELECT user_id, kyc_approved_time, first_copy_time
    FROM user_first_copies
    WHERE kyc_approved_time IS NOT NULL
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
    WHERE ps.event_time >= ac.kyc_approved_time
      AND ps.event_time < ac.first_copy_time
      AND ps.portfolio_ticker IS NOT NULL
  ),

  -- Top 10 most viewed portfolios
  top_viewed_portfolios_unranked AS (
    SELECT
      'top_portfolios_viewed'::TEXT as analysis_type,
      ARRAY[portfolio_ticker] as portfolio_sequence,
      COUNT(DISTINCT user_id)::INT as converter_count,
      ROUND((COUNT(DISTINCT user_id)::NUMERIC / total_converters * 100), 2) as pct_of_converters,
      total_converters as total_converters_analyzed
    FROM ordered_views
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
    FROM ordered_views
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

  -- Full sequences
  user_sequences AS (
    SELECT
      user_id,
      ARRAY_AGG(portfolio_ticker ORDER BY event_time ASC) as portfolio_sequence
    FROM (
      SELECT user_id, portfolio_ticker, event_time
      FROM ordered_views
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
-- 2. Fix Creator Copy Path Analysis
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
  WHERE kyc_approved_time IS NOT NULL
    AND first_copy_time IS NOT NULL;

  RETURN QUERY
  WITH all_converters AS (
    SELECT user_id, kyc_approved_time, first_copy_time
    FROM user_first_copies
    WHERE kyc_approved_time IS NOT NULL
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
    WHERE cs.event_time >= ac.kyc_approved_time
      AND cs.event_time < ac.first_copy_time
      AND cs.creator_username IS NOT NULL
  ),

  -- Top 10 most viewed creators
  top_viewed_creators_unranked AS (
    SELECT
      'top_creators_viewed'::TEXT as analysis_type,
      ARRAY[creator_username] as creator_sequence,
      COUNT(DISTINCT user_id)::INT as converter_count,
      ROUND((COUNT(DISTINCT user_id)::NUMERIC / total_converters * 100), 2) as pct_of_converters,
      total_converters as total_converters_analyzed
    FROM ordered_views
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
    FROM ordered_views
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

  -- Full sequences
  user_sequences AS (
    SELECT
      user_id,
      ARRAY_AGG(creator_username ORDER BY event_time ASC) as creator_sequence
    FROM (
      SELECT user_id, creator_username, event_time
      FROM ordered_views
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
-- 3. Log Migration
-- ===========================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Fixed top viewed sorting - v2';
  RAISE NOTICE '   - Created _unranked CTEs that do GROUP BY and LIMIT 10';
  RAISE NOTICE '   - Then apply ROW_NUMBER() in separate CTE over the limited results';
  RAISE NOTICE '   - This ensures path_rank matches the pct_of_converters order';
  RAISE NOTICE '';
END $$;
