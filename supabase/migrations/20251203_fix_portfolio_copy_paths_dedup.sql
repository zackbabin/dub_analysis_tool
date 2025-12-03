-- Migration: Fix portfolio copy path analysis to deduplicate consecutive views
-- Created: 2025-12-03
-- Purpose: Fix data quality issue where sequences like [$PELOSI, $PELOSI] appear in top 5
--
-- Changes:
-- 1. Deduplicate consecutive views (e.g., $PELOSI → $PELOSI → $BTC becomes $PELOSI → $BTC)
-- 2. Filter to sequences with 2+ unique portfolios (exclude single-portfolio journeys)
-- 3. Preserve chronological order of unique portfolio views

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

  -- Top 5 complete sequences (last 5 UNIQUE portfolios before copy, preserving order)
  user_sequences AS (
    SELECT
      user_id,
      ARRAY_AGG(portfolio_ticker ORDER BY event_time ASC) as portfolio_sequence
    FROM deduped_views
    WHERE is_new_portfolio = 1  -- Only include rows where portfolio changed
    GROUP BY user_id
    HAVING COUNT(DISTINCT portfolio_ticker) >= 2  -- Filter: must have 2+ unique portfolios
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
    LIMIT 5
  )

  -- Combine all three analyses
  WITH combined AS (
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
      lp.analysis_type,
      lp.path_rank,
      lp.portfolio_sequence,
      lp.converter_count,
      lp.pct_of_converters,
      lp.total_converters_analyzed
    FROM last_portfolios lp
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
      WHEN 'last_portfolio' THEN 2
      WHEN 'full_sequence' THEN 3
    END,
    c.path_rank;
END;
$$;

COMMENT ON FUNCTION analyze_portfolio_copy_paths IS
'Analyzes ordered portfolio viewing patterns before first copy.
Returns 3 analysis types with top 5 results each:
- first_portfolio: Most common entry portfolios (1st viewed)
- last_portfolio: Most common final portfolios (last before copy)
- full_sequence: Most common complete paths (deduped consecutive views, 2+ unique portfolios)
Called by analyze-portfolio-sequences edge function.';

-- =======================
-- Log Migration
-- =======================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Fixed portfolio copy path analysis';
  RAISE NOTICE '   - Deduplicates consecutive portfolio views (e.g., $PELOSI → $PELOSI → $BTC becomes $PELOSI → $BTC)';
  RAISE NOTICE '   - Filters to sequences with 2+ unique portfolios';
  RAISE NOTICE '   - Preserves chronological order of unique views';
  RAISE NOTICE '';
END $$;
