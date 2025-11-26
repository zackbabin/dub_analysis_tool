SELECT
  schemaname,
  tablename as name,
  'table' as type
FROM pg_tables
WHERE schemaname = 'public'
  AND (tablename LIKE '%premium_creator%' OR tablename LIKE '%portfolio_breakdown%')
UNION ALL
SELECT
  schemaname,
  viewname as name,
  'view' as type
FROM pg_views
WHERE schemaname = 'public'
  AND (viewname LIKE '%premium_creator%' OR viewname LIKE '%portfolio_breakdown%')
UNION ALL
SELECT
  schemaname,
  matviewname as name,
  'materialized view' as type
FROM pg_matviews
WHERE schemaname = 'public'
  AND (matviewname LIKE '%premium_creator%' OR matviewname LIKE '%portfolio_breakdown%')
ORDER BY name;
