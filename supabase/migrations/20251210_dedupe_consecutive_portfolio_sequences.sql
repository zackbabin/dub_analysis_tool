-- Migration: Deduplicate consecutive portfolio views in sequences
-- Created: 2025-12-10
-- Purpose: Remove consecutive duplicate portfolio views from sequences
--
-- Issue: Full sequences showing duplicates like "$PELOSI → $PELOSI → $PELOSI"
--        This happens when users view the same portfolio multiple times in a row
--
-- Solution: Use lag() to identify when portfolio changes, only aggregate distinct transitions
--           Example: [$PELOSI, $PELOSI, $AAPL, $PELOSI] → [$PELOSI, $AAPL, $PELOSI]

DROP FUNCTION IF EXISTS analyze_portfolio_copy_paths();

CREATE FUNCTION analyze_portfolio_copy_paths()
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
    -- Get all pre-copy portfolio events with position markers
    -- Include both "Viewed Portfolio Details" and "Tapped Portfolio Card"
    -- Append category name for tapped events (e.g., "AAPL(Top Performing)")
    SELECT
      ps.user_id,
      CASE
        WHEN ps.event_name = 'Tapped Portfolio Card' AND ps.category_name IS NOT NULL
          THEN ps.portfolio_ticker || '(' || ps.category_name || ')'
        ELSE ps.portfolio_ticker
      END as portfolio_display,
      ps.event_time,
      ROW_NUMBER() OVER (PARTITION BY ps.user_id ORDER BY ps.event_time DESC) as position_from_end
    FROM portfolio_sequences_raw ps
    INNER JOIN all_converters ac ON ps.user_id = ac.user_id
    WHERE ps.event_time < ac.first_copy_time
      AND ps.portfolio_ticker IS NOT NULL
      AND ps.event_name IN ('Viewed Portfolio Details', 'Tapped Portfolio Card')
  ),

  -- Top 10 most viewed portfolios (total view counts)
  top_viewed_portfolios AS (
    SELECT
      'top_portfolios_viewed'::TEXT as analysis_type,
      ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC)::INT as path_rank,
      ARRAY[portfolio_display] as portfolio_sequence,
      COUNT(DISTINCT user_id)::INT as converter_count,
      ROUND((COUNT(DISTINCT user_id)::NUMERIC / total_converters * 100), 2) as pct_of_converters,
      total_converters as total_converters_analyzed
    FROM ordered_views
    GROUP BY portfolio_display
    ORDER BY COUNT(*) DESC
    LIMIT 10
  ),

  -- Portfolio combinations: Get unique sorted sets of portfolios viewed by each user
  user_portfolio_sets AS (
    SELECT
      user_id,
      ARRAY_AGG(DISTINCT portfolio_display ORDER BY portfolio_display) as portfolio_set
    FROM ordered_views
    GROUP BY user_id
    HAVING COUNT(DISTINCT portfolio_display) >= 2  -- Only users who viewed 2+ different portfolios
  ),

  portfolio_combinations AS (
    SELECT
      'portfolio_combinations'::TEXT as analysis_type,
      ROW_NUMBER() OVER (ORDER BY COUNT(DISTINCT ups.user_id) DESC)::INT as path_rank,
      ups.portfolio_set as portfolio_sequence,
      COUNT(DISTINCT ups.user_id)::INT as converter_count,
      ROUND((COUNT(DISTINCT ups.user_id)::NUMERIC / total_converters * 100), 2) as pct_of_converters,
      total_converters as total_converters_analyzed
    FROM user_portfolio_sets ups
    GROUP BY ups.portfolio_set
    ORDER BY COUNT(DISTINCT ups.user_id) DESC
    LIMIT 10
  ),

  -- Deduplicate consecutive views: Only keep transitions between different portfolios
  deduped_views AS (
    SELECT
      user_id,
      portfolio_display,
      event_time,
      position_from_end,
      LAG(portfolio_display) OVER (PARTITION BY user_id ORDER BY event_time ASC) as prev_portfolio
    FROM ordered_views
    WHERE position_from_end <= 5  -- Last 5 portfolios before copy
  ),

  -- Filter to only transitions (where portfolio changes from previous)
  transitions_only AS (
    SELECT
      user_id,
      portfolio_display,
      event_time
    FROM deduped_views
    WHERE prev_portfolio IS NULL  -- First event for user
       OR portfolio_display != prev_portfolio  -- Portfolio changed
  ),

  -- Top 10 complete sequences (last 5 portfolios before copy, deduplicated)
  user_sequences AS (
    SELECT
      user_id,
      ARRAY_AGG(portfolio_display ORDER BY event_time ASC) as portfolio_sequence
    FROM transitions_only
    GROUP BY user_id
  ),

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

COMMENT ON FUNCTION analyze_portfolio_copy_paths IS
'Analyzes ordered portfolio viewing patterns before first copy.
Includes both "Viewed Portfolio Details" and "Tapped Portfolio Card" events.
Tapped events show actual category name (e.g., "AAPL(Top Performing)").
Consecutive duplicate views are removed (e.g., $PELOSI → $PELOSI → $AAPL becomes $PELOSI → $AAPL).
Returns 3 analysis types with top 10 results each:
- top_portfolios_viewed: Most viewed portfolios (by total view count)
- portfolio_combinations: Most common portfolio sets (unordered)
- full_sequence: Most common complete paths (last 5 unique transitions in order)
Matches creator path analysis pattern for consistency.
Called by analyze-portfolio-sequences edge function.';

-- Log migration
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Added deduplication for consecutive portfolio views';
  RAISE NOTICE '   - Uses LAG() to detect portfolio transitions';
  RAISE NOTICE '   - Only aggregates when portfolio changes';
  RAISE NOTICE '   - Example: [$PELOSI, $PELOSI, $AAPL] → [$PELOSI, $AAPL]';
  RAISE NOTICE '';
END $$;
