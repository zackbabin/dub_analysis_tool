-- Fix subscription conversion combinations to deduplicate items
-- Before: ["@dubAdvisors", "@dubAdvisors", "$PELOSI", "$PELOSI"]
-- After: ["@dubAdvisors", "$PELOSI"]

CREATE OR REPLACE FUNCTION analyze_unified_subscription_paths()
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
  -- Get total converter count
  SELECT COUNT(DISTINCT user_id) INTO total_converters
  FROM user_first_subscriptions;

  RETURN QUERY
  WITH all_converters AS (
    SELECT user_id, first_subscription_time
    FROM user_first_subscriptions
  ),

  -- UNION creator and portfolio views into one timeline
  unified_views AS (
    -- Creator views
    SELECT
      cs.user_id,
      'Creator: ' || cs.creator_username as view_item,
      cs.event_time
    FROM creator_sequences_raw cs
    INNER JOIN all_converters ac ON cs.user_id = ac.user_id
    WHERE cs.event_time < ac.first_subscription_time
      AND cs.creator_username IS NOT NULL

    UNION ALL

    -- Portfolio views
    SELECT
      ps.user_id,
      'Portfolio: ' || ps.portfolio_ticker as view_item,
      ps.event_time
    FROM portfolio_sequences_raw ps
    INNER JOIN all_converters ac ON ps.user_id = ac.user_id
    WHERE ps.event_time < ac.first_subscription_time
      AND ps.portfolio_ticker IS NOT NULL
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

  -- Get deduplicated sequences (last 5 views before subscription)
  deduped_sequences AS (
    SELECT
      user_id,
      view_item,
      event_time
    FROM ordered_views
    WHERE is_new_view = 1
      AND position_from_end <= 5  -- Last 5 views
  ),

  -- Build user sequences
  user_sequences AS (
    SELECT
      user_id,
      ARRAY_AGG(view_item ORDER BY event_time ASC) as view_sequence
    FROM deduped_sequences
    GROUP BY user_id
    HAVING COUNT(DISTINCT view_item) >= 2  -- Must have 2+ unique views
  ),

  -- Top 10 combinations (unordered sets with DISTINCT items)
  view_combinations AS (
    SELECT
      'combinations'::TEXT as analysis_type,
      ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC)::INT as path_rank,
      -- DISTINCT ensures no duplicate items in the combination set
      (SELECT ARRAY_AGG(DISTINCT x ORDER BY x) FROM UNNEST(us.view_sequence) x) as view_set,
      COUNT(*)::INT as converter_count,
      ROUND((COUNT(*)::NUMERIC / total_converters * 100), 2) as pct_of_converters,
      total_converters as total_converters_analyzed
    FROM user_sequences us
    GROUP BY view_set
    ORDER BY COUNT(*) DESC
    LIMIT 10
  ),

  -- Top 10 ordered sequences (keep duplicates to show actual path)
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

COMMENT ON FUNCTION analyze_unified_subscription_paths IS
  'Analyzes combined creator + portfolio viewing sequences before first subscription.
   Returns top combinations (unordered sets with deduplicated items) and full sequences (ordered paths).
   Combinations use DISTINCT to remove duplicate items (e.g., viewing same creator multiple times).';
