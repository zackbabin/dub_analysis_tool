-- Migration: Fix portfolio/creator combinations to show unique sets
-- Created: 2025-12-04
-- Purpose: Combinations should deduplicate items and sort for proper grouping
--
-- Problem: Getting "$BRETTSIMBA, $PELOSI", "$BRETTSIMBA, $BRETTSIMBA, $PELOSI" as separate rows
-- Solution: Use DISTINCT sorted arrays so all become "$BRETTSIMBA, $PELOSI"

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

  -- Top 5 most viewed portfolios (total view counts)
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

  -- Portfolio combinations: Get unique sorted sets of portfolios viewed by each user
  user_portfolio_sets AS (
    SELECT
      user_id,
      ARRAY_AGG(DISTINCT portfolio_ticker ORDER BY portfolio_ticker) as portfolio_set
    FROM ordered_views
    GROUP BY user_id
    HAVING COUNT(DISTINCT portfolio_ticker) >= 2  -- Only users who viewed 2+ different portfolios
  ),

  portfolio_combinations AS (
    SELECT
      'portfolio_combinations'::TEXT as analysis_type,
      ROW_NUMBER() OVER (ORDER BY COUNT(DISTINCT user_id) DESC) as path_rank,
      portfolio_set as portfolio_sequence,
      COUNT(DISTINCT user_id)::INT as converter_count,
      ROUND((COUNT(DISTINCT user_id)::NUMERIC / total_converters * 100), 2) as pct_of_converters,
      total_converters as total_converters_analyzed
    FROM user_portfolio_sets
    GROUP BY portfolio_set
    ORDER BY COUNT(DISTINCT user_id) DESC
    LIMIT 5
  ),

  -- Keep existing: Top 5 complete sequences (last 5 portfolios before copy, preserving order)
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
- portfolio_combinations: Unique sorted sets of portfolios viewed together (deduplicated)
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

  -- Top 5 most viewed creators (total view counts)
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

  -- Creator combinations: Get unique sorted sets of creators viewed by each user
  user_creator_sets AS (
    SELECT
      user_id,
      ARRAY_AGG(DISTINCT creator_username ORDER BY creator_username) as creator_set
    FROM ordered_views
    GROUP BY user_id
    HAVING COUNT(DISTINCT creator_username) >= 2  -- Only users who viewed 2+ different creators
  ),

  creator_combinations AS (
    SELECT
      'creator_combinations'::TEXT as analysis_type,
      ROW_NUMBER() OVER (ORDER BY COUNT(DISTINCT user_id) DESC) as path_rank,
      creator_set as creator_sequence,
      COUNT(DISTINCT user_id)::INT as converter_count,
      ROUND((COUNT(DISTINCT user_id)::NUMERIC / total_converters * 100), 2) as pct_of_converters,
      total_converters as total_converters_analyzed
    FROM user_creator_sets
    GROUP BY creator_set
    ORDER BY COUNT(DISTINCT user_id) DESC
    LIMIT 5
  ),

  -- Keep existing: Top 5 complete sequences (last 5 creators before copy, preserving order)
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
- creator_combinations: Unique sorted sets of creators viewed together (deduplicated)
- full_sequence: Most common complete paths (last 5 creators in order)
Called by analyze-creator-sequences edge function.';

-- ===========================================
-- 3. Clean up old data and log migration
-- ===========================================

-- Delete old portfolio combinations data (will be repopulated with deduplicated sets)
DELETE FROM portfolio_copy_path_analysis WHERE analysis_type = 'portfolio_combinations';

-- Delete old creator combinations data (will be repopulated with deduplicated sets)
DELETE FROM creator_copy_path_analysis WHERE analysis_type = 'creator_combinations';

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Fixed portfolio/creator combinations to use deduplicated sets';
  RAISE NOTICE '   - Combinations now use DISTINCT sorted arrays';
  RAISE NOTICE '   - Example: "$BRETTSIMBA, $PELOSI" and "$PELOSI, $BRETTSIMBA" → "$BRETTSIMBA, $PELOSI"';
  RAISE NOTICE '   - Removed duplicate entries like "$BRETTSIMBA, $BRETTSIMBA, $PELOSI"';
  RAISE NOTICE '   - Cleared old combination data - run edge functions to repopulate';
  RAISE NOTICE '';
END $$;
