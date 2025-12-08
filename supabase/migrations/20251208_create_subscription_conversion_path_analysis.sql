-- Migration: Create subscription conversion path analysis tables
-- Created: 2025-12-08
-- Purpose: Analyze creator and portfolio viewing patterns before first subscription
--          Mirrors copy path analysis but for subscription conversion

-- ============================================================================
-- CREATOR SUBSCRIPTION PATH ANALYSIS
-- ============================================================================

CREATE TABLE IF NOT EXISTS creator_subscription_path_analysis (
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

CREATE INDEX idx_creator_subscription_path_analysis_type ON creator_subscription_path_analysis(analysis_type);
CREATE INDEX idx_creator_subscription_path_analysis_rank ON creator_subscription_path_analysis(path_rank);

COMMENT ON TABLE creator_subscription_path_analysis IS
'Stores pre-computed creator subscription path analysis results.
Shows most common creator viewing patterns before first subscription.
Refreshed by analyze-subscription-sequences edge function.';

GRANT SELECT ON creator_subscription_path_analysis TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON creator_subscription_path_analysis TO service_role;

-- ============================================================================
-- PORTFOLIO SUBSCRIPTION PATH ANALYSIS
-- ============================================================================

CREATE TABLE IF NOT EXISTS portfolio_subscription_path_analysis (
  id BIGSERIAL PRIMARY KEY,
  analysis_type TEXT NOT NULL,
  path_rank INT NOT NULL,
  portfolio_sequence TEXT[] NOT NULL,
  converter_count INT NOT NULL,
  pct_of_converters NUMERIC NOT NULL,
  total_converters_analyzed INT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_portfolio_subscription_path_analysis_type ON portfolio_subscription_path_analysis(analysis_type);
CREATE INDEX idx_portfolio_subscription_path_analysis_rank ON portfolio_subscription_path_analysis(path_rank);

COMMENT ON TABLE portfolio_subscription_path_analysis IS
'Stores pre-computed portfolio subscription path analysis results.
Shows most common portfolio viewing patterns before first subscription.
Refreshed by analyze-subscription-sequences edge function.';

GRANT SELECT ON portfolio_subscription_path_analysis TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON portfolio_subscription_path_analysis TO service_role;

-- ============================================================================
-- SQL FUNCTIONS FOR SUBSCRIPTION PATH ANALYSIS
-- ============================================================================

-- Analyze creator subscription paths
CREATE OR REPLACE FUNCTION analyze_creator_subscription_paths()
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
  FROM user_first_subscriptions;

  RETURN QUERY
  WITH all_converters AS (
    -- Get ALL users who subscribed (no limit)
    SELECT user_id, first_subscription_time
    FROM user_first_subscriptions
  ),

  ordered_views AS (
    -- Get all pre-subscription creator views with position markers
    SELECT
      cs.user_id,
      cs.creator_username,
      cs.event_time,
      ROW_NUMBER() OVER (PARTITION BY cs.user_id ORDER BY cs.event_time ASC) as position_from_start,
      ROW_NUMBER() OVER (PARTITION BY cs.user_id ORDER BY cs.event_time DESC) as position_from_end
    FROM creator_sequences_raw cs
    INNER JOIN all_converters ac ON cs.user_id = ac.user_id
    WHERE cs.event_time < ac.first_subscription_time
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
    WHERE position_from_end <= 5  -- Last 5 creators before subscription
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

COMMENT ON FUNCTION analyze_creator_subscription_paths IS
'Analyzes creator profile viewing patterns before first subscription.
Returns 3 analysis types with top 5 results each:
- first_creator: Most common entry creators (1st viewed)
- creator_combinations: Most common unique creator sets (unordered)
- full_sequence: Most common complete paths (ordered, deduped consecutive views, 2+ unique creators)
Called by analyze-subscription-sequences edge function.';

-- Analyze portfolio subscription paths
CREATE OR REPLACE FUNCTION analyze_portfolio_subscription_paths()
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
  FROM user_first_subscriptions;

  RETURN QUERY
  WITH all_converters AS (
    -- Get ALL users who subscribed (no limit)
    SELECT user_id, first_subscription_time
    FROM user_first_subscriptions
  ),

  ordered_views AS (
    -- Get all pre-subscription portfolio views with position markers
    SELECT
      ps.user_id,
      ps.portfolio_ticker,
      ps.event_time,
      ROW_NUMBER() OVER (PARTITION BY ps.user_id ORDER BY ps.event_time ASC) as position_from_start,
      ROW_NUMBER() OVER (PARTITION BY ps.user_id ORDER BY ps.event_time DESC) as position_from_end
    FROM portfolio_sequences_raw ps
    INNER JOIN all_converters ac ON ps.user_id = ac.user_id
    WHERE ps.event_time < ac.first_subscription_time
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
    WHERE position_from_end <= 5  -- Last 5 portfolios before subscription
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
      -- Sort array alphabetically to make order-independent
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

COMMENT ON FUNCTION analyze_portfolio_subscription_paths IS
'Analyzes portfolio viewing patterns before first subscription.
Returns 3 analysis types with top 5 results each:
- first_portfolio: Most common entry portfolios (1st viewed)
- portfolio_combinations: Most common unique portfolio sets (unordered)
- full_sequence: Most common complete paths (ordered, deduped consecutive views, 2+ unique portfolios)
Called by analyze-subscription-sequences edge function.';

-- =======================
-- Log Migration
-- =======================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Created subscription conversion path analysis tables and functions';
  RAISE NOTICE '   - creator_subscription_path_analysis table';
  RAISE NOTICE '   - portfolio_subscription_path_analysis table';
  RAISE NOTICE '   - analyze_creator_subscription_paths() function';
  RAISE NOTICE '   - analyze_portfolio_subscription_paths() function';
  RAISE NOTICE '   - Shows most common viewing patterns before first subscription';
  RAISE NOTICE '';
END $$;
