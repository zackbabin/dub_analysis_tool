-- Migration: Fix final ambiguous column references in analyze_portfolio_copy_paths
-- Created: 2025-12-02
-- Purpose: Wrap final UNION ALL in a CTE to avoid ambiguity in ORDER BY
-- Error: column reference "analysis_type" is ambiguous

DROP FUNCTION IF EXISTS analyze_portfolio_copy_paths();

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
    -- Get all pre-copy portfolio views with position markers
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

  -- Top 5 first portfolios (entry points)
  first_portfolios AS (
    SELECT
      'first_portfolio'::TEXT as analysis_type,
      ROW_NUMBER() OVER (ORDER BY COUNT(DISTINCT user_id) DESC) as path_rank,
      ARRAY[portfolio_ticker] as portfolio_sequence,
      COUNT(DISTINCT user_id)::INT as converter_count,
      ROUND((COUNT(DISTINCT user_id)::NUMERIC / total_converters * 100), 2) as pct_of_converters,
      total_converters as total_converters_analyzed
    FROM ordered_views
    WHERE position_from_start = 1
    GROUP BY portfolio_ticker
    ORDER BY COUNT(DISTINCT user_id) DESC
    LIMIT 5
  ),

  -- Top 5 last portfolios (final touchpoints before copy)
  last_portfolios AS (
    SELECT
      'last_portfolio'::TEXT as analysis_type,
      ROW_NUMBER() OVER (ORDER BY COUNT(DISTINCT user_id) DESC) as path_rank,
      ARRAY[portfolio_ticker] as portfolio_sequence,
      COUNT(DISTINCT user_id)::INT as converter_count,
      ROUND((COUNT(DISTINCT user_id)::NUMERIC / total_converters * 100), 2) as pct_of_converters,
      total_converters as total_converters_analyzed
    FROM ordered_views
    WHERE position_from_end = 1
    GROUP BY portfolio_ticker
    ORDER BY COUNT(DISTINCT user_id) DESC
    LIMIT 5
  ),

  -- Top 5 complete sequences (last 5 portfolios before copy, preserving order)
  user_sequences AS (
    SELECT
      user_id,
      ARRAY_AGG(portfolio_ticker ORDER BY event_time ASC) as user_portfolio_sequence
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
      us.user_portfolio_sequence as portfolio_sequence,
      COUNT(*)::INT as converter_count,
      ROUND((COUNT(*)::NUMERIC / total_converters * 100), 2) as pct_of_converters,
      total_converters as total_converters_analyzed
    FROM user_sequences us
    GROUP BY us.user_portfolio_sequence
    ORDER BY COUNT(*) DESC
    LIMIT 5
  ),

  -- Combine all three analyses
  all_results AS (
    SELECT * FROM first_portfolios
    UNION ALL
    SELECT * FROM last_portfolios
    UNION ALL
    SELECT * FROM full_sequences
  )

  -- Final SELECT with explicit column names to avoid ambiguity
  SELECT
    all_results.analysis_type,
    all_results.path_rank,
    all_results.portfolio_sequence,
    all_results.converter_count,
    all_results.pct_of_converters,
    all_results.total_converters_analyzed
  FROM all_results
  ORDER BY
    CASE all_results.analysis_type
      WHEN 'first_portfolio' THEN 1
      WHEN 'last_portfolio' THEN 2
      WHEN 'full_sequence' THEN 3
    END,
    all_results.path_rank;
END;
$$;

COMMENT ON FUNCTION analyze_portfolio_copy_paths IS
'Analyzes ordered portfolio viewing patterns before first copy.
Returns 3 analysis types with top 5 results each:
- first_portfolio: Most common entry portfolios (1st viewed)
- last_portfolio: Most common final portfolios (last before copy)
- full_sequence: Most common complete paths (last 5 portfolios in order)
Called by analyze-portfolio-sequences edge function.';

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Fixed ambiguous column references in analyze_portfolio_copy_paths';
  RAISE NOTICE '   - Wrapped UNION ALL in all_results CTE';
  RAISE NOTICE '   - Qualified all columns in final SELECT and ORDER BY';
  RAISE NOTICE '';
END $$;
