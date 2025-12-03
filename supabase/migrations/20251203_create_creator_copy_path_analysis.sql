-- Migration: Create creator copy path analysis (mirror of portfolio analysis)
-- Created: 2025-12-03
-- Purpose: Analyze creator profile viewing patterns before first copy
--
-- This mirrors the portfolio_copy_path_analysis but for creator sequences

-- Create table to store creator copy path analysis results
CREATE TABLE IF NOT EXISTS creator_copy_path_analysis (
  id BIGSERIAL PRIMARY KEY,
  analysis_type TEXT NOT NULL,
  path_rank INT NOT NULL,
  creator_sequence TEXT[] NOT NULL,
  converter_count INT NOT NULL,
  pct_of_converters NUMERIC NOT NULL,
  total_converters_analyzed INT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_creator_copy_path_analysis_type ON creator_copy_path_analysis(analysis_type);
CREATE INDEX idx_creator_copy_path_analysis_rank ON creator_copy_path_analysis(path_rank);

COMMENT ON TABLE creator_copy_path_analysis IS
'Stores pre-computed creator copy path analysis results.
Shows most common creator viewing patterns before first copy.
Refreshed by analyze-creator-sequences edge function.';

GRANT SELECT ON creator_copy_path_analysis TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON creator_copy_path_analysis TO service_role;

-- Create SQL function to analyze creator copy paths
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
    -- Get all pre-copy creator views with position markers
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

  -- Top 5 first creators (entry points)
  first_creators AS (
    SELECT
      'first_creator'::TEXT as analysis_type,
      ROW_NUMBER() OVER (ORDER BY COUNT(DISTINCT user_id) DESC)::INT as path_rank,
      ARRAY[creator_username] as creator_sequence,
      COUNT(DISTINCT user_id)::INT as converter_count,
      ROUND((COUNT(DISTINCT user_id)::NUMERIC / total_converters * 100), 2) as pct_of_converters,
      total_converters as total_converters_analyzed
    FROM ordered_views
    WHERE position_from_start = 1
    GROUP BY creator_username
    ORDER BY COUNT(DISTINCT user_id) DESC
    LIMIT 5
  ),

  -- Deduplicate consecutive creator views while preserving order
  deduped_views AS (
    SELECT
      user_id,
      creator_username,
      event_time,
      position_from_end,
      -- Mark rows where creator changes from previous row (or is first row for user)
      CASE
        WHEN LAG(creator_username) OVER (PARTITION BY user_id ORDER BY event_time ASC) IS DISTINCT FROM creator_username
        THEN 1
        ELSE 0
      END as is_new_creator
    FROM ordered_views
    WHERE position_from_end <= 5  -- Last 5 creators before copy
  ),

  -- Get ordered sequences (for full_sequence analysis)
  user_sequences AS (
    SELECT
      user_id,
      ARRAY_AGG(creator_username ORDER BY event_time ASC) as creator_sequence
    FROM deduped_views
    WHERE is_new_creator = 1  -- Only include rows where creator changed
    GROUP BY user_id
    HAVING COUNT(DISTINCT creator_username) >= 2  -- Filter: must have 2+ unique creators
  ),

  -- Top 5 creator combinations (unordered unique sets)
  creator_combinations AS (
    SELECT
      'creator_combinations'::TEXT as analysis_type,
      ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC)::INT as path_rank,
      -- Sort array alphabetically to make order-independent
      (SELECT ARRAY_AGG(x ORDER BY x) FROM UNNEST(us.creator_sequence) x) as creator_set,
      COUNT(*)::INT as converter_count,
      ROUND((COUNT(*)::NUMERIC / total_converters * 100), 2) as pct_of_converters,
      total_converters as total_converters_analyzed
    FROM user_sequences us
    GROUP BY creator_set
    ORDER BY COUNT(*) DESC
    LIMIT 5
  ),

  -- Top 5 complete sequences (ordered paths, preserving order)
  full_sequences AS (
    SELECT
      'full_sequence'::TEXT as analysis_type,
      ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC)::INT as path_rank,
      us.creator_sequence,
      COUNT(*)::INT as converter_count,
      ROUND((COUNT(*)::NUMERIC / total_converters * 100), 2) as pct_of_converters,
      total_converters as total_converters_analyzed
    FROM user_sequences us
    GROUP BY us.creator_sequence
    ORDER BY COUNT(*) DESC
    LIMIT 5
  ),

  -- Combine all three analyses
  combined AS (
    SELECT
      fc.analysis_type,
      fc.path_rank,
      fc.creator_sequence,
      fc.converter_count,
      fc.pct_of_converters,
      fc.total_converters_analyzed
    FROM first_creators fc
    UNION ALL
    SELECT
      cc.analysis_type,
      cc.path_rank,
      cc.creator_set as creator_sequence,
      cc.converter_count,
      cc.pct_of_converters,
      cc.total_converters_analyzed
    FROM creator_combinations cc
    UNION ALL
    SELECT
      fs.analysis_type,
      fs.path_rank,
      fs.creator_sequence,
      fs.converter_count,
      fs.pct_of_converters,
      fs.total_converters_analyzed
    FROM full_sequences fs
  )
  SELECT
    c.analysis_type,
    c.path_rank,
    c.creator_sequence,
    c.converter_count,
    c.pct_of_converters,
    c.total_converters_analyzed
  FROM combined c
  ORDER BY
    CASE c.analysis_type
      WHEN 'first_creator' THEN 1
      WHEN 'creator_combinations' THEN 2
      WHEN 'full_sequence' THEN 3
    END,
    c.path_rank;
END;
$$;

COMMENT ON FUNCTION analyze_creator_copy_paths IS
'Analyzes creator profile viewing patterns before first copy.
Returns 3 analysis types with top 5 results each:
- first_creator: Most common entry creators (1st viewed)
- creator_combinations: Most common unique creator sets (unordered)
- full_sequence: Most common complete paths (ordered, deduped consecutive views, 2+ unique creators)
Called by analyze-creator-sequences edge function.';

-- =======================
-- Log Migration
-- =======================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Created creator_copy_path_analysis table and function';
  RAISE NOTICE '   - Mirrors portfolio_copy_path_analysis for creator sequences';
  RAISE NOTICE '   - Shows most common creator viewing patterns before copy';
  RAISE NOTICE '';
END $$;
