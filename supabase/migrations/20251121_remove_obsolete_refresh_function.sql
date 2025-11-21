-- Migration: Remove refresh_enriched_support_conversations function
-- Reason: enriched_support_conversations is now a regular view (not materialized)
-- Regular views don't need refresh functions - they always show current data
-- Date: 2025-11-21

-- Drop the obsolete refresh function
DROP FUNCTION IF EXISTS refresh_enriched_support_conversations();

-- Note: This function is no longer needed since enriched_support_conversations
-- was converted from a materialized view to a regular view in migration:
-- 20251121_convert_enriched_support_to_regular_view.sql
