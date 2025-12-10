-- Migration: Update analyze_unified_copy_paths to include card tap events
-- Created: 2025-12-10
-- Purpose: Include "Tapped Portfolio Tile" and "Tapped Creator Card" events in unified analysis
--          Portfolio tiles: append "(category_name)" - e.g., "Portfolio: AAPL(Top Performing)"
--          Creator cards: append "(C)" - e.g., "Creator: @johndoe(C)"

-- Drop existing function first
DROP FUNCTION IF EXISTS analyze_unified_copy_paths();

CREATE FUNCTION analyze_unified_copy_paths()
RETURNS TABLE(
  analysis_type TEXT,
  path_rank INT,
  view_sequence TEXT[],
  converter_count INT,
  pct_of_converters NUMERIC,
  total_converters_analyzed INT
)
LANGUAGE plpgsql
AS $$
DECLARE
  total_converters INT;
BEGIN
  -- Get total converter count (only users with both timestamps and at least one view)
  SELECT COUNT(DISTINCT user_id) INTO total_converters
  FROM user_first_copies
  WHERE first_app_open_time IS NOT NULL
    AND first_copy_time IS NOT NULL;

  RETURN QUERY
  WITH all_converters AS (
    -- Get users who copied and have both first app open and first copy times
    SELECT user_id, first_app_open_time, first_copy_time
    FROM user_first_copies
    WHERE first_app_open_time IS NOT NULL
      AND first_copy_time IS NOT NULL
  ),

  -- UNION creator and portfolio views into one timeline
  unified_views AS (
    -- Creator views (both "Viewed Creator Profile" and "Tapped Creator Card")
    -- Append "(C)" to creator cards
    SELECT
      cs.user_id,
      CASE
        WHEN cs.event_name = 'Tapped Creator Card'
          THEN 'Creator: ' || cs.creator_username || '(C)'
        ELSE 'Creator: ' || cs.creator_username
      END as view_item,
      cs.event_time
    FROM creator_sequences_raw cs
    INNER JOIN all_converters ac ON cs.user_id = ac.user_id
    WHERE cs.event_time >= ac.first_app_open_time
      AND cs.event_time < ac.first_copy_time
      AND cs.creator_username IS NOT NULL
      AND cs.event_name IN ('Viewed Creator Profile', 'Tapped Creator Card')

    UNION ALL

    -- Portfolio views (both "Viewed Portfolio Details" and "Tapped Portfolio Tile")
    -- Append "(category_name)" to portfolio tiles
    SELECT
      ps.user_id,
      CASE
        WHEN ps.event_name = 'Tapped Portfolio Tile' AND ps.category_name IS NOT NULL
          THEN 'Portfolio: ' || ps.portfolio_ticker || '(' || ps.category_name || ')'
        ELSE 'Portfolio: ' || ps.portfolio_ticker
      END as view_item,
      ps.event_time
    FROM portfolio_sequences_raw ps
    INNER JOIN all_converters ac ON ps.user_id = ac.user_id
    WHERE ps.event_time >= ac.first_app_open_time
      AND ps.event_time < ac.first_copy_time
      AND ps.portfolio_ticker IS NOT NULL
      AND ps.event_name IN ('Viewed Portfolio Details', 'Tapped Portfolio Tile')
  ),

  -- Order by time and deduplicate consecutive identical views
  ordered_views AS (
    SELECT
      user_id,
      view_item,
      event_time,
      ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY event_time DESC) as position_from_end,
      -- Mark rows where view_item changes from previous (dedupe consecutive identical views)
      CASE
        WHEN LAG(view_item) OVER (PARTITION BY user_id ORDER BY event_time ASC) IS DISTINCT FROM view_item
        THEN 1
        ELSE 0
      END as is_new_view
    FROM unified_views
  ),

  -- Get deduplicated sequences (last 5 views before copy)
  deduped_sequences AS (
    SELECT
      user_id,
      view_item,
      event_time
    FROM ordered_views
    WHERE is_new_view = 1
      AND position_from_end <= 5  -- Last 5 views
  ),

  -- Mark first occurrence of each view_item per user (to deduplicate ALL occurrences)
  first_occurrences AS (
    SELECT
      user_id,
      view_item,
      event_time,
      ROW_NUMBER() OVER (PARTITION BY user_id, view_item ORDER BY event_time ASC) as occurrence_rank
    FROM deduped_sequences
  ),

  -- Build user sequences keeping only first occurrence of each item (chronologically ordered)
  user_sequences AS (
    SELECT
      user_id,
      ARRAY_AGG(view_item ORDER BY event_time ASC) as view_sequence
    FROM first_occurrences
    WHERE occurrence_rank = 1  -- Only first occurrence
    GROUP BY user_id
    HAVING COUNT(DISTINCT view_item) >= 2  -- Must have 2+ unique views
  ),

  -- Top 10 combinations (unordered sets)
  view_combinations AS (
    SELECT
      'combinations'::TEXT as analysis_type,
      ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC)::INT as path_rank,
      -- Sort array alphabetically for order-independent grouping
      (SELECT ARRAY_AGG(x ORDER BY x) FROM UNNEST(us.view_sequence) x) as view_set,
      COUNT(*)::INT as converter_count,
      ROUND((COUNT(*)::NUMERIC / total_converters * 100), 2) as pct_of_converters,
      total_converters as total_converters_analyzed
    FROM user_sequences us
    GROUP BY view_set
    ORDER BY COUNT(*) DESC
    LIMIT 10
  ),

  -- Top 10 ordered sequences
  ordered_sequences AS (
    SELECT
      'full_sequence'::TEXT as analysis_type,
      ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC)::INT as path_rank,
      us.view_sequence,
      COUNT(*)::INT as converter_count,
      ROUND((COUNT(*)::NUMERIC / total_converters * 100), 2) as pct_of_converters,
      total_converters as total_converters_analyzed
    FROM user_sequences us
    GROUP BY us.view_sequence
    ORDER BY COUNT(*) DESC
    LIMIT 10
  )

  -- Combine combinations and sequences
  SELECT * FROM view_combinations
  UNION ALL
  SELECT * FROM ordered_sequences;

END;
$$;

COMMENT ON FUNCTION analyze_unified_copy_paths IS
  'Analyzes combined creator + portfolio viewing sequences before first copy.
   Includes both profile views and card/tile taps:
   - Portfolio tiles show category: "Portfolio: AAPL(Top Performing)"
   - Creator cards show (C): "Creator: @johndoe(C)"
   - Profile/details views show plain: "Portfolio: AAPL" or "Creator: @johndoe"
   Uses first_app_open_time as start time for analysis window.
   Deduplicates ALL occurrences (keeps only first occurrence of each item).
   Returns top combinations (unordered sets) and full sequences (ordered paths).';

-- Log migration
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Updated analyze_unified_copy_paths to include card/tile tap events';
  RAISE NOTICE '   - Portfolio tiles: append actual category name';
  RAISE NOTICE '   - Creator cards: append "(C)" suffix';
  RAISE NOTICE '   - Examples:';
  RAISE NOTICE '     * "Portfolio: AAPL(Top Performing)" = Tapped tile from category';
  RAISE NOTICE '     * "Portfolio: AAPL" = Viewed portfolio details';
  RAISE NOTICE '     * "Creator: @johndoe(C)" = Tapped creator card';
  RAISE NOTICE '     * "Creator: @johndoe" = Viewed creator profile';
  RAISE NOTICE '';
END $$;
