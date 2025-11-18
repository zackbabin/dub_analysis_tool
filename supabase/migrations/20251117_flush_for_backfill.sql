-- Flush all user data for clean 60-day backfill
-- Run this before starting backfill process

-- Clear staging tables
TRUNCATE TABLE raw_mixpanel_events_staging;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'portfolio_engagement_staging') THEN
    TRUNCATE TABLE portfolio_engagement_staging;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'creator_engagement_staging') THEN
    TRUNCATE TABLE creator_engagement_staging;
  END IF;
END $$;

-- Clear main data table
TRUNCATE TABLE subscribers_insights;

-- Refresh materialized views
DO $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY main_analysis;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY copy_engagement_summary;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY retention_analysis;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
