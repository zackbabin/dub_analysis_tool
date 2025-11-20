-- Diagnostic queries to understand what happened during support analysis trigger

-- 1. Check recent sync_logs to see which functions actually executed
SELECT
  tool_type,
  table_name,
  status,
  total_records_inserted,
  error_message,
  created_at
FROM sync_logs
WHERE created_at > NOW() - INTERVAL '2 hours'
ORDER BY created_at DESC;

-- 2. Check support_sync_status to see last sync times
SELECT
  source,
  last_sync_timestamp,
  last_sync_status,
  conversations_synced,
  messages_synced,
  error_message,
  updated_at
FROM support_sync_status;

-- 3. Check how many conversations are in raw_support_conversations
SELECT
  source,
  COUNT(*) as total_count,
  MAX(created_at) as most_recent,
  MIN(created_at) as oldest
FROM raw_support_conversations
GROUP BY source;

-- 4. Check enriched_support_conversations view (what analyze function queries)
SELECT
  COUNT(*) as total_conversations,
  COUNT(CASE WHEN created_at > NOW() - INTERVAL '7 days' THEN 1 END) as last_7_days,
  COUNT(CASE WHEN created_at > NOW() - INTERVAL '1 day' THEN 1 END) as last_24_hours
FROM enriched_support_conversations;

-- 5. Check support_feedback_analysis table for recent analysis results
SELECT
  analysis_period_start,
  analysis_period_end,
  conversation_count,
  issue_count,
  created_at
FROM support_feedback_analysis
ORDER BY created_at DESC
LIMIT 5;

-- 6. Check if Linear issues were synced
SELECT
  COUNT(*) as total_issues,
  MAX(synced_at) as last_sync,
  COUNT(CASE WHEN synced_at > NOW() - INTERVAL '1 hour' THEN 1 END) as synced_last_hour
FROM linear_issues;
