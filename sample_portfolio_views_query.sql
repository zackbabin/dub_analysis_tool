-- Sample query: Check portfolio view events between first_app_open and first_copy for 20 users
-- Shows how many portfolio views each user has in the time window

WITH sample_users AS (
  SELECT
    user_id,
    first_app_open_time,
    first_copy_time,
    EXTRACT(EPOCH FROM (first_copy_time - first_app_open_time)) / 60 as minutes_between
  FROM user_first_copies
  WHERE first_app_open_time IS NOT NULL
    AND first_copy_time IS NOT NULL
  ORDER BY first_copy_time DESC
  LIMIT 20
),

portfolio_view_counts AS (
  SELECT
    su.user_id,
    su.first_app_open_time,
    su.first_copy_time,
    su.minutes_between,
    COUNT(ps.portfolio_ticker) as total_portfolio_views,
    COUNT(DISTINCT ps.portfolio_ticker) as unique_portfolios_viewed,
    ARRAY_AGG(ps.portfolio_ticker ORDER BY ps.event_time ASC) FILTER (WHERE ps.portfolio_ticker IS NOT NULL) as portfolios_viewed_sequence
  FROM sample_users su
  LEFT JOIN portfolio_sequences_raw ps
    ON ps.user_id = su.user_id
    AND ps.event_time >= su.first_app_open_time
    AND ps.event_time < su.first_copy_time
  GROUP BY su.user_id, su.first_app_open_time, su.first_copy_time, su.minutes_between
)

SELECT
  user_id,
  first_app_open_time,
  first_copy_time,
  ROUND(minutes_between::numeric, 2) as minutes_between,
  total_portfolio_views,
  unique_portfolios_viewed,
  CASE
    WHEN portfolios_viewed_sequence IS NULL THEN '[]'
    ELSE portfolios_viewed_sequence::text
  END as portfolios_viewed
FROM portfolio_view_counts
ORDER BY first_copy_time DESC;
