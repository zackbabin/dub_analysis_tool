-- Migration: Add Linear Integration for CX Analysis
-- Created: 2025-11-17
-- Purpose: Store Linear issues and map them to support feedback items

-- ============================================================================
-- 1. LINEAR ISSUES TABLE
-- ============================================================================

-- Table: linear_issues
-- Stores Linear issues fetched from Linear API (team: "dub 3.0", last 6 months)
CREATE TABLE IF NOT EXISTS linear_issues (
  id TEXT PRIMARY KEY,                -- Linear issue ID (e.g., "DUB-123" identifier)
  identifier TEXT UNIQUE NOT NULL,    -- Human-readable identifier (e.g., "DUB-123")
  title TEXT NOT NULL,
  description TEXT,
  state_name TEXT NOT NULL,           -- "Backlog", "Todo", "In Progress", "Done", "Cancelled", etc.
  state_type TEXT,                    -- "backlog", "started", "completed", "canceled"
  team_id TEXT,
  team_name TEXT,
  assignee_id TEXT,
  assignee_name TEXT,
  priority SMALLINT,                  -- 0 = No priority, 1 = Urgent, 2 = High, 3 = Medium, 4 = Low
  priority_label TEXT,                -- Human-readable priority
  url TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT linear_issues_state_check CHECK (state_name IS NOT NULL)
);

-- Indexes for linear_issues
CREATE INDEX IF NOT EXISTS idx_linear_issues_identifier ON linear_issues(identifier);
CREATE INDEX IF NOT EXISTS idx_linear_issues_team ON linear_issues(team_name);
CREATE INDEX IF NOT EXISTS idx_linear_issues_state ON linear_issues(state_name);
CREATE INDEX IF NOT EXISTS idx_linear_issues_updated ON linear_issues(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_linear_issues_synced ON linear_issues(synced_at DESC);

-- ============================================================================
-- 2. UPDATE SUPPORT CONVERSATIONS TABLE
-- ============================================================================

-- Add columns to raw_support_conversations for Linear metadata
ALTER TABLE raw_support_conversations
  ADD COLUMN IF NOT EXISTS has_linear_ticket BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS linear_issue_id TEXT,
  ADD COLUMN IF NOT EXISTS linear_custom_field_id TEXT;

-- Index for Linear metadata
CREATE INDEX IF NOT EXISTS idx_support_conversations_linear ON raw_support_conversations(linear_issue_id) WHERE linear_issue_id IS NOT NULL;

-- ============================================================================
-- 3. LINEAR MAPPING TABLE
-- ============================================================================

-- Table: linear_feedback_mapping
-- Maps Linear issues to support feedback items
-- This allows multiple Linear issues per feedback item and tracks mapping source
CREATE TABLE IF NOT EXISTS linear_feedback_mapping (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_week_start DATE NOT NULL,              -- Links to support_analysis_results.week_start_date
  feedback_rank INTEGER NOT NULL,                 -- Rank of feedback item (1-10)
  feedback_summary TEXT NOT NULL,                 -- Issue summary for reference
  linear_issue_id TEXT NOT NULL,                  -- Links to linear_issues.id
  linear_identifier TEXT NOT NULL,                -- Human-readable (e.g., "DUB-123")
  mapping_source TEXT NOT NULL,                   -- "zendesk_integration" or "ai_semantic_match"
  mapping_confidence NUMERIC(3,2),                -- 0.00-1.00 (for AI matches)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (linear_issue_id) REFERENCES linear_issues(id) ON DELETE CASCADE,
  UNIQUE(feedback_week_start, feedback_rank, linear_issue_id)
);

-- Indexes for linear_feedback_mapping
CREATE INDEX IF NOT EXISTS idx_linear_mapping_week ON linear_feedback_mapping(feedback_week_start);
CREATE INDEX IF NOT EXISTS idx_linear_mapping_rank ON linear_feedback_mapping(feedback_rank);
CREATE INDEX IF NOT EXISTS idx_linear_mapping_issue ON linear_feedback_mapping(linear_issue_id);

-- ============================================================================
-- 4. UPDATE ENRICHED VIEW TO INCLUDE LINEAR METADATA
-- ============================================================================

-- Drop and recreate enriched_support_conversations to include Linear fields
DROP MATERIALIZED VIEW IF EXISTS enriched_support_conversations CASCADE;

CREATE MATERIALIZED VIEW enriched_support_conversations AS
SELECT
  c.*,
  u.income as user_income,
  u.net_worth as user_net_worth,
  u.investing_activity as user_investing_activity,
  u.total_copies as user_total_copies,
  u.total_subscriptions as user_total_subscriptions,
  u.app_sessions as user_app_sessions,
  COALESCE(
    (SELECT COUNT(*) FROM support_conversation_messages m WHERE m.conversation_id = c.id),
    0
  ) as message_count,
  COALESCE(
    (SELECT ARRAY_AGG(m.body ORDER BY m.created_at)
     FROM support_conversation_messages m
     WHERE m.conversation_id = c.id),
    ARRAY[]::TEXT[]
  ) as all_messages,
  -- Add Linear metadata from join (has_linear_ticket, linear_issue_id already in c.*)
  li.identifier as linear_identifier,
  li.title as linear_title,
  li.state_name as linear_state,
  li.url as linear_url
FROM raw_support_conversations c
LEFT JOIN subscribers_insights u ON c.user_id = u.distinct_id
LEFT JOIN linear_issues li ON c.linear_issue_id = li.id;

-- Create index on enriched view for performance
CREATE INDEX IF NOT EXISTS idx_enriched_support_created ON enriched_support_conversations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_enriched_support_linear ON enriched_support_conversations(linear_issue_id) WHERE linear_issue_id IS NOT NULL;

-- ============================================================================
-- 5. COMMENTS
-- ============================================================================

COMMENT ON TABLE linear_issues IS 'Stores Linear issues from "dub 3.0" team (last 6 months)';
COMMENT ON TABLE linear_feedback_mapping IS 'Maps Linear issues to the top 10 support feedback items';
COMMENT ON COLUMN raw_support_conversations.has_linear_ticket IS 'TRUE if Zendesk ticket has "linear_ticket" tag';
COMMENT ON COLUMN raw_support_conversations.linear_issue_id IS 'Linear issue ID extracted from Zendesk custom field or tag';
COMMENT ON COLUMN linear_feedback_mapping.mapping_source IS 'How the mapping was created: zendesk_integration (direct link) or ai_semantic_match (Claude AI)';
COMMENT ON COLUMN linear_feedback_mapping.mapping_confidence IS 'Confidence score for AI-matched mappings (0.00-1.00). NULL for direct Zendesk links.';
