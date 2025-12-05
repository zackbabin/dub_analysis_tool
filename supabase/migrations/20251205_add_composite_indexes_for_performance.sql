-- Migration: Add composite indexes for better query performance
-- Created: 2025-12-05
-- Purpose: Optimize window functions and time-based queries in copy path analysis
--
-- With ~900k portfolio events, the analysis functions need efficient indexes for:
-- 1. JOINs on user_id + time range filters
-- 2. Window functions that PARTITION BY user_id ORDER BY event_time
--
-- These indexes improve query performance without changing any results

-- ===========================================
-- 1. Add composite index for portfolio sequences
-- ===========================================

CREATE INDEX IF NOT EXISTS idx_portfolio_sequences_raw_user_time
ON portfolio_sequences_raw(user_id, event_time);

COMMENT ON INDEX idx_portfolio_sequences_raw_user_time IS
'Composite index for efficient window functions (PARTITION BY user_id ORDER BY event_time)
and time range queries in copy path analysis. Speeds up queries that filter by user_id
and order/filter by event_time.';

-- ===========================================
-- 2. Add composite index for creator sequences
-- ===========================================

CREATE INDEX IF NOT EXISTS idx_creator_sequences_raw_user_time
ON creator_sequences_raw(user_id, event_time);

COMMENT ON INDEX idx_creator_sequences_raw_user_time IS
'Composite index for efficient window functions (PARTITION BY user_id ORDER BY event_time)
and time range queries in copy path analysis. Speeds up queries that filter by user_id
and order/filter by event_time.';

-- ===========================================
-- 3. Log Migration
-- ===========================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Added composite indexes for performance optimization';
  RAISE NOTICE '   - idx_portfolio_sequences_raw_user_time on (user_id, event_time)';
  RAISE NOTICE '   - idx_creator_sequences_raw_user_time on (user_id, event_time)';
  RAISE NOTICE '   - Improves window function and time range query performance';
  RAISE NOTICE '   - No impact on analysis results, only speed';
  RAISE NOTICE '';
END $$;
