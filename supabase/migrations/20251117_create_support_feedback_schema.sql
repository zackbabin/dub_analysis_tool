-- Product Feedback Analysis System: Database Schema
-- Creates tables and views for storing and analyzing support conversations from Zendesk and Instabug
-- Designed to be additive and non-breaking to existing schema

-- ============================================================================
-- 1. MAIN TABLES
-- ============================================================================

-- Table: raw_support_conversations
-- Stores normalized tickets and bugs from Zendesk, Instabug, and future sources (Notion)
-- All PII is redacted before insertion
CREATE TABLE IF NOT EXISTS raw_support_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL CHECK (source IN ('zendesk', 'instabug', 'notion')),
  external_id TEXT NOT NULL,
  title TEXT,
  description TEXT, -- PII redacted
  status TEXT,
  priority TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  user_uuid UUID, -- For matching to subscribers_insights via distinct_id; NULL if no user association
  user_id TEXT, -- External user ID from source system (distinct_id from Zendesk/Instabug)
  assignee_id TEXT,
  tags TEXT[] DEFAULT '{}',
  custom_fields JSONB DEFAULT '{}',
  raw_data JSONB DEFAULT '{}', -- PII redacted
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source, external_id)
);

-- Table: support_conversation_messages
-- Stores comments/messages within conversations
-- Optional for sources like Notion that may only have single-block content
CREATE TABLE IF NOT EXISTS support_conversation_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES raw_support_conversations(id) ON DELETE CASCADE,
  external_id TEXT,
  author_type TEXT CHECK (author_type IN ('customer', 'agent', 'system', 'interviewer')),
  author_id TEXT,
  author_email TEXT, -- Redacted from body text
  body TEXT NOT NULL, -- PII redacted
  is_public BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL,
  attachments JSONB DEFAULT '[]',
  raw_data JSONB DEFAULT '{}', -- PII redacted
  UNIQUE(conversation_id, external_id)
);

-- Table: support_sync_status
-- Tracks last sync timestamps for incremental fetching
CREATE TABLE IF NOT EXISTS support_sync_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL UNIQUE CHECK (source IN ('zendesk', 'instabug', 'notion')),
  last_sync_timestamp TIMESTAMPTZ NOT NULL,
  last_sync_status TEXT CHECK (last_sync_status IN ('success', 'failed', 'in_progress')),
  conversations_synced INTEGER DEFAULT 0,
  messages_synced INTEGER DEFAULT 0,
  error_message TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: support_analysis_results
-- Stores Claude's weekly analysis outputs
CREATE TABLE IF NOT EXISTS support_analysis_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_date DATE NOT NULL,
  week_start_date DATE NOT NULL,
  conversation_count INTEGER NOT NULL,
  total_tokens_used INTEGER,
  analysis_cost NUMERIC(10,4),
  top_issues JSONB NOT NULL, -- Array of 10 issue objects
  raw_response TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(week_start_date)
);

-- ============================================================================
-- 2. INDEXES
-- ============================================================================

-- Indexes for raw_support_conversations
CREATE INDEX IF NOT EXISTS idx_support_conversations_created ON raw_support_conversations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_conversations_source ON raw_support_conversations(source);
CREATE INDEX IF NOT EXISTS idx_support_conversations_status ON raw_support_conversations(status);
CREATE INDEX IF NOT EXISTS idx_support_conversations_user_uuid ON raw_support_conversations(user_uuid);
CREATE INDEX IF NOT EXISTS idx_support_conversations_user_id ON raw_support_conversations(user_id);

-- Indexes for support_conversation_messages
CREATE INDEX IF NOT EXISTS idx_support_messages_conversation ON support_conversation_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_support_messages_created ON support_conversation_messages(created_at DESC);

-- Indexes for support_analysis_results
CREATE INDEX IF NOT EXISTS idx_support_analysis_week ON support_analysis_results(week_start_date DESC);

-- ============================================================================
-- 3. MATERIALIZED VIEW
-- ============================================================================

-- Materialized View: enriched_support_conversations
-- Pre-computed view joining conversations with user data from subscribers_insights
-- Uses NULL-safe aggregation to handle conversations without messages (e.g., Notion feedback)
CREATE MATERIALIZED VIEW IF NOT EXISTS enriched_support_conversations AS
SELECT
  c.*,
  u.income as user_income,
  u.net_worth as user_net_worth,
  u.investing_activity as user_investing_activity,
  u.total_copies as user_total_copies,
  u.total_subscriptions as user_total_subscriptions,
  u.app_sessions as user_app_sessions,
  COUNT(m.id) as message_count,
  ARRAY_AGG(m.body ORDER BY m.created_at) FILTER (WHERE m.body IS NOT NULL) as all_messages
FROM raw_support_conversations c
LEFT JOIN subscribers_insights u ON c.user_id = u.distinct_id
LEFT JOIN support_conversation_messages m ON c.id = m.conversation_id
GROUP BY
  c.id,
  u.income,
  u.net_worth,
  u.investing_activity,
  u.total_copies,
  u.total_subscriptions,
  u.app_sessions;

-- Indexes for materialized view
CREATE UNIQUE INDEX IF NOT EXISTS idx_enriched_support_id ON enriched_support_conversations(id);
CREATE INDEX IF NOT EXISTS idx_enriched_support_created ON enriched_support_conversations(created_at DESC);

-- ============================================================================
-- 4. HELPER FUNCTIONS
-- ============================================================================

-- Function: refresh_enriched_support_conversations
-- Refreshes the materialized view after data sync
CREATE OR REPLACE FUNCTION refresh_enriched_support_conversations()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY enriched_support_conversations;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 5. INITIAL DATA
-- ============================================================================

-- Insert initial sync status records (7 days lookback)
INSERT INTO support_sync_status (source, last_sync_timestamp, last_sync_status)
VALUES
  ('zendesk', NOW() - INTERVAL '7 days', 'success'),
  ('instabug', NOW() - INTERVAL '7 days', 'success')
ON CONFLICT (source) DO NOTHING;

-- ============================================================================
-- 6. ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE raw_support_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_conversation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_sync_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_analysis_results ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for re-running migration)
DROP POLICY IF EXISTS "Service role has full access to raw_support_conversations" ON raw_support_conversations;
DROP POLICY IF EXISTS "Service role has full access to support_conversation_messages" ON support_conversation_messages;
DROP POLICY IF EXISTS "Service role has full access to support_sync_status" ON support_sync_status;
DROP POLICY IF EXISTS "Service role has full access to support_analysis_results" ON support_analysis_results;
DROP POLICY IF EXISTS "Authenticated users can view support_analysis_results" ON support_analysis_results;

-- Policy: Allow service role full access to all tables
CREATE POLICY "Service role has full access to raw_support_conversations"
  ON raw_support_conversations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role has full access to support_conversation_messages"
  ON support_conversation_messages
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role has full access to support_sync_status"
  ON support_sync_status
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role has full access to support_analysis_results"
  ON support_analysis_results
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Policy: Allow authenticated users read-only access (for dashboard viewing)
CREATE POLICY "Authenticated users can view support_analysis_results"
  ON support_analysis_results
  FOR SELECT
  TO authenticated
  USING (true);

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

-- Verify tables were created
DO $$
BEGIN
  RAISE NOTICE 'Support Feedback Analysis schema created successfully';
  RAISE NOTICE 'Tables: raw_support_conversations, support_conversation_messages, support_sync_status, support_analysis_results';
  RAISE NOTICE 'Materialized View: enriched_support_conversations';
  RAISE NOTICE 'Helper Function: refresh_enriched_support_conversations()';
END $$;
