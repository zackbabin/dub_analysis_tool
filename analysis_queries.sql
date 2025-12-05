-- Investigation Queries: Portfolio and Creator Views Between First App Open and First Copy
-- Created: 2025-12-05

-- ===========================================
-- Query 1: Overall User Statistics
-- ===========================================
-- Check how many users have both timestamps vs only first_copy_time

SELECT
  COUNT(*) as total_users,
  COUNT(*) FILTER (WHERE first_app_open_time IS NOT NULL AND first_copy_time IS NOT NULL) as users_with_both_timestamps,
  COUNT(*) FILTER (WHERE first_app_open_time IS NULL AND first_copy_time IS NOT NULL) as users_with_only_copy_time,
  ROUND(
    COUNT(*) FILTER (WHERE first_app_open_time IS NOT NULL AND first_copy_time IS NOT NULL)::NUMERIC /
    COUNT(*)::NUMERIC * 100,
    2
  ) as pct_with_both_timestamps
FROM user_first_copies;

-- ===========================================
-- Query 2: Portfolio Views - Users with vs without views
-- ===========================================

WITH users_with_both_timestamps AS (
  SELECT user_id, first_app_open_time, first_copy_time
  FROM user_first_copies
  WHERE first_app_open_time IS NOT NULL
    AND first_copy_time IS NOT NULL
),

portfolio_view_counts AS (
  SELECT
    u.user_id,
    COUNT(DISTINCT ps.portfolio_ticker) as unique_portfolios_viewed
  FROM users_with_both_timestamps u
  LEFT JOIN portfolio_sequences_raw ps
    ON ps.user_id = u.user_id
    AND ps.event_time >= u.first_app_open_time
    AND ps.event_time < u.first_copy_time
    AND ps.portfolio_ticker IS NOT NULL
  GROUP BY u.user_id
)

SELECT
  COUNT(*) as total_converters_with_both_timestamps,
  COUNT(*) FILTER (WHERE unique_portfolios_viewed > 0) as converters_with_portfolio_views,
  COUNT(*) FILTER (WHERE unique_portfolios_viewed = 0) as converters_without_portfolio_views,
  ROUND(
    COUNT(*) FILTER (WHERE unique_portfolios_viewed > 0)::NUMERIC /
    COUNT(*)::NUMERIC * 100,
    2
  ) as pct_with_portfolio_views,
  ROUND(
    COUNT(*) FILTER (WHERE unique_portfolios_viewed = 0)::NUMERIC /
    COUNT(*)::NUMERIC * 100,
    2
  ) as pct_without_portfolio_views,
  ROUND(AVG(unique_portfolios_viewed), 2) as avg_unique_portfolios,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY unique_portfolios_viewed) as median_unique_portfolios
FROM portfolio_view_counts;

-- ===========================================
-- Query 3: Creator Views - Users with vs without views
-- ===========================================

WITH users_with_both_timestamps AS (
  SELECT user_id, first_app_open_time, first_copy_time
  FROM user_first_copies
  WHERE first_app_open_time IS NOT NULL
    AND first_copy_time IS NOT NULL
),

creator_view_counts AS (
  SELECT
    u.user_id,
    COUNT(DISTINCT cs.creator_username) as unique_creators_viewed
  FROM users_with_both_timestamps u
  LEFT JOIN creator_sequences_raw cs
    ON cs.user_id = u.user_id
    AND cs.event_time >= u.first_app_open_time
    AND cs.event_time < u.first_copy_time
    AND cs.creator_username IS NOT NULL
  GROUP BY u.user_id
)

SELECT
  COUNT(*) as total_converters_with_both_timestamps,
  COUNT(*) FILTER (WHERE unique_creators_viewed > 0) as converters_with_creator_views,
  COUNT(*) FILTER (WHERE unique_creators_viewed = 0) as converters_without_creator_views,
  ROUND(
    COUNT(*) FILTER (WHERE unique_creators_viewed > 0)::NUMERIC /
    COUNT(*)::NUMERIC * 100,
    2
  ) as pct_with_creator_views,
  ROUND(
    COUNT(*) FILTER (WHERE unique_creators_viewed = 0)::NUMERIC /
    COUNT(*)::NUMERIC * 100,
    2
  ) as pct_without_creator_views,
  ROUND(AVG(unique_creators_viewed), 2) as avg_unique_creators,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY unique_creators_viewed) as median_unique_creators
FROM creator_view_counts;

-- ===========================================
-- Query 4: Sample Users WITHOUT Any Views
-- ===========================================
-- Show 10 sample users who have no portfolio or creator views

WITH users_with_both_timestamps AS (
  SELECT user_id, first_app_open_time, first_copy_time
  FROM user_first_copies
  WHERE first_app_open_time IS NOT NULL
    AND first_copy_time IS NOT NULL
),

portfolio_view_counts AS (
  SELECT
    u.user_id,
    u.first_app_open_time,
    u.first_copy_time,
    COUNT(DISTINCT ps.portfolio_ticker) as unique_portfolios_viewed
  FROM users_with_both_timestamps u
  LEFT JOIN portfolio_sequences_raw ps
    ON ps.user_id = u.user_id
    AND ps.event_time >= u.first_app_open_time
    AND ps.event_time < u.first_copy_time
  GROUP BY u.user_id, u.first_app_open_time, u.first_copy_time
),

creator_view_counts AS (
  SELECT
    u.user_id,
    COUNT(DISTINCT cs.creator_username) as unique_creators_viewed
  FROM users_with_both_timestamps u
  LEFT JOIN creator_sequences_raw cs
    ON cs.user_id = u.user_id
    AND cs.event_time >= u.first_app_open_time
    AND cs.event_time < u.first_copy_time
  GROUP BY u.user_id
)

SELECT
  pvc.user_id,
  pvc.first_app_open_time,
  pvc.first_copy_time,
  EXTRACT(EPOCH FROM (pvc.first_copy_time - pvc.first_app_open_time)) / 60 as minutes_between_open_and_copy,
  pvc.unique_portfolios_viewed,
  cvc.unique_creators_viewed
FROM portfolio_view_counts pvc
INNER JOIN creator_view_counts cvc ON pvc.user_id = cvc.user_id
WHERE pvc.unique_portfolios_viewed = 0
  AND cvc.unique_creators_viewed = 0
ORDER BY pvc.first_copy_time DESC
LIMIT 10;

-- ===========================================
-- Query 5: Sample Users WITH Views
-- ===========================================
-- Show 10 sample users who DO have portfolio and creator views

WITH users_with_both_timestamps AS (
  SELECT user_id, first_app_open_time, first_copy_time
  FROM user_first_copies
  WHERE first_app_open_time IS NOT NULL
    AND first_copy_time IS NOT NULL
),

portfolio_view_counts AS (
  SELECT
    u.user_id,
    u.first_app_open_time,
    u.first_copy_time,
    COUNT(DISTINCT ps.portfolio_ticker) as unique_portfolios_viewed
  FROM users_with_both_timestamps u
  LEFT JOIN portfolio_sequences_raw ps
    ON ps.user_id = u.user_id
    AND ps.event_time >= u.first_app_open_time
    AND ps.event_time < u.first_copy_time
  GROUP BY u.user_id, u.first_app_open_time, u.first_copy_time
),

creator_view_counts AS (
  SELECT
    u.user_id,
    COUNT(DISTINCT cs.creator_username) as unique_creators_viewed
  FROM users_with_both_timestamps u
  LEFT JOIN creator_sequences_raw cs
    ON cs.user_id = u.user_id
    AND cs.event_time >= u.first_app_open_time
    AND cs.event_time < u.first_copy_time
  GROUP BY u.user_id
)

SELECT
  pvc.user_id,
  pvc.first_app_open_time,
  pvc.first_copy_time,
  EXTRACT(EPOCH FROM (pvc.first_copy_time - pvc.first_app_open_time)) / 60 as minutes_between_open_and_copy,
  pvc.unique_portfolios_viewed,
  cvc.unique_creators_viewed
FROM portfolio_view_counts pvc
INNER JOIN creator_view_counts cvc ON pvc.user_id = cvc.user_id
WHERE pvc.unique_portfolios_viewed > 0
  OR cvc.unique_creators_viewed > 0
ORDER BY pvc.first_copy_time DESC
LIMIT 10;

-- ===========================================
-- Query 6: Distribution of View Counts
-- ===========================================
-- Show histogram of how many users have 0, 1, 2, 3... views

WITH users_with_both_timestamps AS (
  SELECT user_id, first_app_open_time, first_copy_time
  FROM user_first_copies
  WHERE first_app_open_time IS NOT NULL
    AND first_copy_time IS NOT NULL
),

portfolio_view_counts AS (
  SELECT
    u.user_id,
    COUNT(DISTINCT ps.portfolio_ticker) as unique_portfolios_viewed
  FROM users_with_both_timestamps u
  LEFT JOIN portfolio_sequences_raw ps
    ON ps.user_id = u.user_id
    AND ps.event_time >= u.first_app_open_time
    AND ps.event_time < u.first_copy_time
  GROUP BY u.user_id
)

SELECT
  unique_portfolios_viewed as portfolio_view_count,
  COUNT(*) as user_count,
  ROUND(COUNT(*)::NUMERIC / SUM(COUNT(*)) OVER () * 100, 2) as pct_of_users
FROM portfolio_view_counts
GROUP BY unique_portfolios_viewed
ORDER BY unique_portfolios_viewed ASC
LIMIT 20;

-- ===========================================
-- Query 7: Time Between First App Open and First Copy
-- ===========================================
-- Check if users with 0 views have very short time windows

WITH users_with_both_timestamps AS (
  SELECT
    user_id,
    first_app_open_time,
    first_copy_time,
    EXTRACT(EPOCH FROM (first_copy_time - first_app_open_time)) / 60 as minutes_diff
  FROM user_first_copies
  WHERE first_app_open_time IS NOT NULL
    AND first_copy_time IS NOT NULL
),

portfolio_view_counts AS (
  SELECT
    u.user_id,
    u.minutes_diff,
    COUNT(DISTINCT ps.portfolio_ticker) as unique_portfolios_viewed
  FROM users_with_both_timestamps u
  LEFT JOIN portfolio_sequences_raw ps
    ON ps.user_id = u.user_id
    AND ps.event_time >= u.first_app_open_time
    AND ps.event_time < u.first_copy_time
  GROUP BY u.user_id, u.minutes_diff
)

SELECT
  CASE
    WHEN unique_portfolios_viewed = 0 THEN 'No views'
    ELSE 'Has views'
  END as view_status,
  COUNT(*) as user_count,
  ROUND(AVG(minutes_diff), 2) as avg_minutes_between_open_and_copy,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY minutes_diff) as median_minutes,
  ROUND(MIN(minutes_diff), 2) as min_minutes,
  ROUND(MAX(minutes_diff), 2) as max_minutes
FROM portfolio_view_counts
GROUP BY CASE WHEN unique_portfolios_viewed = 0 THEN 'No views' ELSE 'Has views' END;
