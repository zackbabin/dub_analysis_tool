-- Comprehensive query performance analysis
-- Shows both historical and recent query patterns

-- 1. TOP 20 QUERIES BY TOTAL EXECUTION TIME (since stats were last reset)
SELECT 
  calls,
  ROUND(total_exec_time::numeric / 1000, 2) as total_seconds,
  ROUND(mean_exec_time::numeric / 1000, 3) as avg_seconds,
  ROUND(max_exec_time::numeric / 1000, 3) as max_seconds,
  ROUND((100 * total_exec_time / SUM(total_exec_time) OVER ())::numeric, 2) AS percent_total,
  LEFT(query, 100) as query_preview
FROM pg_stat_statements
WHERE query NOT LIKE '%pg_stat_statements%'
  AND query NOT LIKE '%pg_catalog%'
ORDER BY total_exec_time DESC
LIMIT 20;

-- 2. MOST FREQUENTLY CALLED QUERIES
SELECT 
  calls,
  ROUND(total_exec_time::numeric / 1000, 2) as total_seconds,
  ROUND(mean_exec_time::numeric / 1000, 3) as avg_seconds,
  LEFT(query, 100) as query_preview
FROM pg_stat_statements
WHERE query NOT LIKE '%pg_stat_statements%'
  AND query NOT LIKE '%pg_catalog%'
ORDER BY calls DESC
LIMIT 20;

-- 3. SLOWEST INDIVIDUAL QUERY EXECUTIONS (by max time)
SELECT 
  calls,
  ROUND(max_exec_time::numeric / 1000, 2) as max_seconds,
  ROUND(mean_exec_time::numeric / 1000, 3) as avg_seconds,
  LEFT(query, 100) as query_preview
FROM pg_stat_statements
WHERE query NOT LIKE '%pg_stat_statements%'
  AND query NOT LIKE '%pg_catalog%'
ORDER BY max_exec_time DESC
LIMIT 20;

-- 4. DISK IO HEAVY QUERIES (sequential scans, blocks read)
SELECT 
  calls,
  shared_blks_read as blocks_read_from_disk,
  shared_blks_hit as blocks_from_cache,
  ROUND((100.0 * shared_blks_hit / NULLIF(shared_blks_hit + shared_blks_read, 0))::numeric, 2) as cache_hit_ratio,
  ROUND(total_exec_time::numeric / 1000, 2) as total_seconds,
  LEFT(query, 100) as query_preview
FROM pg_stat_statements
WHERE query NOT LIKE '%pg_stat_statements%'
  AND query NOT LIKE '%pg_catalog%'
  AND (shared_blks_read > 0 OR shared_blks_hit > 0)
ORDER BY shared_blks_read DESC
LIMIT 20;

-- 5. QUERIES WITH LOW CACHE HIT RATIO (causing disk reads)
SELECT 
  calls,
  shared_blks_read as disk_blocks,
  shared_blks_hit as cache_blocks,
  ROUND((100.0 * shared_blks_hit / NULLIF(shared_blks_hit + shared_blks_read, 0))::numeric, 2) as cache_hit_percent,
  ROUND(total_exec_time::numeric / 1000, 2) as total_seconds,
  LEFT(query, 100) as query_preview
FROM pg_stat_statements
WHERE query NOT LIKE '%pg_stat_statements%'
  AND query NOT LIKE '%pg_catalog%'
  AND shared_blks_read > 1000  -- Only queries reading >1000 blocks from disk
ORDER BY cache_hit_percent ASC
LIMIT 20;

-- 6. QUERIES DOING THE MOST WRITES
SELECT 
  calls,
  shared_blks_written as blocks_written,
  shared_blks_dirtied as blocks_modified,
  ROUND(total_exec_time::numeric / 1000, 2) as total_seconds,
  LEFT(query, 100) as query_preview
FROM pg_stat_statements
WHERE query NOT LIKE '%pg_stat_statements%'
  AND query NOT LIKE '%pg_catalog%'
  AND shared_blks_written > 0
ORDER BY shared_blks_written DESC
LIMIT 20;

-- 7. TABLE ACCESS PATTERNS (which tables are hit most)
SELECT 
  schemaname,
  relname as table_name,
  seq_scan as sequential_scans,
  seq_tup_read as rows_read_seq,
  idx_scan as index_scans,
  idx_tup_fetch as rows_read_idx,
  n_tup_ins as inserts,
  n_tup_upd as updates,
  n_tup_del as deletes,
  ROUND((100.0 * idx_scan / NULLIF(idx_scan + seq_scan, 0))::numeric, 2) as index_usage_percent
FROM pg_stat_user_tables
ORDER BY seq_scan + idx_scan DESC
LIMIT 20;

-- 8. TABLES WITH POOR INDEX USAGE (many sequential scans)
SELECT 
  schemaname,
  relname as table_name,
  seq_scan as sequential_scans,
  idx_scan as index_scans,
  n_live_tup as estimated_rows,
  ROUND((100.0 * idx_scan / NULLIF(idx_scan + seq_scan, 0))::numeric, 2) as index_usage_percent
FROM pg_stat_user_tables
WHERE seq_scan > 0
ORDER BY seq_scan DESC
LIMIT 20;

-- 9. WHEN WERE STATS LAST RESET?
SELECT 
  stats_reset,
  NOW() - stats_reset as time_since_reset
FROM pg_stat_database
WHERE datname = current_database();

-- 10. OVERALL DATABASE CACHE HIT RATIO
SELECT 
  sum(heap_blks_hit) as cache_hits,
  sum(heap_blks_read) as disk_reads,
  ROUND((100.0 * sum(heap_blks_hit) / NULLIF(sum(heap_blks_hit) + sum(heap_blks_read), 0))::numeric, 2) as cache_hit_ratio
FROM pg_statio_user_tables;
