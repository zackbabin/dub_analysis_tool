-- Flush all user data for clean 60-day backfill
-- This clears subscribers_insights, staging tables, and refreshes dependent views
-- Date: 2025-11-17
--
-- WARNING: This deletes ALL user event and property data
-- Only run this when you're ready to do a complete 60-day backfill
--
-- After running this, you MUST:
-- 1. Deploy edge functions (sync-mixpanel-user-events, sync-mixpanel-user-properties-v2)
-- 2. Trigger 60-day backfill: sync-mixpanel-user-events with { "chunk_start_day": 0 }
-- 3. Trigger user properties sync: sync-mixpanel-user-properties-v2 with {}

-- ============================================================================
-- Complete flush script wrapped in single DO block
-- ============================================================================

DO $$
DECLARE
  record_count INTEGER;
  si_count INTEGER;
  staging_count INTEGER;
  main_analysis_count INTEGER;
BEGIN
  -- ============================================================================
  -- STEP 1: Clear staging tables
  -- ============================================================================

  RAISE NOTICE 'Step 1: Clearing staging tables...';

  -- Clear event staging table
  TRUNCATE TABLE raw_mixpanel_events_staging;
  RAISE NOTICE '  Cleared raw_mixpanel_events_staging';

  -- Clear portfolio engagement staging (if exists)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'portfolio_engagement_staging') THEN
    EXECUTE 'TRUNCATE TABLE portfolio_engagement_staging';
    RAISE NOTICE '  Cleared portfolio_engagement_staging';
  END IF;

  -- Clear creator engagement staging (if exists)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'creator_engagement_staging') THEN
    EXECUTE 'TRUNCATE TABLE creator_engagement_staging';
    RAISE NOTICE '  Cleared creator_engagement_staging';
  END IF;

  RAISE NOTICE 'Step 1 complete: All staging tables cleared';
  RAISE NOTICE '';

  -- ============================================================================
  -- STEP 2: Clear subscribers_insights table
  -- ============================================================================

  RAISE NOTICE 'Step 2: Clearing subscribers_insights table...';

  -- Get count before clearing
  SELECT COUNT(*) INTO record_count FROM subscribers_insights;
  RAISE NOTICE '  Current record count: %', record_count;

  -- Clear the table
  TRUNCATE TABLE subscribers_insights;

  RAISE NOTICE '  Cleared subscribers_insights (% records removed)', record_count;
  RAISE NOTICE 'Step 2 complete: subscribers_insights cleared';
  RAISE NOTICE '';

  -- ============================================================================
  -- STEP 3: Refresh dependent materialized views (they'll be empty now)
  -- ============================================================================

  RAISE NOTICE 'Step 3: Refreshing dependent materialized views...';

  -- Refresh main_analysis (depends on subscribers_insights)
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY main_analysis;
    RAISE NOTICE '  Refreshed main_analysis (now empty)';
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE '  Warning: Failed to refresh main_analysis: %', SQLERRM;
  END;

  -- Refresh copy_engagement_summary (depends on subscribers_insights)
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY copy_engagement_summary;
    RAISE NOTICE '  Refreshed copy_engagement_summary (now empty)';
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE '  Warning: Failed to refresh copy_engagement_summary: %', SQLERRM;
  END;

  -- Refresh retention_analysis (if it depends on subscribers_insights)
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY retention_analysis;
    RAISE NOTICE '  Refreshed retention_analysis (now empty)';
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE '  Warning: Failed to refresh retention_analysis: %', SQLERRM;
  END;

  RAISE NOTICE 'Step 3 complete: All materialized views refreshed';
  RAISE NOTICE '';

  -- ============================================================================
  -- STEP 4: Verification
  -- ============================================================================

  RAISE NOTICE 'Step 4: Verifying flush completed...';

  -- Check subscribers_insights
  SELECT COUNT(*) INTO si_count FROM subscribers_insights;
  RAISE NOTICE '  subscribers_insights: % records', si_count;

  -- Check staging
  SELECT COUNT(*) INTO staging_count FROM raw_mixpanel_events_staging;
  RAISE NOTICE '  raw_mixpanel_events_staging: % records', staging_count;

  -- Check main_analysis
  BEGIN
    SELECT COUNT(*) INTO main_analysis_count FROM main_analysis;
    RAISE NOTICE '  main_analysis: % records', main_analysis_count;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE '  main_analysis: N/A (view does not exist)';
  END;

  RAISE NOTICE '';

  IF si_count = 0 AND staging_count = 0 THEN
    RAISE NOTICE 'FLUSH SUCCESSFUL - All tables are empty and ready for backfill';
  ELSE
    RAISE WARNING 'FLUSH INCOMPLETE - Some tables still have data';
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '============================================================================';
  RAISE NOTICE 'NEXT STEPS FOR BACKFILL:';
  RAISE NOTICE '============================================================================';
  RAISE NOTICE '';
  RAISE NOTICE '1. Deploy edge functions:';
  RAISE NOTICE '   supabase functions deploy sync-mixpanel-user-events';
  RAISE NOTICE '   supabase functions deploy sync-mixpanel-user-properties-v2';
  RAISE NOTICE '';
  RAISE NOTICE '2. Trigger 60-day event backfill (this will auto-chain through 4 chunks):';
  RAISE NOTICE '   POST /functions/v1/sync-mixpanel-user-events';
  RAISE NOTICE '   Body: {"chunk_start_day": 0}';
  RAISE NOTICE '';
  RAISE NOTICE '3. Wait for backfill to complete (about 20-30 minutes for all 4 chunks)';
  RAISE NOTICE '';
  RAISE NOTICE '4. Trigger user properties sync:';
  RAISE NOTICE '   POST /functions/v1/sync-mixpanel-user-properties-v2';
  RAISE NOTICE '   Body: {}';
  RAISE NOTICE '';
  RAISE NOTICE '5. Verify data:';
  RAISE NOTICE '   SELECT COUNT(*) FROM subscribers_insights;';
  RAISE NOTICE '   SELECT COUNT(*) FROM raw_mixpanel_events_staging;';
  RAISE NOTICE '   SELECT COUNT(*) FROM main_analysis;';
  RAISE NOTICE '';
  RAISE NOTICE '============================================================================';
END $$;
