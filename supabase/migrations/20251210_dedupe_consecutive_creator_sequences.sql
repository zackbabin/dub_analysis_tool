-- Migration: Deduplicate consecutive creator views in sequences
-- Created: 2025-12-10
-- Purpose: Remove consecutive duplicate creator views from sequences
--
-- Issue: Full sequences showing duplicates like "@user → @user → @user"
--        This happens when users view the same creator multiple times in a row
--
-- Solution: Use lag() to identify when creator changes, only aggregate distinct transitions
--           Example: [@user, @user, @other, @user] → [@user, @other, @user]

DROP FUNCTION IF EXISTS analyze_creator_copy_paths();

CREATE FUNCTION analyze_creator_copy_paths()
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
    -- Get all pre-copy creator events with position markers
    -- Include both "Viewed Creator Profile" and "Tapped Creator Card"
    -- Append "(C)" to card events for distinction
    SELECT
      cs.user_id,
      CASE
        WHEN cs.event_name = 'Tapped Creator Card' THEN cs.creator_username || '(C)'
        ELSE cs.creator_username
      END as creator_display,
      cs.event_time,
      ROW_NUMBER() OVER (PARTITION BY cs.user_id ORDER BY cs.event_time ASC) as position_from_start,
      ROW_NUMBER() OVER (PARTITION BY cs.user_id ORDER BY cs.event_time DESC) as position_from_end
    FROM creator_sequences_raw cs
    INNER JOIN all_converters ac ON cs.user_id = ac.user_id
    WHERE cs.event_time < ac.first_copy_time
      AND cs.creator_username IS NOT NULL
      AND cs.event_name IN ('Viewed Creator Profile', 'Tapped Creator Card')
  ),

  -- Top 10 most viewed creators (total view counts)
  top_viewed_creators AS (
    SELECT
      'top_creators_viewed'::TEXT as analysis_type,
      ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC)::INT as path_rank,
      ARRAY[creator_display] as creator_sequence,
      COUNT(DISTINCT user_id)::INT as converter_count,
      ROUND((COUNT(DISTINCT user_id)::NUMERIC / total_converters * 100), 2) as pct_of_converters,
      total_converters as total_converters_analyzed
    FROM ordered_views
    GROUP BY creator_display
    ORDER BY COUNT(*) DESC
    LIMIT 10
  ),

  -- Creator combinations: Get unique sorted sets of creators viewed by each user
  user_creator_sets AS (
    SELECT
      user_id,
      ARRAY_AGG(DISTINCT creator_display ORDER BY creator_display) as creator_set
    FROM ordered_views
    GROUP BY user_id
    HAVING COUNT(DISTINCT creator_display) >= 2  -- Only users who viewed 2+ different creators
  ),

  creator_combinations AS (
    SELECT
      'creator_combinations'::TEXT as analysis_type,
      ROW_NUMBER() OVER (ORDER BY COUNT(DISTINCT ucs.user_id) DESC)::INT as path_rank,
      ucs.creator_set as creator_sequence,
      COUNT(DISTINCT ucs.user_id)::INT as converter_count,
      ROUND((COUNT(DISTINCT ucs.user_id)::NUMERIC / total_converters * 100), 2) as pct_of_converters,
      total_converters as total_converters_analyzed
    FROM user_creator_sets ucs
    GROUP BY ucs.creator_set
    ORDER BY COUNT(DISTINCT ucs.user_id) DESC
    LIMIT 10
  ),

  -- Deduplicate consecutive views: Only keep transitions between different creators
  deduped_views AS (
    SELECT
      user_id,
      creator_display,
      event_time,
      position_from_end,
      LAG(creator_display) OVER (PARTITION BY user_id ORDER BY event_time ASC) as prev_creator
    FROM ordered_views
    WHERE position_from_end <= 5  -- Last 5 creators before copy
  ),

  -- Filter to only transitions (where creator changes from previous)
  transitions_only AS (
    SELECT
      user_id,
      creator_display,
      event_time
    FROM deduped_views
    WHERE prev_creator IS NULL  -- First event for user
       OR creator_display != prev_creator  -- Creator changed
  ),

  -- Top 10 complete sequences (last 5 creators before copy, deduplicated)
  user_sequences AS (
    SELECT
      user_id,
      ARRAY_AGG(creator_display ORDER BY event_time ASC) as creator_sequence
    FROM transitions_only
    GROUP BY user_id
  ),

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

COMMENT ON FUNCTION analyze_creator_copy_paths IS
'Analyzes ordered creator viewing patterns before first copy.
Includes both "Viewed Creator Profile" and "Tapped Creator Card" events.
Card events are distinguished with "(C)" suffix (e.g., "@johndoe(C)").
Consecutive duplicate views are removed (e.g., @user → @user → @other becomes @user → @other).
Returns 3 analysis types with top 10 results each:
- top_creators_viewed: Most viewed creators
- creator_combinations: Most common creator sets (unordered)
- full_sequence: Most common complete paths (last 5 unique transitions in order)
Called by analyze-creator-sequences edge function.';

-- Log migration
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Added deduplication for consecutive creator views';
  RAISE NOTICE '   - Uses LAG() to detect creator transitions';
  RAISE NOTICE '   - Only aggregates when creator changes';
  RAISE NOTICE '   - Example: [@user, @user, @other] → [@user, @other]';
  RAISE NOTICE '';
END $$;
