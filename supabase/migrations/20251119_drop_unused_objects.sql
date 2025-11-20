-- Migration: Drop unused tables and views
-- Date: 2025-11-19
--
-- This migration removes 8 database objects that were verified to have zero active usage:
-- - 2 tables: supabase_config, materialized_view_refresh_log
-- - 6 views: event_sequences_sorted, daily_cron_schedule, validation_*
--
-- All objects were thoroughly verified across:
-- - Edge functions (supabase/functions)
-- - Frontend code (*.js files)
-- - Database functions and triggers
-- - View dependencies
-- - Foreign key constraints
--
-- No active code references these objects.

-- Drop views first (no dependencies)
DROP VIEW IF EXISTS event_sequences_sorted;
DROP VIEW IF EXISTS daily_cron_schedule;
DROP VIEW IF EXISTS validation_aggregation_methods;
DROP VIEW IF EXISTS validation_duplicate_creator_ids;
DROP VIEW IF EXISTS validation_subscription_consistency;
DROP VIEW IF EXISTS validation_view_freshness;

-- Drop tables
DROP TABLE IF EXISTS supabase_config;
DROP TABLE IF EXISTS materialized_view_refresh_log;

-- Also drop the unused function that was created with event_sequences_sorted
DROP FUNCTION IF EXISTS get_sorted_event_sequences(text);

-- Drop the unused logging function that was created with materialized_view_refresh_log
DROP FUNCTION IF EXISTS log_materialized_view_refresh(text, integer, bigint);

COMMENT ON SCHEMA public IS 'Cleaned up unused objects on 2025-11-19: Removed 8 tables/views and 2 functions that had zero active usage';
