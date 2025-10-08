-- Migration: Create tables for event sequence analysis
-- Created: 2025-10-08
-- Purpose: Store user event sequences and Claude-powered analysis results

-- ============================================================================
-- Table: user_event_sequences
-- Stores raw event sequences per user with conversion outcomes
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_event_sequences (
  distinct_id TEXT PRIMARY KEY,
  event_sequence JSONB NOT NULL,
  total_copies INTEGER DEFAULT 0,
  total_subscriptions INTEGER DEFAULT 0,
  synced_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Index for filtering by conversion outcomes
CREATE INDEX IF NOT EXISTS idx_user_event_sequences_copies
  ON user_event_sequences(total_copies);

CREATE INDEX IF NOT EXISTS idx_user_event_sequences_subscriptions
  ON user_event_sequences(total_subscriptions);

-- Index for sync timestamp
CREATE INDEX IF NOT EXISTS idx_user_event_sequences_synced_at
  ON user_event_sequences(synced_at DESC);

COMMENT ON TABLE user_event_sequences IS 'Stores chronological event sequences per user with conversion outcomes';
COMMENT ON COLUMN user_event_sequences.event_sequence IS 'Array of events: [{event, time, creator, ...}]';
COMMENT ON COLUMN user_event_sequences.total_copies IS 'Total portfolio copies by this user';
COMMENT ON COLUMN user_event_sequences.total_subscriptions IS 'Binary flag: 1 if user has subscribed, 0 otherwise';


-- ============================================================================
-- Table: event_sequence_analysis
-- Stores Claude-powered analysis results
-- ============================================================================

CREATE TABLE IF NOT EXISTS event_sequence_analysis (
  id BIGSERIAL PRIMARY KEY,
  analysis_type TEXT NOT NULL,
  predictive_sequences JSONB,
  critical_triggers JSONB,
  anti_patterns JSONB,
  summary TEXT,
  recommendations JSONB,
  generated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  model_used TEXT DEFAULT 'claude-sonnet-4-5-20250929'
);

-- Index for querying latest analysis by type
CREATE INDEX IF NOT EXISTS idx_event_sequence_analysis_type_time
  ON event_sequence_analysis(analysis_type, generated_at DESC);

COMMENT ON TABLE event_sequence_analysis IS 'Stores Claude AI analysis results for event sequence patterns';
COMMENT ON COLUMN event_sequence_analysis.analysis_type IS 'Either "copies" or "subscriptions"';
COMMENT ON COLUMN event_sequence_analysis.predictive_sequences IS 'Sequences with high predictive power';
COMMENT ON COLUMN event_sequence_analysis.critical_triggers IS 'Events that immediately precede conversion';
COMMENT ON COLUMN event_sequence_analysis.anti_patterns IS 'Sequences associated with low conversion';
COMMENT ON COLUMN event_sequence_analysis.recommendations IS 'Actionable recommendations from analysis';


-- ============================================================================
-- Grant permissions (adjust as needed for your setup)
-- ============================================================================

-- Allow anon/authenticated users to read analysis results
ALTER TABLE event_sequence_analysis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to event_sequence_analysis"
  ON event_sequence_analysis
  FOR SELECT
  USING (true);

-- Service role has full access (for Edge Functions)
-- This is already granted by default via service_role key
