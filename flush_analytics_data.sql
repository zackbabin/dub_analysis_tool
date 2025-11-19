-- Flush all analytics data except manual file uploads
-- This clears: event sequences, user metrics, creator metrics, support/CX data, and sync logs
-- This preserves: portfolio performance, stock holdings, business assumptions, marketing metrics

-- Disable triggers temporarily for faster deletion
SET session_replication_role = 'replica';

-- 1. Event Sequences (core analytics pipeline)
TRUNCATE TABLE event_sequences_raw CASCADE;
TRUNCATE TABLE user_event_sequences CASCADE;
TRUNCATE TABLE event_sequence_analysis CASCADE;

-- 2. User Engagement & Metrics (synced from Mixpanel)
TRUNCATE TABLE subscribers_insights CASCADE;
TRUNCATE TABLE user_creator_engagement CASCADE;
TRUNCATE TABLE user_portfolio_creator_engagement CASCADE;
TRUNCATE TABLE creator_engagement_staging CASCADE;
TRUNCATE TABLE portfolio_engagement_staging CASCADE;

-- 3. Creator Metrics
TRUNCATE TABLE premium_creator_metrics CASCADE;
TRUNCATE TABLE premium_creator_retention_events CASCADE;

-- 4. Conversion & Subscription Analysis
TRUNCATE TABLE subscription_drivers CASCADE;
TRUNCATE TABLE conversion_pattern_combinations CASCADE;

-- 5. Support & CX Data
TRUNCATE TABLE raw_support_conversations CASCADE;
TRUNCATE TABLE support_conversation_messages CASCADE;
TRUNCATE TABLE support_analysis_results CASCADE;
TRUNCATE TABLE linear_issues CASCADE;
TRUNCATE TABLE linear_feedback_mapping CASCADE;
TRUNCATE TABLE support_sync_status CASCADE;

-- 6. Sync Logs (track all sync operations)
TRUNCATE TABLE sync_logs CASCADE;

-- Re-enable triggers
SET session_replication_role = 'origin';

-- Note: The following tables are PRESERVED (manual uploads):
-- - portfolio_performance_metrics
-- - portfolio_stock_holdings
-- - business_assumptions
-- - marketing_metrics
-- - premium_creators (if manually maintained)
-- - portfolio_creator_copy_metrics (if manually maintained)
-- - cron_job_config
-- - supabase_config
-- - materialized views (will be refreshed after new data sync)

SELECT 'Analytics data flushed successfully. Manual upload data preserved.' as status;
