-- Migration: Update copy path analysis to show most viewed portfolios/creators
-- Created: 2025-12-04
-- Purpose: Replace first_portfolio/first_creator with top_portfolios_viewed/top_creators_viewed
--          Remove last_portfolio/last_creator (not used)
--
-- Changes:
-- 1. top_portfolios_viewed: Top 5 most viewed portfolios (by total view count across all converters)
-- 2. top_creators_viewed: Top 5 most viewed creators (by total view count across all converters)
-- 3. Keep portfolio_combinations and creator_combinations as-is
-- 4. Keep full_sequence as-is

-- ===========================================
-- 1. Update Portfolio Copy Path Analysis
-- ===========================================

CREATE OR REPLACE FUNCTION analyze_portfolio_copy_paths()
RETURNS TABLE(
  analysis_type TEXT,
  path_rank INT,
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
  -- Get total converter count for percentage calculations
  SELECT COUNT(DISTINCT user_id) INTO total_converters
  FROM user_first_copies;

  RETURN QUERY
  WITH all_converters AS (
    -- Get ALL users who copied (no limit)
    SELECT user_id, first_copy_time
    FROM user_first_copies
  ),

  ordered_views AS (
    -- Get all pre-copy portfolio views
    SELECT
      ps.user_id,
      ps.portfolio_ticker,
      ps.event_time,
      ROW_NUMBER() OVER (PARTITION BY ps.user_id ORDER BY ps.event_time ASC) as position_from_start,
      ROW_NUMBER() OVER (PARTITION BY ps.user_id ORDER BY ps.event_time DESC) as position_from_end
    FROM portfolio_sequences_raw ps
    INNER JOIN all_converters ac ON ps.user_id = ac.user_id
    WHERE ps.event_time < ac.first_copy_time
      AND ps.portfolio_ticker IS NOT NULL
  ),

  -- NEW: Top 5 most viewed portfolios (total view counts)
  top_viewed_portfolios AS (
    SELECT
      'top_portfolios_viewed'::TEXT as analysis_type,
      ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC) as path_rank,
      ARRAY[portfolio_ticker] as portfolio_sequence,
      COUNT(DISTINCT user_id)::INT as converter_count,
      ROUND((COUNT(DISTINCT user_id)::NUMERIC / total_converters * 100), 2) as pct_of_converters,
      total_converters as total_converters_analyzed
    FROM ordered_views
    GROUP BY portfolio_ticker
    ORDER BY COUNT(*) DESC
    LIMIT 5
  ),

  -- KEEP: Portfolio combinations (pairs viewed together)
  portfolio_pairs AS (
    SELECT
      user_id,
      portfolio_ticker as portfolio1,
      LEAD(portfolio_ticker) OVER (PARTITION BY user_id ORDER BY event_time) as portfolio2
    FROM ordered_views
  ),

  portfolio_combinations AS (
    SELECT
      'portfolio_combinations'::TEXT as analysis_type,
      ROW_NUMBER() OVER (ORDER BY COUNT(DISTINCT user_id) DESC) as path_rank,
      ARRAY[portfolio1, portfolio2] as portfolio_sequence,
      COUNT(DISTINCT user_id)::INT as converter_count,
      ROUND((COUNT(DISTINCT user_id)::NUMERIC / total_converters * 100), 2) as pct_of_converters,
      total_converters as total_converters_analyzed
    FROM portfolio_pairs
    WHERE portfolio2 IS NOT NULL
      AND portfolio1 != portfolio2  -- Exclude consecutive views of same portfolio
    GROUP BY portfolio1, portfolio2
    ORDER BY COUNT(DISTINCT user_id) DESC
    LIMIT 5
  ),

  -- KEEP: Top 5 complete sequences (last 5 portfolios before copy, preserving order)
  user_sequences AS (
    SELECT
      user_id,
      ARRAY_AGG(portfolio_ticker ORDER BY event_time ASC) as portfolio_sequence
    FROM (
      SELECT
        user_id,
        portfolio_ticker,
        event_time
      FROM ordered_views
      WHERE position_from_end <= 5  -- Last 5 portfolios before copy
    ) last_five
    GROUP BY user_id
  ),

  full_sequences AS (
    SELECT
      'full_sequence'::TEXT as analysis_type,
      ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC) as path_rank,
      portfolio_sequence,
      COUNT(*)::INT as converter_count,
      ROUND((COUNT(*)::NUMERIC / total_converters * 100), 2) as pct_of_converters,
      total_converters as total_converters_analyzed
    FROM user_sequences
    GROUP BY portfolio_sequence
    ORDER BY COUNT(*) DESC
    LIMIT 5
  )

  -- Combine all three analyses
  SELECT * FROM top_viewed_portfolios
  UNION ALL
  SELECT * FROM portfolio_combinations
  UNION ALL
  SELECT * FROM full_sequences
  ORDER BY
    CASE analysis_type
      WHEN 'top_portfolios_viewed' THEN 1
      WHEN 'portfolio_combinations' THEN 2
      WHEN 'full_sequence' THEN 3
    END,
    path_rank;
END;
$$;

COMMENT ON FUNCTION analyze_portfolio_copy_paths IS
'Analyzes portfolio viewing patterns before first copy.
Returns 3 analysis types with top 5 results each:
- top_portfolios_viewed: Most viewed portfolios (by total view count)
- portfolio_combinations: Most common portfolio pairs viewed together
- full_sequence: Most common complete paths (last 5 portfolios in order)
Called by analyze-portfolio-sequences edge function.';

-- ===========================================
-- 2. Update Creator Copy Path Analysis
-- ===========================================

CREATE OR REPLACE FUNCTION analyze_creator_copy_paths()
RETURNS TABLE(
  analysis_type TEXT,
  path_rank INT,
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
  -- Get total converter count for percentage calculations
  SELECT COUNT(DISTINCT user_id) INTO total_converters
  FROM user_first_copies;

  RETURN QUERY
  WITH all_converters AS (
    -- Get ALL users who copied (no limit)
    SELECT user_id, first_copy_time
    FROM user_first_copies
  ),

  ordered_views AS (
    -- Get all pre-copy creator views
    SELECT
      cs.user_id,
      cs.creator_username,
      cs.event_time,
      ROW_NUMBER() OVER (PARTITION BY cs.user_id ORDER BY cs.event_time ASC) as position_from_start,
      ROW_NUMBER() OVER (PARTITION BY cs.user_id ORDER BY cs.event_time DESC) as position_from_end
    FROM creator_sequences_raw cs
    INNER JOIN all_converters ac ON cs.user_id = ac.user_id
    WHERE cs.event_time < ac.first_copy_time
      AND cs.creator_username IS NOT NULL
  ),

  -- NEW: Top 5 most viewed creators (total view counts)
  top_viewed_creators AS (
    SELECT
      'top_creators_viewed'::TEXT as analysis_type,
      ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC) as path_rank,
      ARRAY[creator_username] as creator_sequence,
      COUNT(DISTINCT user_id)::INT as converter_count,
      ROUND((COUNT(DISTINCT user_id)::NUMERIC / total_converters * 100), 2) as pct_of_converters,
      total_converters as total_converters_analyzed
    FROM ordered_views
    GROUP BY creator_username
    ORDER BY COUNT(*) DESC
    LIMIT 5
  ),

  -- KEEP: Creator combinations (pairs viewed together)
  creator_pairs AS (
    SELECT
      user_id,
      creator_username as creator1,
      LEAD(creator_username) OVER (PARTITION BY user_id ORDER BY event_time) as creator2
    FROM ordered_views
  ),

  creator_combinations AS (
    SELECT
      'creator_combinations'::TEXT as analysis_type,
      ROW_NUMBER() OVER (ORDER BY COUNT(DISTINCT user_id) DESC) as path_rank,
      ARRAY[creator1, creator2] as creator_sequence,
      COUNT(DISTINCT user_id)::INT as converter_count,
      ROUND((COUNT(DISTINCT user_id)::NUMERIC / total_converters * 100), 2) as pct_of_converters,
      total_converters as total_converters_analyzed
    FROM creator_pairs
    WHERE creator2 IS NOT NULL
      AND creator1 != creator2  -- Exclude consecutive views of same creator
    GROUP BY creator1, creator2
    ORDER BY COUNT(DISTINCT user_id) DESC
    LIMIT 5
  ),

  -- KEEP: Top 5 complete sequences (last 5 creators before copy, preserving order)
  user_sequences AS (
    SELECT
      user_id,
      ARRAY_AGG(creator_username ORDER BY event_time ASC) as creator_sequence
    FROM (
      SELECT
        user_id,
        creator_username,
        event_time
      FROM ordered_views
      WHERE position_from_end <= 5  -- Last 5 creators before copy
    ) last_five
    GROUP BY user_id
  ),

  full_sequences AS (
    SELECT
      'full_sequence'::TEXT as analysis_type,
      ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC) as path_rank,
      creator_sequence,
      COUNT(*)::INT as converter_count,
      ROUND((COUNT(*)::NUMERIC / total_converters * 100), 2) as pct_of_converters,
      total_converters as total_converters_analyzed
    FROM user_sequences
    GROUP BY creator_sequence
    ORDER BY COUNT(*) DESC
    LIMIT 5
  )

  -- Combine all three analyses
  SELECT * FROM top_viewed_creators
  UNION ALL
  SELECT * FROM creator_combinations
  UNION ALL
  SELECT * FROM full_sequences
  ORDER BY
    CASE analysis_type
      WHEN 'top_creators_viewed' THEN 1
      WHEN 'creator_combinations' THEN 2
      WHEN 'full_sequence' THEN 3
    END,
    path_rank;
END;
$$;

COMMENT ON FUNCTION analyze_creator_copy_paths IS
'Analyzes creator viewing patterns before first copy.
Returns 3 analysis types with top 5 results each:
- top_creators_viewed: Most viewed creators (by total view count)
- creator_combinations: Most common creator pairs viewed together
- full_sequence: Most common complete paths (last 5 creators in order)
Called by analyze-creator-sequences edge function.';

-- ===========================================
-- 3. Log Migration
-- ===========================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Updated copy path analysis functions';
  RAISE NOTICE '   - Replaced first_portfolio → top_portfolios_viewed (most viewed by total count)';
  RAISE NOTICE '   - Replaced first_creator → top_creators_viewed (most viewed by total count)';
  RAISE NOTICE '   - Removed last_portfolio and last_creator (not used)';
  RAISE NOTICE '   - Kept portfolio_combinations and creator_combinations';
  RAISE NOTICE '   - Kept full_sequence analysis unchanged';
  RAISE NOTICE '';
END $$;
