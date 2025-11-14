-- Fix missing engagement summary views
-- These views were created WITH NO DATA and need to be refreshed

-- Check if views exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_matviews WHERE matviewname = 'copy_engagement_summary'
  ) THEN
    RAISE NOTICE '⚠️ copy_engagement_summary does not exist - creating it';

    CREATE MATERIALIZED VIEW copy_engagement_summary AS
    SELECT
      did_copy,
      COUNT(DISTINCT distinct_id) AS total_users,
      ROUND(AVG(total_profile_views), 2) AS avg_profile_views,
      ROUND(AVG(total_pdp_views), 2) AS avg_pdp_views,
      ROUND(AVG(unique_creators_viewed), 2) AS avg_unique_creators,
      ROUND(AVG(unique_portfolios_viewed), 2) AS avg_unique_portfolios
    FROM main_analysis
    GROUP BY did_copy;

    RAISE NOTICE '✅ Created copy_engagement_summary';
  ELSE
    RAISE NOTICE '✅ copy_engagement_summary exists';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_matviews WHERE matviewname = 'subscription_engagement_summary'
  ) THEN
    RAISE NOTICE '⚠️ subscription_engagement_summary does not exist - creating it';

    CREATE MATERIALIZED VIEW subscription_engagement_summary AS
    SELECT
      did_subscribe,
      COUNT(DISTINCT distinct_id) AS total_users,
      ROUND(AVG(total_profile_views), 2) AS avg_profile_views,
      ROUND(AVG(total_pdp_views), 2) AS avg_pdp_views,
      ROUND(AVG(unique_creators_viewed), 2) AS avg_unique_creators,
      ROUND(AVG(unique_portfolios_viewed), 2) AS avg_unique_portfolios
    FROM main_analysis
    GROUP BY did_subscribe;

    RAISE NOTICE '✅ Created subscription_engagement_summary';
  ELSE
    RAISE NOTICE '✅ subscription_engagement_summary exists';
  END IF;
END $$;

-- Create or replace refresh functions
CREATE OR REPLACE FUNCTION refresh_copy_engagement_summary()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW copy_engagement_summary;
  RAISE NOTICE '✅ Refreshed copy_engagement_summary';
END;
$$;

CREATE OR REPLACE FUNCTION refresh_subscription_engagement_summary()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW subscription_engagement_summary;
  RAISE NOTICE '✅ Refreshed subscription_engagement_summary';
END;
$$;

-- Refresh both views with data
REFRESH MATERIALIZED VIEW copy_engagement_summary;
REFRESH MATERIALIZED VIEW subscription_engagement_summary;

-- Grant permissions
GRANT SELECT ON copy_engagement_summary TO anon, authenticated, service_role;
GRANT SELECT ON subscription_engagement_summary TO anon, authenticated, service_role;

-- Verify data
SELECT
  'copy_engagement_summary' as view_name,
  COUNT(*) as row_count
FROM copy_engagement_summary

UNION ALL

SELECT
  'subscription_engagement_summary' as view_name,
  COUNT(*) as row_count
FROM subscription_engagement_summary;

-- Show summary
DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ Engagement summary views fixed';
  RAISE NOTICE 'Views created/verified and refreshed with data';
  RAISE NOTICE 'RPCs created: refresh_copy_engagement_summary(), refresh_subscription_engagement_summary()';
  RAISE NOTICE '========================================';
END $$;
