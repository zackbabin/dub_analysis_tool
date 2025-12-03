-- Migration: Replace last_portfolios with portfolio_combinations analysis
-- Created: 2025-12-03
-- Purpose: Replace "Final Portfolios" with "Portfolio Combinations" to show
--          which unique sets of portfolios users view together before copying
--
-- This replaces the less actionable "last portfolio before copy" analysis with
-- a more valuable "which portfolios are viewed together" analysis, similar to
-- what the old analyze-copy-patterns logistic regression was trying to find.

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
      ROW_NUMBER() OVER (ORDER BY COUNT(DISTINCT user_id) DESC)::INT as path_rank,
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

  -- Deduplicate consecutive portfolio views while preserving order
  deduped_views AS (
    SELECT
      user_id,
      portfolio_ticker,
      event_time,
      position_from_end,
      -- Mark rows where portfolio changes from previous row (or is first row for user)
      CASE
        WHEN LAG(portfolio_ticker) OVER (PARTITION BY user_id ORDER BY event_time ASC) IS DISTINCT FROM portfolio_ticker
        THEN 1
        ELSE 0
      END as is_new_portfolio
    FROM ordered_views
    WHERE position_from_end <= 5  -- Last 5 portfolios before copy
  ),

  -- Get ordered sequences (for full_sequence analysis)
  user_sequences AS (
    SELECT
      user_id,
      ARRAY_AGG(portfolio_ticker ORDER BY event_time ASC) as portfolio_sequence
    FROM deduped_views
    WHERE is_new_portfolio = 1  -- Only include rows where portfolio changed
    GROUP BY user_id
    HAVING COUNT(DISTINCT portfolio_ticker) >= 2  -- Filter: must have 2+ unique portfolios
  ),

  -- Top 5 portfolio combinations (unordered unique sets)
  portfolio_combinations AS (
    SELECT
      'portfolio_combinations'::TEXT as analysis_type,
      ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC)::INT as path_rank,
      -- Sort array alphabetically to make order-independent (e.g., [$BTC, $PELOSI] same as [$PELOSI, $BTC])
      (SELECT ARRAY_AGG(x ORDER BY x) FROM UNNEST(us.portfolio_sequence) x) as portfolio_set,
      COUNT(*)::INT as converter_count,
      ROUND((COUNT(*)::NUMERIC / total_converters * 100), 2) as pct_of_converters,
      total_converters as total_converters_analyzed
    FROM user_sequences us
    GROUP BY portfolio_set
    ORDER BY COUNT(*) DESC
    LIMIT 5
  ),

  -- Top 5 complete sequences (ordered paths, preserving order)
  full_sequences AS (
    SELECT
      'full_sequence'::TEXT as analysis_type,
      ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC)::INT as path_rank,
      us.portfolio_sequence,
      COUNT(*)::INT as converter_count,
      ROUND((COUNT(*)::NUMERIC / total_converters * 100), 2) as pct_of_converters,
      total_converters as total_converters_analyzed
    FROM user_sequences us
    GROUP BY us.portfolio_sequence
    ORDER BY COUNT(*) DESC
    LIMIT 5
  ),

  -- Combine all three analyses
  combined AS (
    SELECT
      fp.analysis_type,
      fp.path_rank,
      fp.portfolio_sequence,
      fp.converter_count,
      fp.pct_of_converters,
      fp.total_converters_analyzed
    FROM first_portfolios fp
    UNION ALL
    SELECT
      pc.analysis_type,
      pc.path_rank,
      pc.portfolio_set as portfolio_sequence,
      pc.converter_count,
      pc.pct_of_converters,
      pc.total_converters_analyzed
    FROM portfolio_combinations pc
    UNION ALL
    SELECT
      fs.analysis_type,
      fs.path_rank,
      fs.portfolio_sequence,
      fs.converter_count,
      fs.pct_of_converters,
      fs.total_converters_analyzed
    FROM full_sequences fs
  )
  SELECT
    c.analysis_type,
    c.path_rank,
    c.portfolio_sequence,
    c.converter_count,
    c.pct_of_converters,
    c.total_converters_analyzed
  FROM combined c
  ORDER BY
    CASE c.analysis_type
      WHEN 'first_portfolio' THEN 1
      WHEN 'portfolio_combinations' THEN 2
      WHEN 'full_sequence' THEN 3
    END,
    c.path_rank;
END;
$$;

COMMENT ON FUNCTION analyze_portfolio_copy_paths IS
'Analyzes portfolio viewing patterns before first copy.
Returns 3 analysis types with top 5 results each:
- first_portfolio: Most common entry portfolios (1st viewed)
- portfolio_combinations: Most common unique portfolio sets (unordered)
- full_sequence: Most common complete paths (ordered, deduped consecutive views, 2+ unique portfolios)
Called by analyze-portfolio-sequences edge function.';

-- =======================
-- Log Migration
-- =======================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Replaced last_portfolios with portfolio_combinations';
  RAISE NOTICE '   - Shows which unique sets of portfolios users view together before copying';
  RAISE NOTICE '   - More actionable than "last portfolio" analysis';
  RAISE NOTICE '   - Replaces old analyze-copy-patterns logistic regression with simpler approach';
  RAISE NOTICE '';
END $$;
