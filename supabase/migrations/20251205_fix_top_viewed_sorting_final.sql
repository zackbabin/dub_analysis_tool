-- Migration: Fix Top Viewed sorting to properly order by percentage DESC
-- Created: 2025-12-05
-- Purpose: Ensure ROW_NUMBER() matches the actual sort order for top_portfolios_viewed and top_creators_viewed

-- ===========================================
-- 1. Fix Portfolio Copy Path Analysis - Top Viewed Sorting
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
    -- Get users who copied and have both KYC approved and first copy times
    SELECT user_id, kyc_approved_time, first_copy_time
    FROM user_first_copies
    WHERE kyc_approved_time IS NOT NULL
      AND first_copy_time IS NOT NULL
  ),

  ordered_views AS (
    -- Get portfolio views BETWEEN kyc_approved_time and first_copy_time for each user
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

  -- Aggregate portfolio stats first, then assign row numbers
  portfolio_stats AS (
    SELECT
      portfolio_ticker,
      COUNT(DISTINCT user_id)::INT as converter_count,
      ROUND((COUNT(DISTINCT user_id)::NUMERIC / total_converters * 100), 2) as pct_of_converters
    FROM ordered_views
    GROUP BY portfolio_ticker
  ),

  -- Top 10 most viewed portfolios (sorted by percentage of converters)
  top_viewed_portfolios AS (
    SELECT
      'top_portfolios_viewed'::TEXT as analysis_type,
      ROW_NUMBER() OVER (ORDER BY pct_of_converters DESC, converter_count DESC) as path_rank,
      ARRAY[portfolio_ticker] as portfolio_sequence,
      converter_count,
      pct_of_converters,
      total_converters as total_converters_analyzed
    FROM portfolio_stats
    ORDER BY pct_of_converters DESC, converter_count DESC
    LIMIT 10
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

  -- Keep existing: Top 10 complete sequences (last 5 portfolios before copy, preserving order)
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
      us.portfolio_sequence,
      COUNT(*)::INT as converter_count,
      ROUND((COUNT(*)::NUMERIC / total_converters * 100), 2) as pct_of_converters,
      total_converters as total_converters_analyzed
    FROM user_sequences us
    GROUP BY us.portfolio_sequence
    ORDER BY COUNT(*) DESC
    LIMIT 10
  ),

  -- Combine all three analyses
  combined_results AS (
    SELECT
      tvp.analysis_type,
      tvp.path_rank,
      tvp.portfolio_sequence,
      tvp.converter_count,
      tvp.pct_of_converters,
      tvp.total_converters_analyzed
    FROM top_viewed_portfolios tvp
    UNION ALL
    SELECT
      pc.analysis_type,
      pc.path_rank,
      pc.portfolio_sequence,
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
-- 2. Fix Creator Copy Path Analysis - Top Viewed Sorting
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
    -- Get users who copied and have both KYC approved and first copy times
    SELECT user_id, kyc_approved_time, first_copy_time
    FROM user_first_copies
    WHERE kyc_approved_time IS NOT NULL
      AND first_copy_time IS NOT NULL
  ),

  ordered_views AS (
    -- Get creator views BETWEEN kyc_approved_time and first_copy_time for each user
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

  -- Aggregate creator stats first, then assign row numbers
  creator_stats AS (
    SELECT
      creator_username,
      COUNT(DISTINCT user_id)::INT as converter_count,
      ROUND((COUNT(DISTINCT user_id)::NUMERIC / total_converters * 100), 2) as pct_of_converters
    FROM ordered_views
    GROUP BY creator_username
  ),

  -- Top 10 most viewed creators (sorted by percentage of converters)
  top_viewed_creators AS (
    SELECT
      'top_creators_viewed'::TEXT as analysis_type,
      ROW_NUMBER() OVER (ORDER BY pct_of_converters DESC, converter_count DESC) as path_rank,
      ARRAY[creator_username] as creator_sequence,
      converter_count,
      pct_of_converters,
      total_converters as total_converters_analyzed
    FROM creator_stats
    ORDER BY pct_of_converters DESC, converter_count DESC
    LIMIT 10
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

  -- Keep existing: Top 10 complete sequences (last 5 creators before copy, preserving order)
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
      us.creator_sequence,
      COUNT(*)::INT as converter_count,
      ROUND((COUNT(*)::NUMERIC / total_converters * 100), 2) as pct_of_converters,
      total_converters as total_converters_analyzed
    FROM user_sequences us
    GROUP BY us.creator_sequence
    ORDER BY COUNT(*) DESC
    LIMIT 10
  ),

  -- Combine all three analyses
  combined_results AS (
    SELECT
      tvc.analysis_type,
      tvc.path_rank,
      tvc.creator_sequence,
      tvc.converter_count,
      tvc.pct_of_converters,
      tvc.total_converters_analyzed
    FROM top_viewed_creators tvc
    UNION ALL
    SELECT
      cc.analysis_type,
      cc.path_rank,
      cc.creator_sequence,
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
  RAISE NOTICE '✅ Fixed top viewed sorting to properly order by percentage DESC';
  RAISE NOTICE '   - Separated aggregation (portfolio_stats/creator_stats) from row numbering';
  RAISE NOTICE '   - ROW_NUMBER() now calculated after GROUP BY aggregation completes';
  RAISE NOTICE '   - Added secondary sort by converter_count DESC for tie-breaking';
  RAISE NOTICE '';
END $$;
