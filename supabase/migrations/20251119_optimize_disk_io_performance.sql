-- Migration: Optimize disk IO performance
-- Created: 2025-11-19
-- Purpose: Add missing indexes and optimize for upsert operations to reduce disk IO

-- ============================================================================
-- CRITICAL: Add indexes for upsert conflict resolution
-- ============================================================================

-- Index for support_conversation_messages upsert conflict
-- Current upsert uses: onConflict: 'conversation_id,external_id'
-- Without a proper index, PostgreSQL does full table scans on every upsert
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_support_messages_upsert_conflict
ON support_conversation_messages(conversation_id, external_id)
WHERE external_id IS NOT NULL;

-- Index for raw_support_conversations upsert conflict
-- Current upsert uses: onConflict: 'source,external_id'
-- The UNIQUE constraint creates an index, but we want to ensure it exists
-- This is likely already created by the UNIQUE constraint, but verify
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'raw_support_conversations'
    AND indexdef LIKE '%source%external_id%'
  ) THEN
    CREATE INDEX CONCURRENTLY idx_raw_conversations_upsert_conflict
    ON raw_support_conversations(source, external_id);
  END IF;
END $$;

-- ============================================================================
-- Add indexes for frequently joined columns
-- ============================================================================

-- Index for event_sequences_raw enrichment queries
-- These queries filter by event_name and check for null portfolio_ticker/creator_username
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_event_sequences_enrichment
ON event_sequences_raw(event_name, event_time DESC)
WHERE portfolio_ticker IS NULL OR creator_username IS NULL;

-- Index for event_sequences lookup by distinct_id + event_name + time
-- Used in enrich-event-sequences for matching Mixpanel data to database events
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_event_sequences_lookup
ON event_sequences_raw(distinct_id, event_name, event_time);

-- ============================================================================
-- Optimize support_conversation_messages for message fetching
-- ============================================================================

-- Composite index for fetching messages by conversation (ordered by time)
-- Already exists from previous migration, but ensure it's optimal
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_support_messages_conv_time
ON support_conversation_messages(conversation_id, created_at ASC);

-- ============================================================================
-- Add statistics for better query planning
-- ============================================================================

-- Update statistics on heavily-used tables
ANALYZE raw_support_conversations;
ANALYZE support_conversation_messages;
ANALYZE event_sequences_raw;
ANALYZE linear_issues;

-- ============================================================================
-- VERIFICATION & RECOMMENDATIONS
-- ============================================================================

DO $$
DECLARE
  support_conv_count BIGINT;
  support_msg_count BIGINT;
  event_seq_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO support_conv_count FROM raw_support_conversations;
  SELECT COUNT(*) INTO support_msg_count FROM support_conversation_messages;
  SELECT COUNT(*) INTO event_seq_count FROM event_sequences_raw;

  RAISE NOTICE '============================================';
  RAISE NOTICE 'Disk IO Optimization Complete';
  RAISE NOTICE '============================================';
  RAISE NOTICE 'Added/verified critical indexes for:';
  RAISE NOTICE '  ✓ support_conversation_messages upsert conflict';
  RAISE NOTICE '  ✓ raw_support_conversations upsert conflict';
  RAISE NOTICE '  ✓ event_sequences_raw enrichment queries';
  RAISE NOTICE '  ✓ event_sequences_raw lookup by distinct_id+event+time';
  RAISE NOTICE '';
  RAISE NOTICE 'Table sizes:';
  RAISE NOTICE '  - raw_support_conversations: % rows', support_conv_count;
  RAISE NOTICE '  - support_conversation_messages: % rows', support_msg_count;
  RAISE NOTICE '  - event_sequences_raw: % rows', event_seq_count;
  RAISE NOTICE '';
  RAISE NOTICE 'Additional recommendations:';
  RAISE NOTICE '  1. Materialized view refresh moved to scheduled cron (not per-analysis)';
  RAISE NOTICE '  2. Monitor slow queries with: SELECT * FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10;';
  RAISE NOTICE '  3. Check cache hit rate with: SELECT sum(heap_blks_hit) / nullif(sum(heap_blks_hit) + sum(heap_blks_read), 0) AS cache_hit_ratio FROM pg_statio_user_tables;';
END $$;
