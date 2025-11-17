-- Fix: Make copy_engagement_summary refresh more robust
-- Handle cases where CONCURRENT refresh might fail due to missing unique index

DROP FUNCTION IF EXISTS refresh_copy_engagement_summary();

CREATE OR REPLACE FUNCTION refresh_copy_engagement_summary()
RETURNS void AS $$
BEGIN
  -- Try concurrent refresh first (safer, but requires unique index)
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY copy_engagement_summary;
    RAISE NOTICE 'Refreshed copy_engagement_summary (concurrent mode)';
  EXCEPTION
    WHEN OTHERS THEN
      -- Fall back to non-concurrent refresh if concurrent fails
      RAISE NOTICE 'Concurrent refresh failed, falling back to non-concurrent';
      REFRESH MATERIALIZED VIEW copy_engagement_summary;
      RAISE NOTICE 'Refreshed copy_engagement_summary (non-concurrent mode)';
  END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Do the same for subscription_engagement_summary
DROP FUNCTION IF EXISTS refresh_subscription_engagement_summary();

CREATE OR REPLACE FUNCTION refresh_subscription_engagement_summary()
RETURNS void AS $$
BEGIN
  -- Try concurrent refresh first (safer, but requires unique index)
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY subscription_engagement_summary;
    RAISE NOTICE 'Refreshed subscription_engagement_summary (concurrent mode)';
  EXCEPTION
    WHEN OTHERS THEN
      -- Fall back to non-concurrent refresh if concurrent fails
      RAISE NOTICE 'Concurrent refresh failed, falling back to non-concurrent';
      REFRESH MATERIALIZED VIEW subscription_engagement_summary;
      RAISE NOTICE 'Refreshed subscription_engagement_summary (non-concurrent mode)';
  END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
