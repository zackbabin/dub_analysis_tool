-- Migration: Create portfolio copy path analysis function and storage table
-- Created: 2025-12-02
-- Purpose: Analyze ordered sequences of portfolio views before first copy
--
-- Returns 3 analysis types:
-- 1. first_portfolio: Top 5 portfolios viewed first (entry points)
-- 2. last_portfolio: Top 5 portfolios viewed last before copy (final touchpoints)
-- 3. full_sequence: Top 5 complete ordered paths (last 5 portfolios before copy)

-- =======================
-- 1. Create Storage Table
-- =======================

CREATE TABLE IF NOT EXISTS portfolio_copy_path_analysis (
  id SERIAL PRIMARY KEY,
  analysis_type TEXT NOT NULL,           -- 'first_portfolio', 'last_portfolio', 'full_sequence'
  path_rank INT NOT NULL,                 -- 1-5
  portfolio_sequence TEXT[] NOT NULL,     -- Array of portfolio tickers (single for first/last, multiple for full_sequence)
  converter_count INT NOT NULL,           -- Number of converters matching this pattern
  pct_of_converters NUMERIC(5,2) NOT NULL, -- Percentage of total converters analyzed
  total_converters_analyzed INT NOT NULL, -- Total converters in analysis (for context)
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(analysis_type, path_rank)
);

CREATE INDEX idx_portfolio_copy_path_analysis_type ON portfolio_copy_path_analysis(analysis_type);

COMMENT ON TABLE portfolio_copy_path_analysis IS
'Stores top portfolio viewing patterns before first copy.
Populated by analyze_portfolio_copy_paths() function via analyze-portfolio-sequences edge function.';

GRANT SELECT ON portfolio_copy_path_analysis TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON portfolio_copy_path_analysis TO service_role;
GRANT USAGE ON SEQUENCE portfolio_copy_path_analysis_id_seq TO service_role;

-- =======================
-- 2. Create Analysis Function
-- =======================

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
  SELECT * FROM first_portfolios
  UNION ALL
  SELECT * FROM last_portfolios
  UNION ALL
  SELECT * FROM full_sequences
  ORDER BY
    CASE analysis_type
      WHEN 'first_portfolio' THEN 1
      WHEN 'last_portfolio' THEN 2
      WHEN 'full_sequence' THEN 3
    END,
    path_rank;
END;
$$;

COMMENT ON FUNCTION analyze_portfolio_copy_paths IS
'Analyzes ordered portfolio viewing patterns before first copy.
Returns 3 analysis types with top 5 results each:
- first_portfolio: Most common entry portfolios (1st viewed)
- last_portfolio: Most common final portfolios (last before copy)
- full_sequence: Most common complete paths (last 5 portfolios in order)
Called by analyze-portfolio-sequences edge function.';

-- =======================
-- 3. Log Migration
-- =======================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Created portfolio copy path analysis';
  RAISE NOTICE '   - Table: portfolio_copy_path_analysis';
  RAISE NOTICE '   - Function: analyze_portfolio_copy_paths()';
  RAISE NOTICE '   - Returns 15 rows (3 analysis types × top 5 each)';
  RAISE NOTICE '   - Preserves exact chronological order of portfolio views';
  RAISE NOTICE '';
END $$;
