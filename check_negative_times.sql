-- Check how many users have negative time windows (data quality issue)

SELECT
  COUNT(*) as users_with_negative_time,
  ROUND(
    COUNT(*)::NUMERIC /
    (SELECT COUNT(*) FROM user_first_copies WHERE first_app_open_time IS NOT NULL AND first_copy_time IS NOT NULL)::NUMERIC * 100,
    2
  ) as pct_of_users_with_both_timestamps
FROM user_first_copies
WHERE first_app_open_time IS NOT NULL
  AND first_copy_time IS NOT NULL
  AND first_copy_time < first_app_open_time;
